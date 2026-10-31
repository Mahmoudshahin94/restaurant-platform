import { Inject, Injectable } from '@nestjs/common';
import { hashSecret, verifySecret } from '@pos/database';
import { DomainError, assertTenantAccess, newId } from '@pos/domain';
import type { TokenResponse } from '@pos/validation';
import { SERVER_MODE, type ServerMode } from '../../common/auth/managed-in-cloud';
import type { Principal } from '../../common/auth/principal';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from './access.service';
import { ACCOUNT_DIRECTORY, type AccountDirectory } from './account-directory';
import { TokenService } from './token.service';

/** PIN guessing: this many wrong PINs for one employee code lock it for LOCK_MS. */
const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MS = 5 * 60_000;

/**
 * Which of an account's users (oldest first) to sign in: the one in the requested brand, else the
 * one in the last brand, else the oldest. An archived brand (reading only) is chosen only when it
 * is requested or the account has nothing else, so nobody lands in one by default.
 */
function pickUser<T extends { tenantId: string; tenant: { status: string } }>(
  users: readonly T[],
  requested: string | undefined,
  last: string | null,
): T | undefined {
  const open = users.filter((u) => u.tenant.status !== 'ARCHIVED');
  return (
    users.find((u) => u.tenantId === requested) ??
    open.find((u) => u.tenantId === last) ??
    open[0] ??
    users[0]
  );
}

export interface IssuedSession {
  response: Omit<TokenResponse, 'refreshToken'>;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  /** Hash verified when the email is unknown, so response time does not reveal which emails exist. */
  private timingDummyHash: Promise<string> | undefined;
  /** In-memory, per hub process: PIN sign-in only exists on the hub. */
  private readonly pinFailures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    @Inject(ACCOUNT_DIRECTORY) private readonly directory: AccountDirectory,
    @Inject(SERVER_MODE) private readonly mode: ServerMode,
  ) {}

  /**
   * Signs a person in by e-mail and password. Their account may have a user in several brands:
   * sign-in picks the requested brand, else the last one, else the oldest, among the usable ones
   * (`AccountDirectory.brandsFor`), passing over archived brands unless requested or the only
   * ones (`pickUser`). A brand the account cannot use is ignored, never reported.
   */
  async login(email: string, password: string, tenantId?: string): Promise<IssuedSession> {
    const account = await TenantContext.runUnscoped('sign-in: find the account by e-mail', () =>
      this.prisma.account.findUnique({
        where: { email: email.trim().toLowerCase() },
        select: {
          id: true,
          passwordHash: true,
          lastTenantId: true,
          users: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              tenantId: true,
              isActive: true,
              tenant: { select: { status: true } },
            },
          },
        },
      }),
    );
    if (!account) {
      this.timingDummyHash ??= hashSecret(newId());
      await verifySecret(await this.timingDummyHash, password);
      throw new DomainError('INVALID_CREDENTIALS', 'Invalid email or password');
    }
    if (!(await verifySecret(account.passwordHash, password))) {
      const user = pickUser(account.users, tenantId, account.lastTenantId);
      if (user) {
        await TenantContext.runInTenant(user.tenantId, () =>
          this.audit.record({
            action: 'auth.login_failed',
            entityType: 'User',
            entityId: user.id,
            actorType: 'USER',
            actorId: user.id,
            tenantId: user.tenantId,
            metadata: { reason: 'INVALID_CREDENTIALS' },
          }),
        );
      }
      throw new DomainError('INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const usable = new Set((await this.directory.brandsFor(account.id)).map((b) => b.id));
    const user = pickUser(
      account.users.filter((u) => usable.has(u.tenantId)),
      tenantId,
      account.lastTenantId,
    );
    if (!user) {
      // As before accounts: a suspended business says so; otherwise the account is disabled.
      // Neither names a brand.
      if (account.users.some((u) => u.isActive && u.tenant.status === 'SUSPENDED')) {
        assertTenantAccess('SUSPENDED', 'read');
      }
      throw new DomainError('ACCOUNT_DISABLED', 'Account is disabled');
    }
    // The cloud remembers the brand for the next sign-in; the hub has only one.
    if (this.mode === 'cloud' && account.lastTenantId !== user.tenantId) {
      await this.prisma.account.update({
        where: { id: account.id },
        data: { lastTenantId: user.tenantId },
      });
    }
    return TenantContext.runInTenant(user.tenantId, () => this.completeLogin(user));
  }

  /**
   * The account's user in `tenantId` when the account can use that brand (see `login`), else
   * null — whether the account has no user there, or one that is deactivated or suspended.
   */
  async usableUserFor(
    accountId: string,
    tenantId: string,
  ): Promise<{ id: string; tenantId: string } | null> {
    const brands = await this.directory.brandsFor(accountId);
    if (!brands.some((b) => b.id === tenantId)) return null;
    return TenantContext.runUnscoped("sign-in: find the account's user in a brand", () =>
      this.prisma.user.findUnique({
        where: { tenantId_accountId: { tenantId, accountId } },
        select: { id: true, tenantId: true },
      }),
    );
  }

  /**
   * Moves a signed-in person to another brand of their account (cloud only; the hub holds one
   * brand). Like `refresh`, it needs the caller's own live refresh token: an access token alone
   * never starts a long-lived session. The token's family is revoked and a new session starts for
   * the account's user in `tenantId`, which must be usable (`usableUserFor`); otherwise the brand
   * is "not found", as for any foreign tenant. Switching to the current brand issues a new
   * session too. Each brand's audit trail records the switch.
   *
   * Order: validate the token, start the new session, end the old one (an atomic claim, so two
   * concurrent switches with one token cannot both succeed), then write the audit entries.
   */
  async switchTenant(
    principal: Principal,
    tenantId: string,
    currentRefresh: string | undefined,
  ): Promise<IssuedSession> {
    const notFound = () => new DomainError('TENANT_NOT_FOUND', 'Tenant not found');
    if (this.mode !== 'cloud') throw notFound();
    const source = await this.prisma.user.findUniqueOrThrow({
      where: { id: principal.userId },
      select: { id: true, accountId: true, tenantId: true },
    });
    const family = await this.currentFamily(source, currentRefresh);
    const target = await this.usableUserFor(source.accountId, tenantId);
    if (!target) throw notFound();

    // A request never works in two tenants: the target brand's side runs outside any tenant scope,
    // naming its tenant explicitly.
    const newFamily = newId();
    const session = await TenantContext.runUnscoped(
      'switching brands: start the session of the account’s user in the target brand',
      () => this.issueSession(target.id, target.tenantId, newFamily),
    );
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { familyId: family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      // Lost a race with another switch or a logout using the same token: no second session.
      await this.revokeFamily(newFamily);
      throw new DomainError('UNAUTHENTICATED', 'Refresh token was just revoked');
    }

    await this.audit.record({
      action: 'auth.switch',
      entityType: 'User',
      entityId: source.id,
      actorType: 'USER',
      actorId: source.id,
      tenantId: source.tenantId,
      metadata: { toTenantId: target.tenantId },
    });
    await TenantContext.runUnscoped(
      'switching brands: record the sign-in in the target brand',
      async () => {
        await this.prisma.user.update({
          where: { id: target.id },
          data: { lastLoginAt: new Date() },
        });
        await this.audit.record({
          action: 'auth.switch',
          entityType: 'User',
          entityId: target.id,
          actorType: 'USER',
          actorId: target.id,
          tenantId: target.tenantId,
          metadata: { fromTenantId: source.tenantId },
        });
      },
    );
    // The cloud remembers the brand for the next sign-in, as `login` does.
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: source.accountId },
      select: { lastTenantId: true },
    });
    if (account.lastTenantId !== target.tenantId) {
      await this.prisma.account.update({
        where: { id: source.accountId },
        data: { lastTenantId: target.tenantId },
      });
    }
    return session;
  }

  /**
   * The family of the caller's own live refresh token, as `refresh` judges it: unknown, someone
   * else's, expired or revoked tokens are refused (a replayed one revokes its family as theft).
   */
  private async currentFamily(
    user: { id: string; tenantId: string },
    rawToken: string | undefined,
  ): Promise<string> {
    if (!rawToken) throw new DomainError('UNAUTHENTICATED', 'No refresh token');
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.tokens.hashRefreshToken(rawToken) },
      select: {
        userId: true,
        familyId: true,
        revokedAt: true,
        replacedById: true,
        expiresAt: true,
      },
    });
    if (stored?.userId !== user.id)
      throw new DomainError('UNAUTHENTICATED', 'Unknown refresh token');
    if (stored.revokedAt !== null) {
      if (stored.replacedById !== null && this.tokens.withinReuseGrace(stored.revokedAt)) {
        throw new DomainError('UNAUTHENTICATED', 'Refresh token was just rotated', {
          reason: 'ROTATED',
        });
      }
      await this.revokeFamily(stored.familyId);
      await this.audit.record({
        action: 'auth.refresh_token_reuse_detected',
        entityType: 'User',
        entityId: user.id,
        actorType: 'USER',
        actorId: user.id,
        tenantId: user.tenantId,
        metadata: { familyId: stored.familyId },
      });
      throw new DomainError('TOKEN_REUSED', 'Refresh token was already used; session revoked');
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new DomainError('TOKEN_EXPIRED', 'Refresh token expired');
    }
    return stored.familyId;
  }

  private async completeLogin(user: { id: string; tenantId: string }): Promise<IssuedSession> {
    const session = await this.issueSession(user.id, user.tenantId, newId());
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      actorType: 'USER',
      actorId: user.id,
      tenantId: user.tenantId,
    });
    return session;
  }

  /**
   * Signs in a staff member by employee code and PIN (location hub only). PINs are short, so
   * repeated failures lock the code for a few minutes; the response never says whether the code
   * exists.
   */
  async pinLogin(employeeCode: string, pin: string): Promise<IssuedSession> {
    const employee = await this.verifyPin(employeeCode, pin);
    const session = await this.issueSession(employee.user.id, employee.tenantId, newId());
    await this.audit.record({
      action: 'auth.pin_login',
      entityType: 'User',
      entityId: employee.user.id,
      actorType: 'EMPLOYEE',
      actorId: employee.id,
      tenantId: employee.tenantId,
    });
    return session;
  }

  /**
   * Checks an employee code and PIN (location hub only), with the same lock after repeated
   * failures: the POS sign-in, and a staff member leaving a kiosk's customer screens (ADR 0022).
   * Returns the active employee and the user it acts as.
   */
  async verifyPin(
    employeeCode: string,
    pin: string,
  ): Promise<{
    id: string;
    tenantId: string;
    displayName: string;
    user: { id: string; tenantId: string };
  }> {
    const key = employeeCode.toUpperCase();
    const attempts = this.pinFailures.get(key);
    if (attempts && attempts.lockedUntil > Date.now()) {
      throw new DomainError('RATE_LIMITED', 'Too many wrong PINs', {
        retryAfterMs: attempts.lockedUntil - Date.now(),
      });
    }
    // Only on the hub (the cloud's route answers 404), whose database holds its paired tenant
    // only (ADR 0017). Should the code ever match staff of two tenants, nobody is signed in rather
    // than an arbitrary one.
    const matches = await this.prisma.employee.findMany({
      where: { employeeCode: { in: [employeeCode, key] }, isActive: true },
      include: { user: true },
      take: 2,
    });
    const employee = matches.length === 1 ? matches[0] : undefined;
    const valid = employee?.pinHash ? await verifySecret(employee.pinHash, pin) : false;
    if (!employee?.pinHash) {
      this.timingDummyHash ??= hashSecret(newId());
      await verifySecret(await this.timingDummyHash, pin);
    }
    if (!employee || !valid || !employee.user) {
      const count = (attempts?.count ?? 0) + 1;
      this.pinFailures.set(key, {
        count: count >= PIN_MAX_FAILURES ? 0 : count,
        lockedUntil: count >= PIN_MAX_FAILURES ? Date.now() + PIN_LOCK_MS : 0,
      });
      if (employee) {
        await this.audit.record({
          action: 'auth.pin_login_failed',
          entityType: 'Employee',
          entityId: employee.id,
          tenantId: employee.tenantId,
          metadata: { reason: 'INVALID_CREDENTIALS', locked: count >= PIN_MAX_FAILURES },
        });
      }
      throw new DomainError('INVALID_CREDENTIALS', 'Invalid employee code or PIN');
    }
    this.pinFailures.delete(key);
    if (!employee.user.isActive) throw new DomainError('ACCOUNT_DISABLED', 'Account is disabled');
    return {
      id: employee.id,
      tenantId: employee.tenantId,
      displayName: employee.displayName,
      user: employee.user,
    };
  }

  /**
   * Rotates a refresh token. Presenting a token that was already rotated or revoked is treated as
   * theft: the whole token family is revoked and the user must log in again.
   */
  async refresh(rawToken: string): Promise<IssuedSession> {
    const tokenHash = this.tokens.hashRefreshToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored) throw new DomainError('UNAUTHENTICATED', 'Unknown refresh token');
    return TenantContext.runInTenant(stored.user.tenantId, () => this.rotate(stored));
  }

  private async rotate(stored: {
    id: string;
    userId: string;
    familyId: string;
    revokedAt: Date | null;
    replacedById: string | null;
    expiresAt: Date;
    user: { tenantId: string };
  }): Promise<IssuedSession> {
    // A disabled user hears so first, even with a token their deactivation already revoked (an
    // organization revokes its removed members' sessions, E1). That covers a user holding only
    // the roles of an organization that is no longer active (`AccessService.isUsable`).
    if (!(await this.access.isUsable(stored.userId))) {
      await this.revokeFamily(stored.familyId);
      throw new DomainError('ACCOUNT_DISABLED', 'Account is disabled');
    }
    if (stored.revokedAt !== null) {
      // Just rotated by a concurrent request from the same client: fail this one, keep the session.
      if (stored.replacedById !== null && this.tokens.withinReuseGrace(stored.revokedAt)) {
        throw new DomainError('UNAUTHENTICATED', 'Refresh token was just rotated', {
          reason: 'ROTATED',
        });
      }
      await this.revokeFamily(stored.familyId);
      await this.audit.record({
        action: 'auth.refresh_token_reuse_detected',
        entityType: 'User',
        entityId: stored.userId,
        actorType: 'USER',
        actorId: stored.userId,
        tenantId: stored.user.tenantId,
        metadata: { familyId: stored.familyId },
      });
      throw new DomainError('TOKEN_REUSED', 'Refresh token was already used; session revoked');
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new DomainError('TOKEN_EXPIRED', 'Refresh token expired');
    }
    // The session survives a suspension: it continues once the platform reactivates the tenant.
    await this.assertTenantOpen(stored.user.tenantId);

    const nextRaw = this.tokens.generateRefreshToken();
    const nextId = newId();
    await this.prisma.$transaction(async (tx) => {
      // Conditional update: of two concurrent refreshes with the same token only one wins.
      const claimed = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: nextId },
      });
      if (claimed.count !== 1) {
        throw new DomainError('UNAUTHENTICATED', 'Refresh token was just rotated', {
          reason: 'ROTATED',
        });
      }
      await tx.refreshToken.create({
        data: {
          id: nextId,
          userId: stored.userId,
          familyId: stored.familyId,
          tokenHash: this.tokens.hashRefreshToken(nextRaw),
          expiresAt: this.tokens.refreshTokenExpiry(),
        },
      });
    });

    return {
      response: await this.buildResponse(stored.userId, stored.user.tenantId),
      refreshToken: nextRaw,
    };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.tokens.hashRefreshToken(rawToken) },
      include: { user: { select: { tenantId: true } } },
    });
    if (!stored) return;
    await this.revokeFamily(stored.familyId);
    await TenantContext.runInTenant(stored.user.tenantId, () =>
      this.audit.record({
        action: 'auth.logout',
        entityType: 'User',
        entityId: stored.userId,
        actorType: 'USER',
        actorId: stored.userId,
        tenantId: stored.user.tenantId,
      }),
    );
  }

  private async issueSession(
    userId: string,
    tenantId: string,
    familyId: string,
  ): Promise<IssuedSession> {
    const refreshToken = this.tokens.generateRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: this.tokens.hashRefreshToken(refreshToken),
        expiresAt: this.tokens.refreshTokenExpiry(),
      },
    });
    return { response: await this.buildResponse(userId, tenantId), refreshToken };
  }

  private async buildResponse(
    userId: string,
    tenantId: string,
  ): Promise<Omit<TokenResponse, 'refreshToken'>> {
    return {
      accessToken: await this.tokens.signAccessToken({ userId, tenantId }),
      expiresIn: this.tokens.accessTtlSeconds,
      user: await this.access.loadAuthUser(userId),
    };
  }

  /**
   * A suspended tenant's staff cannot sign in or refresh (ADR 0025); an archived tenant's still
   * can, to read.
   */
  private async assertTenantOpen(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { status: true },
    });
    assertTenantAccess(tenant.status, 'read');
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

import { Injectable } from '@nestjs/common';
import { hashSecret, verifySecret } from '@pos/database';
import { DomainError, assertTenantAccess, newId } from '@pos/domain';
import type { TokenResponse } from '@pos/validation';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from './access.service';
import { TokenService } from './token.service';

/** PIN guessing: this many wrong PINs for one employee code lock it for LOCK_MS. */
const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MS = 5 * 60_000;

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
  ) {}

  async login(email: string, password: string): Promise<IssuedSession> {
    // E-mail addresses are unique across tenants, so sign-in needs no tenant selector; the rest
    // of the sign-in runs inside the account's tenant.
    const user = await TenantContext.runUnscoped('sign-in: find the account by e-mail', () =>
      this.prisma.user.findUnique({ where: { email } }),
    );
    if (!user) {
      this.timingDummyHash ??= hashSecret(newId());
      await verifySecret(await this.timingDummyHash, password);
      throw new DomainError('INVALID_CREDENTIALS', 'Invalid email or password');
    }
    return TenantContext.runInTenant(user.tenantId, () => this.completeLogin(user, password));
  }

  private async completeLogin(
    user: { id: string; tenantId: string; passwordHash: string; isActive: boolean },
    password: string,
  ): Promise<IssuedSession> {
    const valid = await verifySecret(user.passwordHash, password);
    if (!valid) {
      await this.audit.record({
        action: 'auth.login_failed',
        entityType: 'User',
        entityId: user.id,
        actorType: 'USER',
        actorId: user.id,
        tenantId: user.tenantId,
        metadata: { reason: 'INVALID_CREDENTIALS' },
      });
      throw new DomainError('INVALID_CREDENTIALS', 'Invalid email or password');
    }
    if (!user.isActive) throw new DomainError('ACCOUNT_DISABLED', 'Account is disabled');
    await this.assertTenantOpen(user.tenantId);

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
    user: { tenantId: string; isActive: boolean };
  }): Promise<IssuedSession> {
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
    if (!stored.user.isActive) {
      await this.revokeFamily(stored.familyId);
      throw new DomainError('ACCOUNT_DISABLED', 'Account is disabled');
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

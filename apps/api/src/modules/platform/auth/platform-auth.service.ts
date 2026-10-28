import { Injectable } from '@nestjs/common';
import { type PlatformUser, hashSecret, verifySecret } from '@pos/database';
import { DomainError, newId } from '@pos/domain';
import { PlatformTokenService, PrismaService } from '@pos/server';
import { platformPermissionsOf } from '@pos/shared-types';
import type { PlatformTokenResponse, PlatformUserDto } from '@pos/validation';
import { PlatformAuditService } from '../platform-audit.service';

/** Wrong passwords in a row before the account locks, and for how long. */
export const PLATFORM_MAX_FAILED_LOGINS = 5;
export const PLATFORM_LOCK_MS = 15 * 60_000;

export interface PlatformSession {
  response: PlatformTokenResponse;
  refreshToken: string;
}

export function toPlatformUserDto(user: PlatformUser): PlatformUserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    permissions: [...platformPermissionsOf(user.role)],
    preferredLocale: user.preferredLocale,
  };
}

/**
 * Sign-in of MADAR's operators (ADR 0025). Separate from the staff sign-in in every respect: its
 * own accounts, tokens (audience `madar-platform`), refresh tokens and cookie. Attempts are
 * limited per client address (the transport's auth budget) and per account: five wrong passwords
 * in a row lock the account for fifteen minutes. Every sign-in, failure and lock is audited.
 * A second factor is a documented follow-up.
 */
@Injectable()
export class PlatformAuthService {
  /** Verified when the e-mail is unknown, so timing does not reveal which accounts exist. */
  private timingDummyHash: Promise<string> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: PlatformTokenService,
    private readonly audit: PlatformAuditService,
  ) {}

  async login(email: string, password: string): Promise<PlatformSession> {
    const user = await this.prisma.platformUser.findUnique({ where: { email } });
    if (!user) {
      this.timingDummyHash ??= hashSecret(newId());
      await verifySecret(await this.timingDummyHash, password);
      await this.audit.record({
        action: 'platform_auth.login_failed',
        entityType: 'PlatformUser',
        actorId: null,
        metadata: { reason: 'UNKNOWN_ACCOUNT', email },
      });
      throw new DomainError('INVALID_CREDENTIALS', 'Invalid email or password');
    }
    const now = Date.now();
    if (user.lockedUntil && user.lockedUntil.getTime() > now) {
      throw new DomainError('RATE_LIMITED', 'Too many failed sign-ins', {
        retryAfterMs: user.lockedUntil.getTime() - now,
      });
    }
    if (!(await verifySecret(user.passwordHash, password))) {
      await this.recordFailure(user);
      throw new DomainError('INVALID_CREDENTIALS', 'Invalid email or password');
    }
    if (!user.isActive) throw new DomainError('ACCOUNT_DISABLED', 'Account is disabled');

    await this.prisma.platformUser.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const session = await this.issue(user, newId());
    await this.audit.record({
      action: 'platform_auth.login',
      entityType: 'PlatformUser',
      entityId: user.id,
      actorId: user.id,
    });
    return session;
  }

  /** Rotates a refresh token; presenting a rotated one again revokes the whole family. */
  async refresh(rawToken: string): Promise<PlatformSession> {
    const stored = await this.prisma.platformRefreshToken.findUnique({
      where: { tokenHash: this.tokens.hashRefreshToken(rawToken) },
      include: { platformUser: true },
    });
    if (!stored) throw new DomainError('UNAUTHENTICATED', 'Unknown refresh token');
    if (stored.revokedAt !== null) {
      if (stored.replacedById !== null && this.tokens.withinReuseGrace(stored.revokedAt)) {
        throw new DomainError('UNAUTHENTICATED', 'Refresh token was just rotated', {
          reason: 'ROTATED',
        });
      }
      await this.revokeFamily(stored.familyId);
      await this.audit.record({
        action: 'platform_auth.refresh_token_reuse_detected',
        entityType: 'PlatformUser',
        entityId: stored.platformUserId,
        actorId: stored.platformUserId,
        metadata: { familyId: stored.familyId },
      });
      throw new DomainError('TOKEN_REUSED', 'Refresh token was already used; session revoked');
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new DomainError('TOKEN_EXPIRED', 'Refresh token expired');
    }
    if (!stored.platformUser.isActive) {
      await this.revokeFamily(stored.familyId);
      throw new DomainError('ACCOUNT_DISABLED', 'Account is disabled');
    }
    const nextRaw = this.tokens.generateRefreshToken();
    const nextId = newId();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.platformRefreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: nextId },
      });
      if (claimed.count !== 1) {
        throw new DomainError('UNAUTHENTICATED', 'Refresh token was just rotated', {
          reason: 'ROTATED',
        });
      }
      await tx.platformRefreshToken.create({
        data: {
          id: nextId,
          platformUserId: stored.platformUserId,
          familyId: stored.familyId,
          tokenHash: this.tokens.hashRefreshToken(nextRaw),
          expiresAt: this.tokens.refreshTokenExpiry(),
        },
      });
    });
    return { response: await this.response(stored.platformUser), refreshToken: nextRaw };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const stored = await this.prisma.platformRefreshToken.findUnique({
      where: { tokenHash: this.tokens.hashRefreshToken(rawToken) },
    });
    if (!stored) return;
    await this.revokeFamily(stored.familyId);
    await this.audit.record({
      action: 'platform_auth.logout',
      entityType: 'PlatformUser',
      entityId: stored.platformUserId,
      actorId: stored.platformUserId,
    });
  }

  async me(id: string): Promise<PlatformUserDto> {
    return toPlatformUserDto(await this.prisma.platformUser.findUniqueOrThrow({ where: { id } }));
  }

  private async recordFailure(user: PlatformUser): Promise<void> {
    const failures = user.failedLogins + 1;
    const locks = failures >= PLATFORM_MAX_FAILED_LOGINS;
    await this.prisma.platformUser.update({
      where: { id: user.id },
      data: locks
        ? { failedLogins: 0, lockedUntil: new Date(Date.now() + PLATFORM_LOCK_MS) }
        : { failedLogins: failures },
    });
    await this.audit.record({
      action: locks ? 'platform_auth.locked' : 'platform_auth.login_failed',
      entityType: 'PlatformUser',
      entityId: user.id,
      actorId: user.id,
      metadata: { reason: 'INVALID_CREDENTIALS', failures },
    });
  }

  private async issue(user: PlatformUser, familyId: string): Promise<PlatformSession> {
    const refreshToken = this.tokens.generateRefreshToken();
    await this.prisma.platformRefreshToken.create({
      data: {
        platformUserId: user.id,
        familyId,
        tokenHash: this.tokens.hashRefreshToken(refreshToken),
        expiresAt: this.tokens.refreshTokenExpiry(),
      },
    });
    return { response: await this.response(user), refreshToken };
  }

  private async response(user: PlatformUser): Promise<PlatformTokenResponse> {
    return {
      accessToken: await this.tokens.sign(user.id),
      expiresIn: this.tokens.accessTtlSeconds,
      user: toPlatformUserDto(user),
    };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.platformRefreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

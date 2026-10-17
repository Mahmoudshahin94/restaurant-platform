import { Injectable } from '@nestjs/common';
import { hashSecret, verifySecret } from '@pos/database';
import { DomainError, newId } from '@pos/domain';
import type { TokenResponse } from '@pos/validation';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from './access.service';
import { TokenService } from './token.service';

export interface IssuedSession {
  response: Omit<TokenResponse, 'refreshToken'>;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  /** Hash verified when the email is unknown, so response time does not reveal which emails exist. */
  private timingDummyHash: Promise<string> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      this.timingDummyHash ??= hashSecret(newId());
      await verifySecret(await this.timingDummyHash, password);
      throw new DomainError('INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const valid = await verifySecret(user.passwordHash, password);
    if (!valid) {
      await this.audit.record({
        action: 'auth.login_failed',
        entityType: 'User',
        entityId: user.id,
        actorType: 'USER',
        actorId: user.id,
        restaurantId: user.restaurantId,
        metadata: { reason: 'INVALID_CREDENTIALS' },
      });
      throw new DomainError('INVALID_CREDENTIALS', 'Invalid email or password');
    }
    if (!user.isActive) throw new DomainError('ACCOUNT_DISABLED', 'Account is disabled');

    const session = await this.issueSession(user.id, user.restaurantId, newId());
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      actorType: 'USER',
      actorId: user.id,
      restaurantId: user.restaurantId,
    });
    return session;
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
        restaurantId: stored.user.restaurantId,
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
      response: await this.buildResponse(stored.userId, stored.user.restaurantId),
      refreshToken: nextRaw,
    };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.tokens.hashRefreshToken(rawToken) },
      include: { user: { select: { restaurantId: true } } },
    });
    if (!stored) return;
    await this.revokeFamily(stored.familyId);
    await this.audit.record({
      action: 'auth.logout',
      entityType: 'User',
      entityId: stored.userId,
      actorType: 'USER',
      actorId: stored.userId,
      restaurantId: stored.user.restaurantId,
    });
  }

  private async issueSession(
    userId: string,
    restaurantId: string,
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
    return { response: await this.buildResponse(userId, restaurantId), refreshToken };
  }

  private async buildResponse(
    userId: string,
    restaurantId: string,
  ): Promise<Omit<TokenResponse, 'refreshToken'>> {
    return {
      accessToken: await this.tokens.signAccessToken({ userId, restaurantId }),
      expiresIn: this.tokens.accessTtlSeconds,
      user: await this.access.loadAuthUser(userId),
    };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

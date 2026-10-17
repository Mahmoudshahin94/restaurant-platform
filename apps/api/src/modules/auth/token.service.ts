import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';
import { APP_CONFIG, type AppConfig } from '../../config/env';

const ISSUER = 'pos-kds-api';
const AUDIENCE = 'pos-kds';

export interface AccessTokenClaims {
  userId: string;
  restaurantId: string;
}

/** Signs/verifies short-lived access JWTs and creates opaque refresh tokens. */
@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.key = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
  }

  get accessTtlSeconds(): number {
    return this.config.JWT_ACCESS_TTL_SECONDS;
  }

  async signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({ rid: claims.restaurantId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.config.JWT_ACCESS_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.rid !== 'string') {
        throw new DomainError('UNAUTHENTICATED', 'Malformed access token');
      }
      return { userId: payload.sub, restaurantId: payload.rid };
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired) {
        throw new DomainError('TOKEN_EXPIRED', 'Access token expired');
      }
      if (error instanceof DomainError) throw error;
      throw new DomainError('UNAUTHENTICATED', 'Invalid access token');
    }
  }

  /** 256 bits of randomness, URL-safe. Only its hash is persisted. */
  generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** True when a token rotated at `rotatedAt` is still inside the benign-race window. */
  withinReuseGrace(rotatedAt: Date, now: Date = new Date()): boolean {
    return now.getTime() - rotatedAt.getTime() < this.config.REFRESH_REUSE_GRACE_SECONDS * 1000;
  }

  refreshTokenExpiry(now: Date = new Date()): Date {
    return new Date(now.getTime() + this.config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  }
}

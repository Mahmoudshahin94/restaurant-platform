import { createHash, createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DomainError, isDomainError } from '@pos/domain';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';

const ISSUER = 'madar-api';
/** Platform tokens are for the platform's routes only: the staff guard expects `pos-kds`. */
export const PLATFORM_AUDIENCE = 'madar-platform';

/**
 * The platform's signing key (ADR 0025): `PLATFORM_JWT_SECRET`, or derived from the staff key so
 * that it always differs from it. A staff token therefore fails here on its signature before its
 * audience is even read, and a platform token fails the staff guard the same way.
 */
export function platformSecret(
  config: Pick<AppConfig, 'PLATFORM_JWT_SECRET' | 'JWT_ACCESS_SECRET'>,
): string {
  return (
    config.PLATFORM_JWT_SECRET ??
    createHmac('sha256', config.JWT_ACCESS_SECRET).update('madar-platform-key').digest('base64url')
  );
}

/**
 * Signs and verifies platform access tokens and makes the platform's opaque refresh tokens. The
 * cloud's platform module provides it; the location hub never does.
 */
@Injectable()
export class PlatformTokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.key = new TextEncoder().encode(platformSecret(config));
  }

  get accessTtlSeconds(): number {
    return this.config.JWT_ACCESS_TTL_SECONDS;
  }

  sign(platformUserId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(platformUserId)
      .setIssuer(ISSUER)
      .setAudience(PLATFORM_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.config.JWT_ACCESS_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verify(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: PLATFORM_AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string') {
        throw new DomainError('UNAUTHENTICATED', 'Malformed platform token');
      }
      return payload.sub;
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired) {
        throw new DomainError('TOKEN_EXPIRED', 'Access token expired');
      }
      if (isDomainError(error)) throw error;
      throw new DomainError('UNAUTHENTICATED', 'Invalid platform token');
    }
  }

  generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  withinReuseGrace(rotatedAt: Date, now: Date = new Date()): boolean {
    return now.getTime() - rotatedAt.getTime() < this.config.REFRESH_REUSE_GRACE_SECONDS * 1000;
  }

  /** Platform sessions are shorter than staff ones: a day at most. */
  refreshTokenExpiry(now: Date = new Date()): Date {
    return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
}

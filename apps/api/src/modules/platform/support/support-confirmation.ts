import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DomainError, canonicalJson } from '@pos/domain';
import { APP_CONFIG, type AppConfig, platformSecret } from '@pos/server';
import { SUPPORT_PREVIEW_TTL_SECONDS } from '@pos/shared-types';

/** What a confirmation binds: the repair, its target, the operator and the state they saw. */
export interface ConfirmationSubject {
  operation: string;
  tenantId: string;
  params: Record<string, unknown>;
  platformUserId: string;
  before: Record<string, unknown>;
}

interface Claims {
  /** Operation, tenant, operator. */
  o: string;
  t: string;
  u: string;
  /** SHA-256 of the canonical parameters and before-state. */
  p: string;
  b: string;
  /** Expiry, epoch seconds. */
  e: number;
}

const digest = (value: unknown) =>
  createHash('sha256').update(canonicalJson(value)).digest('base64url');

/**
 * The support tools' confirmations (ADR 0025). A preview hands one out; executing needs it back,
 * and it holds only for the same repair, tenant, parameters and operator, within five minutes,
 * while the record is exactly as previewed (a hash of the before-state): anything that changed in
 * between makes the operator look again instead of overwriting it. Stateless: an HMAC with a key
 * derived from the platform's signing key.
 */
@Injectable()
export class SupportConfirmations {
  private readonly key: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = createHmac('sha256', platformSecret(config)).update('support-confirmation').digest();
  }

  issue(subject: ConfirmationSubject, now = new Date()): { token: string; expiresAt: string } {
    const expires = Math.floor(now.getTime() / 1000) + SUPPORT_PREVIEW_TTL_SECONDS;
    const claims: Claims = {
      o: subject.operation,
      t: subject.tenantId,
      u: subject.platformUserId,
      p: digest(subject.params),
      b: digest(subject.before),
      e: expires,
    };
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return {
      token: `${body}.${this.sign(body)}`,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  /** Refuses a token that is not this preview's, expired, or of a record that changed since. */
  verify(token: string, subject: ConfirmationSubject, now = new Date()): void {
    const claims = this.read(token);
    if (
      claims.o !== subject.operation ||
      claims.t !== subject.tenantId ||
      claims.u !== subject.platformUserId ||
      claims.p !== digest(subject.params)
    ) {
      throw new DomainError(
        'SUPPORT_CONFIRMATION_INVALID',
        'The confirmation is for another preview',
        {
          reason: 'MISMATCH',
        },
      );
    }
    if (claims.e * 1000 <= now.getTime()) {
      throw new DomainError('SUPPORT_PREVIEW_STALE', 'The preview expired', { reason: 'EXPIRED' });
    }
    if (claims.b !== digest(subject.before)) {
      throw new DomainError('SUPPORT_PREVIEW_STALE', 'The record changed since the preview', {
        reason: 'CHANGED',
      });
    }
  }

  private read(token: string): Claims {
    const invalid = () =>
      new DomainError('SUPPORT_CONFIRMATION_INVALID', 'Not a confirmation', {
        reason: 'MALFORMED',
      });
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra !== undefined) throw invalid();
    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalid();
    try {
      const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Claims;
      if (typeof claims.e !== 'number') throw invalid();
      return claims;
    } catch {
      throw invalid();
    }
  }

  private sign(body: string): string {
    return createHmac('sha256', this.key).update(body).digest('base64url');
  }
}

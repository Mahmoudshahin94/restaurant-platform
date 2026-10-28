import { describe, expect, it } from 'vitest';
import { SupportConfirmations } from '../src/modules/platform/support/support-confirmation';
import { testConfig } from './env';

/** The code of the DomainError `fn` throws, with its reason, or null when it does not throw. */
function refusal(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    const { code, details } = error as { code?: string; details?: { reason?: string } };
    return `${code ?? 'NOT_A_DOMAIN_ERROR'} ${details?.reason ?? ''}`.trim();
  }
}

/** The support tools' confirmations (ADR 0025), without a database. */
describe('support confirmations', () => {
  const confirmations = new SupportConfirmations(testConfig());
  const subject = {
    operation: 'order.correct_status',
    tenantId: '01a181fb-5123-7ba2-81e9-291afc3fb077',
    params: { orderId: '01a181fb-553b-72eb-9f74-0473a04362d2', to: 'CANCELLED' },
    platformUserId: '01a181fb-577b-77d1-abe1-77b4fe5fef61',
    before: { status: 'PLACED', version: 1 },
  };
  const now = new Date('2026-10-28T10:00:00Z');

  it('holds for the same preview within five minutes', () => {
    const { token, expiresAt } = confirmations.issue(subject, now);
    expect(expiresAt).toBe('2026-10-28T10:05:00.000Z');
    expect(
      refusal(() => {
        confirmations.verify(token, { ...subject, before: { version: 1, status: 'PLACED' } }, now);
      }),
    ).toBeNull();
  });

  it('expires, and refuses a changed record, other parameters or another key', () => {
    const { token } = confirmations.issue(subject, now);
    const later = new Date(now.getTime() + 5 * 60_000);
    expect(
      refusal(() => {
        confirmations.verify(token, subject, later);
      }),
    ).toBe('SUPPORT_PREVIEW_STALE EXPIRED');
    expect(
      refusal(() => {
        confirmations.verify(token, { ...subject, before: { status: 'PLACED', version: 2 } }, now);
      }),
    ).toBe('SUPPORT_PREVIEW_STALE CHANGED');
    expect(
      refusal(() => {
        confirmations.verify(
          token,
          { ...subject, params: { ...subject.params, to: 'COMPLETED' } },
          now,
        );
      }),
    ).toBe('SUPPORT_CONFIRMATION_INVALID MISMATCH');
    const other = new SupportConfirmations(testConfig({ PLATFORM_JWT_SECRET: 'z'.repeat(40) }));
    expect(
      refusal(() => {
        other.verify(token, subject, now);
      }),
    ).toBe('SUPPORT_CONFIRMATION_INVALID MALFORMED');
  });
});

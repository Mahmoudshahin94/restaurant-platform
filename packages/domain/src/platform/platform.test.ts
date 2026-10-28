import { describe, expect, it } from 'vitest';
import { totalsFromStoredLines } from '../order/recalculate';
import {
  accessKindOf,
  assertPlatformPermissions,
  assertSupportRole,
  assertTenantAccess,
  assertTenantStatusChange,
  canonicalJson,
  diffFields,
} from './index';

/** The code of the DomainError `fn` throws, or null when it does not throw. */
function codeOf(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'NOT_A_DOMAIN_ERROR';
  }
}

describe('tenant access by status (ADR 0025)', () => {
  it('lets an active tenant do everything', () => {
    expect(
      codeOf(() => {
        assertTenantAccess('ACTIVE', 'write');
      }),
    ).toBeNull();
  });

  it('refuses a suspended tenant even reading', () => {
    expect(
      codeOf(() => {
        assertTenantAccess('SUSPENDED', 'read');
      }),
    ).toBe('TENANT_SUSPENDED');
  });

  it('lets an archived tenant read only', () => {
    expect(
      codeOf(() => {
        assertTenantAccess('ARCHIVED', 'read');
      }),
    ).toBeNull();
    expect(
      codeOf(() => {
        assertTenantAccess('ARCHIVED', accessKindOf('POST'));
      }),
    ).toBe('TENANT_ARCHIVED');
    expect(accessKindOf('get')).toBe('read');
  });

  it('allows the platform’s status changes and nothing else', () => {
    expect(
      codeOf(() => {
        assertTenantStatusChange('ACTIVE', 'SUSPENDED');
      }),
    ).toBeNull();
    expect(
      codeOf(() => {
        assertTenantStatusChange('ARCHIVED', 'ACTIVE');
      }),
    ).toBeNull();
    expect(
      codeOf(() => {
        assertTenantStatusChange('ARCHIVED', 'SUSPENDED');
      }),
    ).toBe('CONFLICT');
  });
});

describe('platform roles', () => {
  it('gives support finding but not repairing, and the viewer reading only', () => {
    expect(
      codeOf(() => {
        assertPlatformPermissions('SUPPORT', ['support.find']);
      }),
    ).toBeNull();
    expect(
      codeOf(() => {
        assertPlatformPermissions('SUPPORT', ['support.repair']);
      }),
    ).toBe('INSUFFICIENT_PERMISSION');
    expect(
      codeOf(() => {
        assertPlatformPermissions('VIEWER', ['tenants.view', 'audit.view']);
      }),
    ).toBeNull();
    expect(
      codeOf(() => {
        assertPlatformPermissions('VIEWER', ['support.find']);
      }),
    ).not.toBeNull();
    expect(
      codeOf(() => {
        assertPlatformPermissions('VIEWER', ['tenants.status']);
      }),
    ).not.toBeNull();
  });

  it('runs repairs for the roles their catalog entry names', () => {
    expect(
      codeOf(() => {
        assertSupportRole('order.correct_status', 'OPERATOR');
      }),
    ).toBeNull();
    expect(
      codeOf(() => {
        assertSupportRole('order.correct_status', 'SUPPORT');
      }),
    ).not.toBeNull();
  });
});

describe('support previews', () => {
  it('lists the fields that changed', () => {
    expect(
      diffFields({ status: 'PLACED', version: 2 }, { status: 'CANCELLED', version: 2 }),
    ).toEqual([{ field: 'status', before: 'PLACED', after: 'CANCELLED' }]);
  });

  it('writes the same canonical JSON whatever the key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [1, 2] }, b: 1 }),
    );
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it('recomputes an order header from its stored lines', () => {
    const lines = [
      { unitPrice: 1250, quantity: 2 },
      { unitPrice: 300, quantity: 1 },
    ];
    expect(
      totalsFromStoredLines({
        taxInclusive: false,
        lines,
        discounts: [200],
        taxes: [390],
        feeTotal: 500,
      }),
    ).toEqual({ subtotal: 2800, discountTotal: 200, taxTotal: 390, feeTotal: 500, total: 3490 });
    expect(
      totalsFromStoredLines({ taxInclusive: true, lines, discounts: [], taxes: [407], feeTotal: 0 })
        .total,
    ).toBe(2800);
  });
});

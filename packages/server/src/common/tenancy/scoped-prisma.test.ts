import { describe, expect, it } from 'vitest';
import { RequestContext } from '../context/request-context';
import { TENANT_KEYS, scopeArgs } from './scoped-prisma';
import { TenantContext, TenantScopeError } from './tenant-context';

const A = '0199d0a1-0000-7000-8000-00000000000a';
const B = '0199d0a1-0000-7000-8000-00000000000b';

/** The arguments a query would run with, inside tenant A. */
const inA = (model: string, operation: string, args?: Record<string, unknown>) =>
  TenantContext.runInTenant(A, () => scopeArgs(model, operation, args, 'refuse'));

describe('tenant-scoped models', () => {
  it('covers every model holding a tenant id, and the tenant by its id', () => {
    expect(TENANT_KEYS.get('Tenant')).toBe('id');
    for (const model of ['Location', 'User', 'Product', 'Order', 'Payment', 'AuditLog']) {
      expect(TENANT_KEYS.get(model)).toBe('tenantId');
    }
    // Reached through a scoped parent.
    expect(TENANT_KEYS.has('OrderItem')).toBe(false);
    expect(TENANT_KEYS.has('ProductVariant')).toBe(false);
  });
});

describe('scopeArgs', () => {
  it('adds the tenant to every filter, keeping the caller’s own conditions', async () => {
    expect(await inA('Order', 'findMany')).toEqual({ where: { tenantId: A } });
    expect(await inA('Order', 'findUnique', { where: { id: 'o1' } })).toEqual({
      where: { id: 'o1', AND: [{ tenantId: A }] },
    });
    expect(
      await inA('Product', 'count', { where: { archivedAt: null, AND: { isActive: true } } }),
    ).toEqual({ where: { archivedAt: null, AND: [{ isActive: true }, { tenantId: A }] } });
    expect(await inA('Tenant', 'findUnique', { where: { slug: 'x' } })).toEqual({
      where: { slug: 'x', AND: [{ id: A }] },
    });
    for (const operation of [
      'update',
      'updateMany',
      'delete',
      'deleteMany',
      'aggregate',
      'groupBy',
    ]) {
      expect((await inA('Location', operation, { where: { id: 'l' } }))?.where).toEqual({
        id: 'l',
        AND: [{ tenantId: A }],
      });
    }
  });

  it('a caller asking for another tenant gets nothing: both conditions must hold', async () => {
    expect(await inA('Order', 'findMany', { where: { tenantId: B } })).toEqual({
      where: { tenantId: B, AND: [{ tenantId: A }] },
    });
  });

  it('refuses writes that would put or move a row into another tenant', async () => {
    await expect(inA('Order', 'create', { data: { tenantId: B } })).rejects.toThrow(
      TenantScopeError,
    );
    await expect(
      inA('Order', 'createMany', { data: [{ tenantId: A }, { tenantId: B }] }),
    ).rejects.toThrow(TenantScopeError);
    await expect(
      inA('Category', 'create', { data: { tenant: { connect: { id: B } } } }),
    ).rejects.toThrow(TenantScopeError);
    await expect(
      inA('Product', 'update', { where: { id: 'p' }, data: { tenantId: B } }),
    ).rejects.toThrow(TenantScopeError);
    await expect(
      inA('Product', 'upsert', { where: { id: 'p' }, create: { tenantId: B }, update: {} }),
    ).rejects.toThrow(TenantScopeError);
    await expect(inA('Tenant', 'create', { data: { id: A } })).rejects.toThrow(TenantScopeError);
  });

  it('lets writes for the tenant in scope through, and audit entries without a tenant', async () => {
    expect(await inA('Order', 'create', { data: { tenantId: A, total: 1 } })).toEqual({
      data: { tenantId: A, total: 1 },
    });
    expect(await inA('AuditLog', 'create', { data: { tenantId: null } })).toEqual({
      data: { tenantId: null },
    });
  });

  it('leaves models without a tenant alone', async () => {
    const args = { where: { orderId: 'o' } };
    expect(await inA('OrderItem', 'findMany', args)).toBe(args);
    expect(scopeArgs('RefreshToken', 'findUnique', args, 'refuse')).toBe(args);
  });

  it('refuses tenant queries with no tenant in scope, unless the node holds one tenant', async () => {
    expect(() => scopeArgs('Order', 'findMany', undefined, 'refuse')).toThrow(
      /Order\.findMany ran without a tenant in scope/,
    );
    expect(scopeArgs('Order', 'findMany', undefined, 'allow')).toBeUndefined();
    expect(
      await TenantContext.runUnscoped('test: a cross-tenant lookup', () =>
        scopeArgs('Order', 'findMany', undefined, 'refuse'),
      ),
    ).toBeUndefined();
  });
});

describe('TenantContext', () => {
  const request = (tenantId: string | undefined, fn: () => Promise<unknown>) =>
    RequestContext.run({ requestId: 'r', source: 'ADMIN', ...(tenantId ? { tenantId } : {}) }, fn);

  it('takes the tenant of the request, and never lets a request switch tenants', async () => {
    await request(A, async () => {
      expect(TenantContext.current()).toEqual({ kind: 'tenant', tenantId: A });
      expect(await TenantContext.runInTenant(A, () => TenantContext.require())).toBe(A);
      await expect(TenantContext.runInTenant(B, () => 'never')).rejects.toThrow(TenantScopeError);
    });
  });

  it('scopes work outside a request to the tenant it names, including lazy promises', async () => {
    expect(TenantContext.current()).toEqual({ kind: 'none' });
    // A thenable that only reads its scope when awaited, like a Prisma query.
    const lazy = {
      then: (resolve: (v: unknown) => void) => {
        resolve(TenantContext.current());
      },
    };
    expect(await TenantContext.runInTenant(B, () => lazy)).toEqual({ kind: 'tenant', tenantId: B });
    await request(undefined, async () => {
      expect(await TenantContext.runUnscoped('test: sweep', () => lazy)).toEqual({
        kind: 'unscoped',
        reason: 'test: sweep',
      });
    });
    expect(() => TenantContext.require()).toThrow(TenantScopeError);
  });
});

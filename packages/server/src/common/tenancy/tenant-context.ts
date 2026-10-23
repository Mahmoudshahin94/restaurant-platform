import { AsyncLocalStorage } from 'node:async_hooks';
import { RequestContext } from '../context/request-context';

/**
 * Which tenant the current async call chain works for (ADR 0017). A request gets its tenant from
 * the guards (the caller's token, or a hub's device credential) through the request context;
 * work outside a request names it explicitly with `runInTenant`. The tenant-scoped Prisma client
 * reads this for every query, so a forgotten `where: { tenantId }` cannot reach another tenant.
 */
export type TenantScope =
  | { kind: 'tenant'; tenantId: string }
  /** Deliberately cross-tenant work (sign-in lookups, start-up, sweeps), with its reason. */
  | { kind: 'unscoped'; reason: string }
  | { kind: 'none' };

type Override = { tenantId: string } | { unscoped: string };

const storage = new AsyncLocalStorage<Override>();

/** A query or a switch that would cross the tenant boundary. A programming error, never data. */
export class TenantScopeError extends Error {
  override readonly name = 'TenantScopeError';
}

export const TenantContext = {
  current(): TenantScope {
    const override = storage.getStore();
    if (override && 'unscoped' in override) return { kind: 'unscoped', reason: override.unscoped };
    const tenantId = override?.tenantId ?? RequestContext.get()?.tenantId;
    return tenantId ? { kind: 'tenant', tenantId } : { kind: 'none' };
  },

  /** The current tenant, or a TenantScopeError when there is none. */
  require(): string {
    const scope = TenantContext.current();
    if (scope.kind !== 'tenant') throw new TenantScopeError('No tenant in scope');
    return scope.tenantId;
  },

  /**
   * Runs `fn` for `tenantId`. Refused inside a request that already belongs to another tenant: a
   * handler never switches tenants.
   */
  async runInTenant<T>(tenantId: string, fn: () => T | PromiseLike<T>): Promise<T> {
    const requestTenant = RequestContext.get()?.tenantId;
    if (requestTenant !== undefined && requestTenant !== tenantId) {
      throw new TenantScopeError('A request cannot switch to another tenant');
    }
    return within({ tenantId }, fn);
  },

  /**
   * Runs `fn` without tenant scoping. Only for work that is cross-tenant by nature (finding an
   * account by e-mail, a device by its credential, start-up and sweeps); the lint rule
   * `pos-local/no-unscoped-prisma` keeps it to an allowlist of files.
   */
  async runUnscoped<T>(reason: string, fn: () => T | PromiseLike<T>): Promise<T> {
    return within({ unscoped: reason }, fn);
  },
};

/**
 * Prisma queries are lazy: they run when awaited, not when called. Awaiting inside the scope makes
 * `() => prisma.x.findMany()` run in it, instead of after `run` has already returned.
 */
function within<T>(override: Override, fn: () => T | PromiseLike<T>): Promise<T> {
  return storage.run(override, async () => await fn());
}

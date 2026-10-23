import { Prisma } from '@pos/database';
import { TenantContext, TenantScopeError } from './tenant-context';

/**
 * Models scoped to a tenant and the field holding it: every model with a `tenantId`, and the
 * tenant itself by its `id`. Read from the generated client, so a new tenant-owned model is scoped
 * without touching this file. Child rows without a `tenantId` (order lines, variants, modifiers...)
 * are reached through their parent, which is scoped.
 */
export const TENANT_KEYS: ReadonlyMap<string, string> = new Map(
  Prisma.dmmf.datamodel.models.flatMap((model): [string, string][] => {
    if (model.name === 'Tenant') return [[model.name, 'id']];
    return model.fields.some((f) => f.name === 'tenantId') ? [[model.name, 'tenantId']] : [];
  }),
);

/**
 * What a query on a tenant-scoped model does without a tenant in scope: `refuse` (the cloud: it
 * holds every tenant, so the query is a bug) or `allow` (the location hub: its database holds the
 * one tenant it is paired with; requests naming a tenant are still scoped).
 */
export type WithoutTenant = 'refuse' | 'allow';

type Args = Record<string, unknown> | undefined;

interface QueryParams {
  model: string;
  operation: string;
  args: Args;
  query: (args: Args) => Promise<unknown>;
}

/**
 * Wraps a Prisma client (PostgreSQL or the hub's SQLite) so every query on a tenant-scoped model
 * is limited to the tenant in scope (`TenantContext`): reads, updates and deletes get the tenant
 * added to their filter, and creates or updates that would write another tenant's id are refused.
 * The services' own `where: { tenantId }` stay as defence in depth. Raw SQL is not covered: every
 * `$queryRaw` binds the tenant itself (ADR 0017 lists them).
 */
export function scopeToTenant<T extends object>(client: T, withoutTenant: WithoutTenant): T {
  const extendable = client as unknown as { $extends(extension: object): unknown };
  return extendable.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }: QueryParams) {
          return query(scopeArgs(model, operation, args, withoutTenant));
        },
      },
    },
  }) as T;
}

/** The arguments of one query, limited to the tenant in scope. Exported for unit tests. */
export function scopeArgs(
  model: string,
  operation: string,
  args: Args,
  withoutTenant: WithoutTenant,
): Args {
  const key = TENANT_KEYS.get(model);
  if (key === undefined) return args;
  const scope = TenantContext.current();
  if (scope.kind === 'unscoped') return args;
  if (scope.kind === 'none') {
    if (withoutTenant === 'allow') return args;
    throw new TenantScopeError(`${model}.${operation} ran without a tenant in scope`);
  }
  const { tenantId } = scope;
  const next: Record<string, unknown> = { ...args };
  const check = (data: unknown, kind: 'create' | 'update') => {
    for (const row of Array.isArray(data) ? data : [data]) {
      assertWrite(model, key, row as Record<string, unknown> | undefined, tenantId, kind);
    }
  };
  switch (operation) {
    case 'create':
    case 'createMany':
    case 'createManyAndReturn':
      check(next.data, 'create');
      return next;
    case 'upsert':
      check(next.create, 'create');
      check(next.update, 'update');
      break;
    case 'update':
    case 'updateMany':
    case 'updateManyAndReturn':
      check(next.data, 'update');
      break;
  }
  next.where = within(next.where as Record<string, unknown> | undefined, key, tenantId);
  return next;
}

function within(
  where: Record<string, unknown> | undefined,
  key: string,
  tenantId: string,
): Record<string, unknown> {
  if (!where) return { [key]: tenantId };
  const and = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
  return { ...where, AND: [...(and as unknown[]), { [key]: tenantId }] };
}

function assertWrite(
  model: string,
  key: string,
  data: Record<string, unknown> | undefined,
  tenantId: string,
  kind: 'create' | 'update',
): void {
  if (model === 'Tenant') {
    // Tenants are provisioned outside any tenant's scope; a tenant can only change itself.
    if (kind === 'create') throw new TenantScopeError('Tenants are created unscoped');
    if (data?.id !== undefined && data.id !== tenantId) {
      throw new TenantScopeError('A tenant cannot change its id');
    }
    return;
  }
  if (!data) return;
  const value = data[key];
  const relation = (data.tenant as { connect?: { id?: unknown } } | undefined)?.connect?.id;
  // `null` is allowed where the column is nullable (audit entries of the hub itself).
  const foreign =
    (value !== undefined && value !== null && value !== tenantId) ||
    (relation !== undefined && relation !== tenantId);
  if (foreign || (kind === 'update' && data.tenant !== undefined)) {
    throw new TenantScopeError(`${model}: write for another tenant refused`);
  }
}

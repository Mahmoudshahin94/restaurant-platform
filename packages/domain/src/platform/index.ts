import {
  PLATFORM_ROLE_PERMISSIONS,
  type PlatformPermission,
  type PlatformRole,
  SUPPORT_OPERATION_ROLES,
  type SupportOperationKey,
  type TenantStatus,
} from '@pos/shared-types';
import { DomainError } from '../errors';

// --- Tenant status (ADR 0025) -------------------------------------------------------------------

/** Whether a request only reads (GET, HEAD, OPTIONS) or may change something. */
export type AccessKind = 'read' | 'write';

export function accessKindOf(method: string): AccessKind {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()) ? 'read' : 'write';
}

/**
 * What a tenant's status allows its staff, hubs and website: an ACTIVE tenant everything, a
 * SUSPENDED one nothing (`TENANT_SUSPENDED`), an ARCHIVED one reading only (`TENANT_ARCHIVED`).
 * The platform's own requests are not subject to it: operators must reach a suspended tenant.
 */
export function assertTenantAccess(status: TenantStatus, kind: AccessKind): void {
  if (status === 'SUSPENDED') {
    throw new DomainError('TENANT_SUSPENDED', 'This business is suspended');
  }
  if (status === 'ARCHIVED' && kind === 'write') {
    throw new DomainError('TENANT_ARCHIVED', 'This business is archived and read-only');
  }
}

/** The statuses a platform operator can move a tenant to, from each status. */
export const TENANT_STATUS_TRANSITIONS: Readonly<Record<TenantStatus, readonly TenantStatus[]>> = {
  ACTIVE: ['SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: ['ACTIVE'],
};

export function assertTenantStatusChange(from: TenantStatus, to: TenantStatus): void {
  if (!TENANT_STATUS_TRANSITIONS[from].includes(to)) {
    throw new DomainError('CONFLICT', `A tenant cannot move from ${from} to ${to}`, {
      reason: 'STATUS_TRANSITION',
      from,
      to,
      allowed: TENANT_STATUS_TRANSITIONS[from],
    });
  }
}

// --- Platform roles -----------------------------------------------------------------------------

export function hasPlatformPermissions(
  role: PlatformRole,
  required: readonly PlatformPermission[],
): boolean {
  const granted = PLATFORM_ROLE_PERMISSIONS[role];
  return required.every((p) => granted.includes(p));
}

export function assertPlatformPermissions(
  role: PlatformRole,
  required: readonly PlatformPermission[],
): void {
  if (!hasPlatformPermissions(role, required)) {
    const granted = PLATFORM_ROLE_PERMISSIONS[role];
    throw new DomainError('INSUFFICIENT_PERMISSION', 'Missing required platform permissions', {
      missing: required.filter((p) => !granted.includes(p)),
    });
  }
}

/** A repair runs only for the roles its catalog entry names. */
export function assertSupportRole(operation: SupportOperationKey, role: PlatformRole): void {
  if (!SUPPORT_OPERATION_ROLES[operation].includes(role)) {
    throw new DomainError('INSUFFICIENT_PERMISSION', 'This role may not run this repair', {
      operation,
      role,
    });
  }
}

// --- Support previews ---------------------------------------------------------------------------

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The fields whose value differs between two states, in the order of `after`, then `before`. */
export function diffFields(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): FieldChange[] {
  const fields = [...new Set([...Object.keys(after), ...Object.keys(before)])];
  return fields
    .filter((field) => !same(before[field], after[field]))
    .map((field) => ({ field, before: before[field] ?? null, after: after[field] ?? null }));
}

/**
 * A canonical JSON text of a value (object keys sorted at every level), so the same state always
 * hashes the same: the support tools' confirmations bind to the hash of the before-state.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  if (value === undefined) return 'null';
  return JSON.stringify(value instanceof Date ? value.toISOString() : value);
}

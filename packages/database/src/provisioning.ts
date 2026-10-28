import { randomBytes } from 'node:crypto';
import {
  DEFAULT_TENANT_CURRENCY,
  DomainKind,
  DomainStatus,
  PERMISSIONS,
  type Permission,
  isPermission,
} from '@pos/shared-types';
import type { Locale, Prisma, PrismaClient } from '@prisma/client';

export interface TenantSpec {
  slug: string;
  nameEn: string;
  nameAr: string;
  legalName?: string | null;
  /** @pos/shared-types BusinessType; picks default configuration only. */
  businessType?: string;
  /** ISO 4217, fixed for the tenant's lifetime (ADR 0002); MADAR's default is ILS (ADR 0020). */
  currencyCode?: string;
  defaultLocale: Locale;
  supportedLocales?: Locale[];
  timezone: string;
}

export interface LocationSpec {
  code: string;
  nameEn: string;
  nameAr: string;
  timezone: string;
  taxInclusive: boolean;
  addressLine?: string | null;
  phone?: string | null;
  /** Online ordering at creation (later changes are the tenant's, ADR 0013). */
  online?: {
    state: 'OPEN' | 'PAUSED' | 'CLOSED';
    acceptMinutes: number;
    pickupEnabled: boolean;
    deliveryEnabled: boolean;
    deliveryFee: number;
  };
}

export interface RoleSpec {
  name: string;
  description: string;
  isSystem: boolean;
  /** `*` = every permission (system roles also receive permissions added later). */
  permissions: '*' | string[];
}

/** The tenant's first account: an Owner (the system role), tenant-wide. */
export interface OwnerSpec {
  /** Lowercase; e-mail addresses are unique across tenants. */
  email: string;
  displayName: string;
  /** argon2id hash (`hashSecret`); the password itself never reaches provisioning. */
  passwordHash: string;
  preferredLocale?: Locale;
}

/** What the platform allows the tenant for one module (ADR 0018). */
export interface EntitlementSpec {
  entitled: boolean;
  tenantConfigurable: boolean;
}

export interface ProvisionedTenant {
  tenantId: string;
  /** Location code → id. */
  locationIds: Map<string, string>;
  /** Role name → id. */
  roleIds: Map<string, string>;
  /** The owner's user id, when an owner was given. */
  ownerId: string | null;
}

/** An owner e-mail that already belongs to another tenant's account. */
export class OwnerEmailTakenError extends Error {
  override readonly name = 'OwnerEmailTakenError';
}

/** Every tenant starts with an Owner: a system role holding every permission. */
export const OWNER_ROLE: RoleSpec = {
  name: 'Owner',
  description: 'Full access',
  isSystem: true,
  permissions: '*',
};

/** A domain's verification token: 128 random bits, URL- and DNS-safe. */
export function newDomainVerificationToken(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Creates a tenant with its locations and roles (ADR 0017), or brings an existing one (same
 * slug) up to the given locations and roles without touching anything else. The tenant's own
 * settings are never overwritten. Used by the development seed and the platform operator's API
 * (ADR 0025). The client must not be tenant-scoped: provisioning happens outside any tenant.
 */
export async function provisionTenant(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: {
    tenant: TenantSpec;
    locations: LocationSpec[];
    roles?: RoleSpec[];
    /**
     * MADAR's web domain (`PLATFORM_WEB_DOMAIN`): the tenant's website answers on
     * `<slug>.<webDomain>`, verified at once and primary unless the tenant has a primary already
     * (ADR 0023).
     */
    webDomain?: string;
    /**
     * The modules the platform allows (ADR 0018), written for a new tenant only: an existing
     * tenant's entitlements are the platform's later decisions.
     */
    entitlements?: Partial<Record<string, EntitlementSpec>>;
    /** The first account, an Owner tenant-wide; kept as it is when the e-mail is the tenant's. */
    owner?: OwnerSpec;
  },
): Promise<ProvisionedTenant> {
  const {
    supportedLocales,
    currencyCode = DEFAULT_TENANT_CURRENCY,
    ...tenantFields
  } = input.tenant;
  const existing = await prisma.tenant.findUnique({
    where: { slug: input.tenant.slug },
    select: { id: true },
  });
  const tenant = await prisma.tenant.upsert({
    where: { slug: input.tenant.slug },
    update: {},
    // Without a choice the tenant offers every locale (the column default).
    create: { ...tenantFields, currencyCode, ...(supportedLocales ? { supportedLocales } : {}) },
  });
  if (!existing && input.entitlements) {
    const rows = Object.entries(input.entitlements).flatMap(([feature, spec]) =>
      spec ? [{ tenantId: tenant.id, feature, ...spec }] : [],
    );
    if (rows.length > 0) await prisma.tenantEntitlement.createMany({ data: rows });
  }

  if (input.webDomain) await provisionSubdomain(prisma, tenant, input.webDomain);

  const locationIds = new Map<string, string>();
  for (const { online, ...loc } of input.locations) {
    const location = await prisma.location.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: loc.code } },
      update: {},
      create: {
        ...loc,
        tenantId: tenant.id,
        ...(online
          ? {
              onlineOrderingState: online.state,
              onlineAcceptMinutes: online.acceptMinutes,
              onlinePickupEnabled: online.pickupEnabled,
              onlineDeliveryEnabled: online.deliveryEnabled,
              onlineDeliveryFee: online.deliveryFee,
            }
          : {}),
      },
    });
    locationIds.set(loc.code, location.id);
  }

  const roles = input.roles ?? [OWNER_ROLE];
  if (!roles.some((r) => r.isSystem)) throw new Error('A tenant needs a system (owner) role');
  const roleIds = new Map<string, string>();
  for (const spec of roles) {
    const permissions = resolveRolePermissions(spec.permissions);
    const role = await prisma.role.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: spec.name } },
      update: { description: spec.description, isSystem: spec.isSystem },
      create: {
        tenantId: tenant.id,
        name: spec.name,
        description: spec.description,
        isSystem: spec.isSystem,
      },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })),
    });
    roleIds.set(spec.name, role.id);
  }
  const ownerRoleId = roleIds.get(roles.find((r) => r.isSystem)?.name ?? '');
  if (input.owner && !ownerRoleId) throw new Error('A tenant needs a system (owner) role');
  const ownerId =
    input.owner && ownerRoleId
      ? await provisionOwner(prisma, tenant.id, ownerRoleId, input.owner)
      : null;
  return { tenantId: tenant.id, locationIds, roleIds, ownerId };
}

async function provisionOwner(
  prisma: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  roleId: string,
  owner: OwnerSpec,
): Promise<string> {
  const email = owner.email.toLowerCase();
  const found = await prisma.user.findUnique({
    where: { email },
    select: { id: true, tenantId: true },
  });
  if (found && found.tenantId !== tenantId) {
    throw new OwnerEmailTakenError('This e-mail already belongs to another account');
  }
  if (found) return found.id;
  const user = await prisma.user.create({
    data: {
      tenantId,
      email,
      passwordHash: owner.passwordHash,
      displayName: owner.displayName,
      ...(owner.preferredLocale ? { preferredLocale: owner.preferredLocale } : {}),
      roles: { create: { roleId, locationId: null } },
    },
  });
  return user.id;
}

async function provisionSubdomain(
  prisma: PrismaClient | Prisma.TransactionClient,
  tenant: { id: string; slug: string },
  webDomain: string,
): Promise<void> {
  const domain = `${tenant.slug}.${webDomain.toLowerCase()}`;
  const hasPrimary =
    (await prisma.tenantDomain.count({ where: { tenantId: tenant.id, isPrimary: true } })) > 0;
  await prisma.tenantDomain.upsert({
    where: { tenantId_domain: { tenantId: tenant.id, domain } },
    update: {},
    create: {
      tenantId: tenant.id,
      domain,
      kind: DomainKind.SUBDOMAIN,
      status: DomainStatus.VERIFIED,
      verifiedAt: new Date(),
      isPrimary: !hasPrimary,
      verificationToken: newDomainVerificationToken(),
    },
  });
}

function resolveRolePermissions(spec: '*' | string[]): Permission[] {
  if (spec === '*') return [...PERMISSIONS];
  const unknown = spec.filter((p) => !isPermission(p));
  if (unknown.length > 0) throw new Error(`Unknown permissions: ${unknown.join(', ')}`);
  return spec as Permission[];
}

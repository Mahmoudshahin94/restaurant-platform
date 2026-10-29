import {
  OrderStatus,
  PLATFORM_PERMISSIONS,
  PlatformRole,
  RestorableEntity,
  SupportFindKind,
  SupportOperationKey,
  enumValues,
} from '@pos/shared-types';
import { z } from 'zod';
import { auditLogEntrySchema, adminDeviceSchema } from './admin';
import {
  idSchema,
  isoDateTimeSchema,
  localeSchema,
  nameArSchema,
  nameEnSchema,
  paginated,
  timezoneSchema,
} from './common';
import { featureSchema } from './features';
import {
  businessTypeSchema,
  createTenantSchema,
  tenantSchema,
  tenantStatusSchema,
} from './tenancy';

/**
 * The platform admin's API (ADR 0025): MADAR's operators, never a tenant's staff. Everything here
 * is served under `/platform/*` to platform tokens only.
 */

export const platformRoleSchema = z.enum(enumValues(PlatformRole));
export const platformPermissionSchema = z.enum(PLATFORM_PERMISSIONS);

// --- Sign-in ------------------------------------------------------------------------------------

/** Browser only: the refresh token lives in an httpOnly cookie scoped to `/api/v1/platform/auth`. */
export const platformLoginSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(256),
});
export type PlatformLoginRequest = z.input<typeof platformLoginSchema>;

export const platformUserSchema = z.object({
  id: idSchema,
  email: z.email(),
  displayName: z.string(),
  role: platformRoleSchema,
  permissions: z.array(platformPermissionSchema),
  preferredLocale: localeSchema,
});
export type PlatformUserDto = z.infer<typeof platformUserSchema>;

export const platformTokenResponseSchema = z.object({
  accessToken: z.string(),
  /** Seconds until the access token expires. */
  expiresIn: z.int(),
  user: platformUserSchema,
});
export type PlatformTokenResponse = z.infer<typeof platformTokenResponseSchema>;

// --- Tenants ------------------------------------------------------------------------------------

export const platformTenantsQuerySchema = z.object({
  /** Name (either language), slug or domain. */
  search: z.string().trim().max(120).optional(),
  status: tenantStatusSchema.optional(),
  businessType: businessTypeSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PlatformTenantsQuery = z.input<typeof platformTenantsQuerySchema>;

export const platformTenantSummarySchema = tenantSchema
  .pick({
    id: true,
    slug: true,
    nameEn: true,
    nameAr: true,
    businessType: true,
    status: true,
    currencyCode: true,
    createdAt: true,
  })
  .extend({
    locationCount: z.int(),
    userCount: z.int(),
    /** The website's canonical address, if one is verified. */
    primaryDomain: z.string().nullable(),
  });
export type PlatformTenantSummary = z.infer<typeof platformTenantSummarySchema>;
export const platformTenantPageSchema = paginated(platformTenantSummarySchema);

export const platformTenantOwnerSchema = z.object({
  id: idSchema,
  email: z.email(),
  displayName: z.string(),
  isActive: z.boolean(),
  lastLoginAt: isoDateTimeSchema.nullable(),
});

export const platformTenantDetailSchema = z.object({
  tenant: tenantSchema,
  /** Active accounts holding a system role tenant-wide. */
  owners: z.array(platformTenantOwnerSchema),
  counts: z.object({ locations: z.int(), users: z.int(), devices: z.int(), orders: z.int() }),
  primaryDomain: z.string().nullable(),
  /** The newest order anywhere in the tenant. */
  lastActivityAt: isoDateTimeSchema.nullable(),
});
export type PlatformTenantDetail = z.infer<typeof platformTenantDetailSchema>;

const entitlementInputSchema = z.object({
  entitled: z.boolean(),
  tenantConfigurable: z.boolean(),
});

/**
 * A new tenant: its profile (as `createTenantSchema`), its first location, its owner and the
 * modules it is entitled to. Without `entitlements` the business type's defaults decide.
 */
export const provisionTenantSchema = z
  .object({
    tenant: createTenantSchema,
    location: z.object({
      code: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9]{2,10}$/),
      nameEn: nameEnSchema,
      nameAr: nameArSchema,
      /** Defaults to the tenant's. */
      timezone: timezoneSchema.optional(),
      taxInclusive: z.boolean().default(true),
    }),
    owner: z.object({
      email: z
        .email()
        .max(254)
        .transform((e) => e.toLowerCase()),
      displayName: z.string().trim().min(1).max(120),
      preferredLocale: localeSchema.optional(),
    }),
    entitlements: z.partialRecord(featureSchema, entitlementInputSchema).optional(),
  })
  .strict();
export type ProvisionTenantRequest = z.input<typeof provisionTenantSchema>;

export const provisionedTenantSchema = z.object({
  tenant: platformTenantDetailSchema,
  owner: z.object({
    id: idSchema,
    email: z.email(),
    /** Shown once: the owner signs in with it, then an administrator can reset it. Never stored. */
    temporaryPassword: z.string(),
  }),
});
export type ProvisionedTenantDto = z.infer<typeof provisionedTenantSchema>;

const reasonSchema = z.string().trim().min(5).max(500);

export const changeTenantStatusSchema = z.object({
  status: tenantStatusSchema,
  reason: reasonSchema,
});
export type ChangeTenantStatusRequest = z.input<typeof changeTenantStatusSchema>;

export const platformTenantUserSchema = z.object({
  id: idSchema,
  email: z.email(),
  displayName: z.string(),
  isActive: z.boolean(),
  lastLoginAt: isoDateTimeSchema.nullable(),
  roles: z.array(
    z.object({ roleName: z.string(), isSystem: z.boolean(), locationId: idSchema.nullable() }),
  ),
});
export type PlatformTenantUser = z.infer<typeof platformTenantUserSchema>;

export const platformDeviceSchema = adminDeviceSchema;

/** One module of a tenant: what the platform allows and what the tenant ends up with. */
export const platformModuleSchema = z.object({
  feature: featureSchema,
  entitled: z.boolean(),
  tenantConfigurable: z.boolean(),
  /** A platform decision is stored (otherwise: entitled and configurable by default). */
  explicit: z.boolean(),
  /** On by the business type's defaults. */
  businessTypeDefault: z.boolean(),
  /** On for the tenant as a whole, after its own overrides. */
  enabled: z.boolean(),
});
export type PlatformModule = z.infer<typeof platformModuleSchema>;

export const setEntitlementsSchema = z.object({
  entitlements: z
    .array(entitlementInputSchema.extend({ feature: featureSchema }))
    .min(1)
    .refine((list) => new Set(list.map((e) => e.feature)).size === list.length, {
      message: 'Duplicate module',
    }),
  reason: reasonSchema,
});
export type SetEntitlementsRequest = z.input<typeof setEntitlementsSchema>;

// --- Health -------------------------------------------------------------------------------------

export const platformErrorEventSchema = z.object({
  id: idSchema,
  createdAt: isoDateTimeSchema,
  service: z.string(),
  status: z.int(),
  code: z.string(),
  method: z.string(),
  route: z.string(),
  message: z.string(),
  suppressed: z.int(),
  tenantId: idSchema.nullable(),
  locationId: idSchema.nullable(),
  requestId: z.string().nullable(),
});
export type PlatformErrorEventDto = z.infer<typeof platformErrorEventSchema>;

export const platformErrorsQuerySchema = z.object({
  tenantId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type PlatformErrorsQuery = z.input<typeof platformErrorsQuerySchema>;

export const locationHealthSchema = z.object({
  locationId: idSchema,
  code: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
  /** The location's hubs with their reported outbox and version. */
  hubs: z.array(adminDeviceSchema),
  terminals: z.object({ online: z.int(), total: z.int() }),
  /** What the hubs last reported waiting in their outboxes. */
  pendingOperations: z.int(),
  failedOperations: z.int(),
  /** Changes the cloud refused and nobody settled yet (ADR 0014). */
  openIssues: z.int(),
  /** The last change the cloud received from the location. */
  lastSyncAt: isoDateTimeSchema.nullable(),
  /** The newest order at the location. */
  lastActivityAt: isoDateTimeSchema.nullable(),
});
export type LocationHealth = z.infer<typeof locationHealthSchema>;

export const tenantHealthSchema = z.object({
  tenantId: idSchema,
  status: tenantStatusSchema,
  generatedAt: isoDateTimeSchema,
  locations: z.array(locationHealthSchema),
  recentErrors: z.array(platformErrorEventSchema),
});
export type TenantHealth = z.infer<typeof tenantHealthSchema>;

export const healthBoardRowSchema = z.object({
  tenantId: idSchema,
  slug: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
  status: tenantStatusSchema,
  locations: z.int(),
  hubsOnline: z.int(),
  hubsTotal: z.int(),
  terminalsOnline: z.int(),
  terminalsTotal: z.int(),
  pendingOperations: z.int(),
  failedOperations: z.int(),
  openIssues: z.int(),
  lastSyncAt: isoDateTimeSchema.nullable(),
  lastActivityAt: isoDateTimeSchema.nullable(),
  /** Server errors in the last 24 hours. */
  errors24h: z.int(),
  /** The version the tenant's devices should run (its channel's newest release, or its pin). */
  targetVersion: z.string().nullable(),
  /** Active devices below the target, still served (ADR 0026). */
  outdatedDevices: z.int(),
  /** Active devices below the cloud's minimum: refused until updated. */
  unsupportedDevices: z.int(),
});
export type HealthBoardRow = z.infer<typeof healthBoardRowSchema>;

export const healthBoardSchema = z.object({
  generatedAt: isoDateTimeSchema,
  /** The MADAR version the cloud runs, and the oldest hub and app it serves (ADR 0026). */
  cloudVersion: z.string(),
  minimums: z.object({ hub: z.string().nullable(), client: z.string().nullable() }),
  tenants: z.array(healthBoardRowSchema),
  recentErrors: z.array(platformErrorEventSchema),
});
export type HealthBoard = z.infer<typeof healthBoardSchema>;

// --- Audit --------------------------------------------------------------------------------------

export const platformAuditQuerySchema = z.object({
  tenantId: idSchema.optional(),
  /** Exact action, or a prefix ending in `.` (e.g. `support.`). */
  action: z
    .string()
    .trim()
    .regex(/^[a-z_.]{1,80}$/)
    .optional(),
  actorId: idSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type PlatformAuditQuery = z.input<typeof platformAuditQuerySchema>;

export const platformAuditEntrySchema = z.object({
  id: idSchema,
  createdAt: isoDateTimeSchema,
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  actorId: idSchema.nullable(),
  /** The operator's display name, when still known. */
  actorName: z.string().nullable(),
  tenantId: idSchema.nullable(),
  requestId: z.string().nullable(),
  /** Redacted when written and again when read. */
  metadata: z.record(z.string(), z.unknown()),
});
export type PlatformAuditEntry = z.infer<typeof platformAuditEntrySchema>;
export const platformAuditPageSchema = paginated(platformAuditEntrySchema);

/** A tenant's own audit log, as the platform reads it (actor names include platform users). */
export const platformTenantAuditPageSchema = paginated(auditLogEntrySchema);

// --- Support tools ------------------------------------------------------------------------------

export const supportFindKindSchema = z.enum(enumValues(SupportFindKind));
export const supportOperationKeySchema = z.enum(enumValues(SupportOperationKey));

export const supportOperationSchema = z.object({
  key: supportOperationKeySchema,
  roles: z.array(platformRoleSchema),
});
export type SupportOperationDto = z.infer<typeof supportOperationSchema>;

export const supportFindQuerySchema = z.object({
  kind: supportFindKindSchema,
  /** An id, an order number, a phone, a name, a SKU or barcode, a provider reference. */
  q: z.string().trim().min(1).max(120),
});
export type SupportFindQuery = z.input<typeof supportFindQuerySchema>;

export const supportFindItemSchema = z.object({
  kind: supportFindKindSchema,
  id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  status: z.string().nullable(),
  locationId: idSchema.nullable(),
  createdAt: isoDateTimeSchema.nullable(),
  /** The record's support-relevant fields (no secrets, no password or PIN hashes). */
  data: z.record(z.string(), z.unknown()),
});
export type SupportFindItem = z.infer<typeof supportFindItemSchema>;

export const supportFindResultSchema = z.object({
  kind: supportFindKindSchema,
  items: z.array(supportFindItemSchema),
});
export type SupportFindResult = z.infer<typeof supportFindResultSchema>;

/** A repair and its target. Every parameter names a record of the tenant in the route. */
export const supportRequestSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal(SupportOperationKey.SYNC_RETRY),
    params: z.object({ operationId: idSchema }).strict(),
  }),
  z.object({
    operation: z.literal(SupportOperationKey.SYNC_REPROCESS),
    params: z.object({ operationId: idSchema }).strict(),
  }),
  z.object({
    operation: z.literal(SupportOperationKey.ORDER_STATUS),
    params: z.object({ orderId: idSchema, to: z.enum(enumValues(OrderStatus)) }).strict(),
  }),
  z.object({
    operation: z.literal(SupportOperationKey.ORDER_ITEM_PRODUCT),
    params: z
      .object({ orderItemId: idSchema, productId: idSchema, variantId: idSchema.nullable() })
      .strict(),
  }),
  z.object({
    operation: z.literal(SupportOperationKey.ORDER_TOTALS),
    params: z.object({ orderId: idSchema }).strict(),
  }),
  z.object({
    operation: z.literal(SupportOperationKey.RESTORE_ARCHIVED),
    params: z
      .object({ entityType: z.enum(enumValues(RestorableEntity)), entityId: idSchema })
      .strict(),
  }),
]);
export type SupportRequest = z.input<typeof supportRequestSchema>;
export type SupportRequestParsed = z.output<typeof supportRequestSchema>;

/** Executing a previewed repair: the preview's confirmation and why it is done. */
export const supportExecuteSchema = z.intersection(
  supportRequestSchema,
  z.object({
    confirmationToken: z.string().min(1).max(2048),
    reason: reasonSchema,
  }),
);
export type SupportExecuteRequest = z.input<typeof supportExecuteSchema>;

export const supportEntitySchema = z.object({
  type: z.string(),
  id: z.string(),
  label: z.string(),
  locationId: idSchema.nullable(),
});

export const supportChangeSchema = z.object({
  field: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});
export type SupportChange = z.infer<typeof supportChangeSchema>;

export const supportPreviewSchema = z.object({
  operation: supportOperationKeySchema,
  tenantId: idSchema,
  entity: supportEntitySchema,
  before: z.record(z.string(), z.unknown()),
  after: z.record(z.string(), z.unknown()),
  /** The fields that differ between before and after. */
  changes: z.array(supportChangeSchema),
  /** False: the preview only reports (a finalized order's totals, an unchanged record). */
  executable: z.boolean(),
  /** Why it cannot be executed (a machine-readable reason). */
  blockedReason: z.string().nullable(),
  /** Present when executable: send it back with the reason to execute, before it expires. */
  confirmation: z.object({ token: z.string(), expiresAt: isoDateTimeSchema }).nullable(),
});
export type SupportPreview = z.infer<typeof supportPreviewSchema>;

export const supportExecutionSchema = z.object({
  operation: supportOperationKeySchema,
  tenantId: idSchema,
  entity: supportEntitySchema,
  before: z.record(z.string(), z.unknown()),
  after: z.record(z.string(), z.unknown()),
  changes: z.array(supportChangeSchema),
  reason: z.string(),
  executedAt: isoDateTimeSchema,
});
export type SupportExecution = z.infer<typeof supportExecutionSchema>;

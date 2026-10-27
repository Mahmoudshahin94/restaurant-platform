import {
  ActionSource,
  ActorType,
  DeviceStatus,
  DeviceType,
  OnlineOrderingState,
  OrderChannel,
  OrderStatus,
  PaymentMethodType,
  PaymentRecordStatus,
  PaymentStatus,
  PaymentTransactionType,
  SyncIssueResolution,
  enumValues,
} from '@pos/shared-types';
import { z } from 'zod';
import { permissionSchema } from './auth';
import {
  idSchema,
  isoDateTimeSchema,
  localeSchema,
  nameArSchema,
  nameEnSchema,
  paginated,
} from './common';
import { onlineOrderingReasonSchema } from './online-ordering';
import { syncOrderSchema } from './sync';

/*
 * Admin portal (Phase 8): staff and roles, payment setup, dashboard, searches across locations,
 * audit log and synchronization issues. Cloud only; every route enforces its permission.
 */

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};
const isoDate = z.iso.date();
/** Comma-separated enum values in a query string, e.g. `PLACED,CONFIRMED`. */
const csv = <const T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined;
      const parsed = z.array(z.enum(values)).safeParse(v.split(',').map((s) => s.trim()));
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', message: 'Unknown value' });
        return z.NEVER;
      }
      return parsed.data;
    });

// --- Users ---------------------------------------------------------------------------------------

/** Passwords set by an administrator: long enough to resist guessing, never logged or returned. */
export const newPasswordSchema = z.string().min(10).max(256);

export const roleAssignmentInputSchema = z.object({
  roleId: idSchema,
  /** null = tenant-wide. */
  locationId: idSchema.nullable(),
});
export type RoleAssignmentInput = z.infer<typeof roleAssignmentInputSchema>;

const assignmentsSchema = z
  .array(roleAssignmentInputSchema)
  .max(50)
  .refine(
    (list) => new Set(list.map((a) => `${a.roleId}:${a.locationId ?? '*'}`)).size === list.length,
    { message: 'Duplicate role assignment' },
  );

export const staffUserSchema = z.object({
  id: idSchema,
  email: z.string(),
  displayName: z.string(),
  preferredLocale: localeSchema,
  isActive: z.boolean(),
  lastLoginAt: isoDateTimeSchema.nullable(),
  roles: z.array(
    z.object({ roleId: idSchema, roleName: z.string(), locationId: idSchema.nullable() }),
  ),
  employee: z.object({ id: idSchema, employeeCode: z.string() }).nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type StaffUser = z.infer<typeof staffUserSchema>;

export const createUserSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  displayName: z.string().trim().min(1).max(120),
  preferredLocale: localeSchema.default('en'),
  password: newPasswordSchema,
  roles: assignmentsSchema.default([]),
});
export type CreateUserRequest = z.input<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    preferredLocale: localeSchema,
    /** false signs the user out everywhere (refresh tokens revoked). */
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateUserRequest = z.infer<typeof updateUserSchema>;

export const setUserRolesSchema = z.object({ roles: assignmentsSchema });
export type SetUserRolesRequest = z.infer<typeof setUserRolesSchema>;

export const resetPasswordSchema = z.object({ password: newPasswordSchema });
export type ResetPasswordRequest = z.infer<typeof resetPasswordSchema>;

// --- Roles ---------------------------------------------------------------------------------------

export const roleSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  /** System roles (Owner) hold every permission and cannot be changed or deleted. */
  isSystem: z.boolean(),
  permissions: z.array(permissionSchema),
  userCount: z.int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Role = z.infer<typeof roleSchema>;

const permissionListSchema = z
  .array(permissionSchema)
  .max(100)
  .transform((list) => [...new Set(list)]);

export const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).nullable().default(null),
  permissions: permissionListSchema,
});
export type CreateRoleRequest = z.input<typeof createRoleSchema>;

export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(300).nullable(),
    permissions: permissionListSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateRoleRequest = z.input<typeof updateRoleSchema>;

// --- Employees -----------------------------------------------------------------------------------

export const employeeCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{1,20}$/);
/** POS PINs: 4–8 digits, stored as an argon2id hash only. */
export const pinSchema = z.string().regex(/^\d{4,8}$/);

export const employeeSchema = z.object({
  id: idSchema,
  employeeCode: z.string(),
  displayName: z.string(),
  homeLocationId: idSchema.nullable(),
  /** The user whose roles the employee signs in with at the POS; without one, no PIN sign-in. */
  userId: idSchema.nullable(),
  userEmail: z.string().nullable(),
  hasPin: z.boolean(),
  isActive: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Employee = z.infer<typeof employeeSchema>;

export const createEmployeeSchema = z.object({
  employeeCode: employeeCodeSchema,
  displayName: z.string().trim().min(1).max(120),
  homeLocationId: idSchema.nullable().default(null),
  userId: idSchema.nullable().default(null),
  pin: pinSchema.optional(),
});
export type CreateEmployeeRequest = z.input<typeof createEmployeeSchema>;

export const updateEmployeeSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    homeLocationId: idSchema.nullable(),
    userId: idSchema.nullable(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateEmployeeRequest = z.infer<typeof updateEmployeeSchema>;

export const setPinSchema = z.object({ pin: pinSchema });
export type SetPinRequest = z.infer<typeof setPinSchema>;

// --- Payment setup -------------------------------------------------------------------------------

export const paymentMethodAdminSchema = z.object({
  id: idSchema,
  type: z.enum(enumValues(PaymentMethodType)),
  nameEn: z.string(),
  nameAr: z.string(),
  sortOrder: z.int(),
  /**
   * The provider account that takes this tender's payments (ADR 0024): website and kiosk payments
   * are recorded under the tender linked to the account that took them.
   */
  providerAccountId: idSchema.nullable(),
  archivedAt: isoDateTimeSchema.nullable(),
});
export type PaymentMethodAdmin = z.infer<typeof paymentMethodAdminSchema>;

export const createPaymentMethodSchema = z.object({
  type: z.enum(enumValues(PaymentMethodType)),
  nameEn: nameEnSchema,
  nameAr: nameArSchema,
  sortOrder: z.int().min(0).max(10_000).default(0),
  providerAccountId: idSchema.nullable().default(null),
});
export type CreatePaymentMethodRequest = z.input<typeof createPaymentMethodSchema>;

/**
 * The type is fixed once created: recorded payments snapshot it. Fields are optional without
 * defaults, so an edit changes only what it names (a default would reset the order or unlink the
 * provider account).
 */
export const updatePaymentMethodSchema = z
  .object({
    nameEn: nameEnSchema.optional(),
    nameAr: nameArSchema.optional(),
    sortOrder: z.int().min(0).max(10_000).optional(),
    providerAccountId: idSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'No fields to update',
  });
export type UpdatePaymentMethodRequest = z.input<typeof updatePaymentMethodSchema>;

export const cashRegisterAdminSchema = z.object({
  id: idSchema,
  locationId: idSchema,
  nameEn: z.string(),
  nameAr: z.string(),
  openShiftId: idSchema.nullable(),
  archivedAt: isoDateTimeSchema.nullable(),
});
export type CashRegisterAdmin = z.infer<typeof cashRegisterAdminSchema>;

export const createCashRegisterSchema = z.object({ nameEn: nameEnSchema, nameAr: nameArSchema });
export type CreateCashRegisterRequest = z.input<typeof createCashRegisterSchema>;
export const updateCashRegisterSchema = createCashRegisterSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateCashRegisterRequest = z.input<typeof updateCashRegisterSchema>;

// --- Devices and hub status ----------------------------------------------------------------------

/** The hub's outbox as it last reported it with a push. */
export const reportedOutboxSchema = z.object({
  pending: z.int(),
  failed: z.int(),
  reportedAt: isoDateTimeSchema,
});

export const adminDeviceSchema = z.object({
  id: idSchema,
  locationId: idSchema,
  name: z.string(),
  type: z.enum(enumValues(DeviceType)),
  status: z.enum(enumValues(DeviceStatus)),
  pairedAt: isoDateTimeSchema.nullable(),
  /** A terminal waiting to pair: when its pairing code stops working (ADR 0022). */
  pairingExpiresAt: isoDateTimeSchema.nullable(),
  lastSeenAt: isoDateTimeSchema.nullable(),
  appVersion: z.string().nullable(),
  /** Seen within the heartbeat window (3 minutes). */
  online: z.boolean(),
  outbox: reportedOutboxSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type AdminDevice = z.infer<typeof adminDeviceSchema>;

export const locationSyncStatusSchema = z.object({
  locationId: idSchema,
  /** Paired hubs of the location, newest first. */
  hubs: z.array(adminDeviceSchema),
  openIssues: z.int(),
  /** Last operation the cloud received from this location (applied or refused). */
  lastReceivedAt: isoDateTimeSchema.nullable(),
});
export type LocationSyncStatus = z.infer<typeof locationSyncStatusSchema>;

// --- Dashboard -----------------------------------------------------------------------------------

export const dashboardLocationSchema = z.object({
  locationId: idSchema,
  code: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
  timezone: z.string(),
  isActive: z.boolean(),
  /** Today in the location's timezone. */
  businessDate: isoDate,
  orders: z.object({ count: z.int(), open: z.int(), cancelled: z.int() }),
  /** Totals of today's orders that were not cancelled (minor units). */
  sales: z.object({ total: z.int(), paid: z.int() }),
  openShifts: z.int(),
  onlineOrdering: z.object({
    state: z.enum(enumValues(OnlineOrderingState)),
    reason: onlineOrderingReasonSchema,
  }),
  /** null when the caller may not see synchronization (`sync.view`) at this location. */
  sync: z
    .object({
      hub: z.enum(['NOT_PAIRED', 'ONLINE', 'OFFLINE', 'DISABLED']),
      lastSeenAt: isoDateTimeSchema.nullable(),
      pending: z.int().nullable(),
      failed: z.int().nullable(),
      openIssues: z.int(),
    })
    .nullable(),
});
export type DashboardLocation = z.infer<typeof dashboardLocationSchema>;

export const dashboardSchema = z.object({
  currencyCode: z.string(),
  generatedAt: isoDateTimeSchema,
  locations: z.array(dashboardLocationSchema),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

// --- Order search --------------------------------------------------------------------------------

export const orderSearchQuerySchema = z
  .object({
    locationId: idSchema.optional(),
    /** Business dates (YYYY-MM-DD, location timezone), inclusive. */
    from: isoDate.optional(),
    to: isoDate.optional(),
    status: csv(enumValues(OrderStatus)),
    channel: csv(enumValues(OrderChannel)),
    paymentStatus: csv(enumValues(PaymentStatus)),
    /** Order number, customer name or phone (contains, case-insensitive). */
    search: z.string().trim().min(1).max(80).optional(),
    ...pageQuery,
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'from must not be after to',
    path: ['to'],
  });
export type OrderSearchQuery = z.input<typeof orderSearchQuerySchema>;

export const orderSummarySchema = z.object({
  id: idSchema,
  locationId: idSchema,
  orderNumber: z.string(),
  businessDate: isoDate,
  channel: z.enum(enumValues(OrderChannel)),
  status: z.enum(enumValues(OrderStatus)),
  paymentStatus: z.enum(enumValues(PaymentStatus)),
  customerName: z.string().nullable(),
  customerPhone: z.string().nullable(),
  itemCount: z.int(),
  total: z.int(),
  currencyCode: z.string(),
  createdAt: isoDateTimeSchema,
});
export type OrderSummary = z.infer<typeof orderSummarySchema>;
export const orderSummaryPageSchema = paginated(orderSummarySchema);

// --- Customers (derived from order contact details; there are no customer accounts yet) ----------

export const customerQuerySchema = z.object({
  search: z.string().trim().min(1).max(80).optional(),
  ...pageQuery,
});
export type CustomerQuery = z.input<typeof customerQuerySchema>;

export const customerSummarySchema = z.object({
  /** Opaque key (a hash of the phone number), so no personal data travels in URLs. */
  key: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().nullable(),
  phone: z.string(),
  email: z.string().nullable(),
  orderCount: z.int(),
  /** Sum of the totals of orders that were not cancelled. */
  totalSpent: z.int(),
  firstOrderAt: isoDateTimeSchema,
  lastOrderAt: isoDateTimeSchema,
});
export type CustomerSummary = z.infer<typeof customerSummarySchema>;
export const customerPageSchema = paginated(customerSummarySchema);

export const customerDetailSchema = z.object({
  customer: customerSummarySchema,
  orders: z.array(orderSummarySchema),
});
export type CustomerDetail = z.infer<typeof customerDetailSchema>;

// --- Payments ------------------------------------------------------------------------------------

export const paymentSearchQuerySchema = z
  .object({
    locationId: idSchema.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    type: z.enum(enumValues(PaymentTransactionType)).optional(),
    methodType: z.enum(enumValues(PaymentMethodType)).optional(),
    ...pageQuery,
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'from must not be after to',
    path: ['to'],
  });
export type PaymentSearchQuery = z.input<typeof paymentSearchQuerySchema>;

export const paymentListItemSchema = z.object({
  id: idSchema,
  locationId: idSchema,
  orderId: idSchema,
  orderNumber: z.string(),
  type: z.enum(enumValues(PaymentTransactionType)),
  status: z.enum(enumValues(PaymentRecordStatus)),
  methodType: z.enum(enumValues(PaymentMethodType)),
  methodNameEn: z.string(),
  methodNameAr: z.string(),
  amount: z.int(),
  reference: z.string().nullable(),
  reason: z.string().nullable(),
  refundOfId: idSchema.nullable(),
  /** Charges: what can still be refunded. */
  refundable: z.int(),
  currencyCode: z.string(),
  createdAt: isoDateTimeSchema,
});
export type PaymentListItem = z.infer<typeof paymentListItemSchema>;
export const paymentPageSchema = paginated(paymentListItemSchema);

/**
 * Refund from the admin portal: online card charges only, through the provider and without a
 * drawer. Cash and card-terminal refunds are made at the till, where the drawer is (ADR 0014).
 */
export const adminRefundSchema = z.object({
  /** Client-generated id of the refund: the idempotency key. */
  id: idSchema,
  amount: z.int().min(1).max(1_000_000_000),
  reason: z.string().trim().min(1).max(300),
});
export type AdminRefundRequest = z.infer<typeof adminRefundSchema>;

// --- Audit log -----------------------------------------------------------------------------------

export const auditLogQuerySchema = z
  .object({
    /** Exact action, or a prefix ending in `.` (e.g. `order.`). */
    action: z
      .string()
      .trim()
      .regex(/^[a-z_.]{1,80}$/)
      .optional(),
    entityType: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{1,40}$/)
      .optional(),
    entityId: z.string().trim().min(1).max(64).optional(),
    actorId: idSchema.optional(),
    locationId: idSchema.optional(),
    source: z.enum(enumValues(ActionSource)).optional(),
    /** Inclusive UTC dates. */
    from: isoDate.optional(),
    to: isoDate.optional(),
    ...pageQuery,
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'from must not be after to',
    path: ['to'],
  });
export type AuditLogQuery = z.input<typeof auditLogQuerySchema>;

export const auditLogEntrySchema = z.object({
  id: idSchema,
  createdAt: isoDateTimeSchema,
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  actorType: z.enum(enumValues(ActorType)),
  actorId: idSchema.nullable(),
  /** The user's or employee's display name, when the actor is still known. */
  actorName: z.string().nullable(),
  source: z.enum(enumValues(ActionSource)).nullable(),
  locationId: idSchema.nullable(),
  requestId: z.string().nullable(),
  /** Redacted when written and again when read: secrets never appear here. */
  metadata: z.record(z.string(), z.unknown()),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
export const auditLogPageSchema = paginated(auditLogEntrySchema);

// --- Synchronization issues (ADR 0014) -----------------------------------------------------------

export const syncIssueResolutionSchema = z.enum(enumValues(SyncIssueResolution));

export const syncIssuesQuerySchema = z.object({
  state: z.enum(['open', 'resolved', 'all']).default('open'),
});
export type SyncIssuesQuery = z.input<typeof syncIssuesQuerySchema>;

export const resolveSyncIssueSchema = z.object({
  /**
   * APPLY_HUB: store the hub's version (the cloud's copy goes to the audit log first).
   * KEEP_CLOUD: keep the cloud's version; the hub replaces its copy (orders only).
   * RESEND: ask the hub to send the change again (after its cause was fixed elsewhere).
   */
  action: z.enum(['APPLY_HUB', 'KEEP_CLOUD', 'RESEND']),
  note: z.string().trim().min(3).max(500),
});
export type ResolveSyncIssueRequest = z.infer<typeof resolveSyncIssueSchema>;

export const adminSyncIssueSchema = z.object({
  operationId: idSchema,
  deviceId: idSchema,
  entityType: z.string(),
  entityId: idSchema,
  operationType: z.string(),
  entityVersion: z.int(),
  /** The current ledger state: APPLIED once an administrator applied the hub's version. */
  status: z.enum(['APPLIED', 'CONFLICT', 'REJECTED']),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  attempts: z.int(),
  /** Order number of the hub's copy, when known. */
  label: z.string().nullable(),
  hasPayload: z.boolean(),
  resolution: syncIssueResolutionSchema.nullable(),
  resolvedAt: isoDateTimeSchema.nullable(),
  resolvedBy: z.string().nullable(),
  resolutionNote: z.string().nullable(),
  resendRequestedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type AdminSyncIssue = z.infer<typeof adminSyncIssueSchema>;

/** A side of a conflict, summarised for comparison (both copies of the same aggregate). */
export const syncEntityVersionSchema = z.object({
  label: z.string().nullable(),
  status: z.string().nullable(),
  paymentStatus: z.string().nullable(),
  total: z.int().nullable(),
  itemCount: z.int().nullable(),
  paymentCount: z.int().nullable(),
  paidTotal: z.int().nullable(),
  version: z.int().nullable(),
  updatedAt: isoDateTimeSchema.nullable(),
  /** The full aggregate (no secrets: outbox payloads never contain card data or credentials). */
  data: z.record(z.string(), z.unknown()),
});
export type SyncEntityVersion = z.infer<typeof syncEntityVersionSchema>;

export const syncIssueDetailSchema = z.object({
  issue: adminSyncIssueSchema,
  hubVersion: syncEntityVersionSchema.nullable(),
  cloudVersion: syncEntityVersionSchema.nullable(),
  /** Which actions are possible now, and why not otherwise (a reason code). */
  options: z.object({
    applyHub: z.object({ allowed: z.boolean(), reason: z.string().nullable() }),
    keepCloud: z.object({ allowed: z.boolean(), reason: z.string().nullable() }),
    resend: z.object({ allowed: z.boolean(), reason: z.string().nullable() }),
  }),
});
export type SyncIssueDetail = z.infer<typeof syncIssueDetailSchema>;

/** The decision the hub fetches after a `RESOLUTION` change (device credential). */
export const syncResolutionSchema = z.object({
  operationId: idSchema,
  entityType: z.string(),
  entityId: idSchema,
  /** RESEND: put the failed operations of the entity back in the queue. ADOPT_CLOUD: take `order`. */
  action: z.enum(['RESEND', 'ADOPT_CLOUD']),
  order: syncOrderSchema.nullable(),
});
export type SyncResolution = z.infer<typeof syncResolutionSchema>;

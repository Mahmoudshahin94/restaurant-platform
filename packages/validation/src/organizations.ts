import { z } from 'zod';
import { newPasswordSchema } from './admin';
import { accountEmailSchema, organizationRoleSchema } from './auth';
import { idSchema, isoDateTimeSchema } from './common';

/**
 * Adds a member to an organization (`POST /organizations/:id/members`, Owner only). An e-mail that
 * already has an account is that person (the password is then ignored: they keep their own);
 * otherwise `password` is the new account's starting password and is required.
 */
export const addMemberSchema = z.object({
  email: accountEmailSchema,
  displayName: z.string().trim().min(1).max(120),
  role: organizationRoleSchema,
  password: newPasswordSchema.optional(),
});
export type AddMemberRequest = z.input<typeof addMemberSchema>;

export const changeMemberRoleSchema = z.object({ role: organizationRoleSchema });
export type ChangeMemberRoleRequest = z.infer<typeof changeMemberRoleSchema>;

/** A member of an organization, with the login they use. */
export const memberSchema = z.object({
  id: idSchema,
  accountId: idSchema,
  email: z.string(),
  displayName: z.string(),
  role: organizationRoleSchema,
  createdAt: isoDateTimeSchema,
});
export type MemberDto = z.infer<typeof memberSchema>;

/**
 * A member after adding or a role change, with the brands where they got no linked user: the brand
 * had deactivated the person's own user (it links them once the brand reactivates it).
 */
export const linkedMemberSchema = memberSchema.extend({ skippedTenantIds: z.array(idSchema) });
export type LinkedMemberDto = z.infer<typeof linkedMemberSchema>;

// --- Overview and dashboard (E1 §4.2) ------------------------------------------------------------

const int = z.int();

/** An organization's brands with their branches (`GET /organizations/:id`). */
export const organizationOverviewSchema = z.object({
  organization: z.object({
    id: idSchema,
    slug: z.string(),
    nameEn: z.string(),
    nameAr: z.string(),
    currencyCode: z.string(),
    /** The caller's role in it. */
    role: organizationRoleSchema,
  }),
  /** Oldest first. */
  brands: z.array(
    z.object({
      id: idSchema,
      nameEn: z.string(),
      nameAr: z.string(),
      logoFileId: idSchema.nullable(),
      locations: z.array(
        z.object({
          id: idSchema,
          code: z.string(),
          nameEn: z.string(),
          nameAr: z.string(),
          timezone: z.string(),
        }),
      ),
    }),
  ),
});
export type OrganizationOverview = z.infer<typeof organizationOverviewSchema>;

const periodFiguresSchema = z.object({
  /** Σ total of completed orders, minor units of the organization's currency. */
  salesTotal: int,
  orderCount: int,
  /** salesTotal / orderCount, rounded; 0 without orders. */
  averageTicket: int,
});
export type OrgDashboardPeriod = z.infer<typeof periodFiguresSchema>;

/**
 * The organization's dashboard. Each branch's periods end on its own business day (ADR 0015):
 * `today`, the last 7 and the last 30 days counting today. `byBrand`, `byLocation` and `daily`
 * cover the last 30 days; `daily` has one entry per day with every brand's sales (0 where none).
 */
export const orgDashboardSchema = z.object({
  currencyCode: z.string(),
  periods: z.object({
    today: periodFiguresSchema,
    last7: periodFiguresSchema,
    last30: periodFiguresSchema,
  }),
  byBrand: z.array(z.object({ tenantId: idSchema, salesTotal: int, orderCount: int })),
  byLocation: z.array(
    z.object({
      tenantId: idSchema,
      locationId: idSchema,
      salesTotal: int,
      orderCount: int,
      /** An active hub of the branch reported within the heartbeat window. */
      hubOnline: z.boolean(),
    }),
  ),
  daily: z.array(z.object({ date: z.iso.date(), byTenant: z.record(z.string(), int) })),
});
export type OrgDashboard = z.infer<typeof orgDashboardSchema>;

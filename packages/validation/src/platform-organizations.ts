import { OrganizationStatus, enumValues } from '@pos/shared-types';
import { z } from 'zod';
import { newPasswordSchema } from './admin';
import { accountEmailSchema } from './auth';
import {
  currencyCodeSchema,
  idSchema,
  isoDateTimeSchema,
  nameArSchema,
  nameEnSchema,
  paginated,
} from './common';
import { memberSchema } from './organizations';
import { tenantStatusSchema } from './tenancy';

/**
 * The platform admin's organizations (E1, spec §6): MADAR's operators create an organization
 * with its first owner, bring brands in and out and manage its members. Served under
 * `/platform/organizations` to platform tokens only.
 */

export const organizationStatusSchema = z.enum(enumValues(OrganizationStatus));

export const platformOrganizationsQuerySchema = z.object({
  /** Name (either language) or slug. */
  search: z.string().trim().max(120).optional(),
  status: organizationStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PlatformOrganizationsQuery = z.input<typeof platformOrganizationsQuerySchema>;

/**
 * A new organization with its first owner. An e-mail that already has an account is that person
 * (who keeps their own password); a new e-mail needs a starting password.
 */
export const createOrganizationSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(60),
    nameEn: nameEnSchema,
    nameAr: nameArSchema,
    /** Every brand of the organization uses it; fixed for its lifetime. */
    currencyCode: currencyCodeSchema,
    owner: z.object({
      email: accountEmailSchema,
      displayName: z.string().trim().min(1).max(120),
      password: newPasswordSchema.optional(),
    }),
  })
  .strict();
export type CreateOrganizationRequest = z.input<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z
  .object({
    nameEn: nameEnSchema.optional(),
    nameAr: nameArSchema.optional(),
    status: organizationStatusSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });
export type UpdateOrganizationRequest = z.input<typeof updateOrganizationSchema>;

export const attachOrganizationTenantSchema = z.object({ tenantId: idSchema }).strict();
export type AttachOrganizationTenantRequest = z.input<typeof attachOrganizationTenantSchema>;

export const platformOrganizationSummarySchema = z.object({
  id: idSchema,
  slug: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
  currencyCode: z.string(),
  status: organizationStatusSchema,
  createdAt: isoDateTimeSchema,
  brandCount: z.int(),
  memberCount: z.int(),
});
export type PlatformOrganizationSummary = z.infer<typeof platformOrganizationSummarySchema>;
export const platformOrganizationPageSchema = paginated(platformOrganizationSummarySchema);

export const platformOrganizationDetailSchema = platformOrganizationSummarySchema.extend({
  /** Oldest first. */
  brands: z.array(
    z.object({
      id: idSchema,
      slug: z.string(),
      nameEn: z.string(),
      nameAr: z.string(),
      status: tenantStatusSchema,
    }),
  ),
  members: z.array(memberSchema),
});
export type PlatformOrganizationDetail = z.infer<typeof platformOrganizationDetailSchema>;

/** The organization after a brand joined, with the members left without a user in it (see `skippedTenantIds`). */
export const platformOrganizationAttachedSchema = platformOrganizationDetailSchema.extend({
  skippedMemberIds: z.array(idSchema),
});
export type PlatformOrganizationAttached = z.infer<typeof platformOrganizationAttachedSchema>;

import { OrganizationRole, PERMISSIONS, enumValues } from '@pos/shared-types';
import { z } from 'zod';
import { idSchema, localeSchema } from './common';

export const permissionSchema = z.enum(PERMISSIONS);

/** Accounts store e-mails trimmed and lowercase, so ` Owner@Demo.Local` is the same person. */
export const accountEmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const organizationRoleSchema = z.enum(enumValues(OrganizationRole));

export const loginRequestSchema = z.object({
  email: accountEmailSchema,
  password: z.string().min(1).max(256),
  /**
   * The brand to sign into, for a person with users in several. Ignored when the account has no
   * usable user there (sign-in then picks the last brand, else the oldest).
   */
  tenantId: idSchema.optional(),
  /**
   * Browser apps receive the refresh token only as an httpOnly cookie. Native clients (the Tauri
   * POS / location hub) cannot rely on cookies and ask for it in the body instead.
   */
  client: z.enum(['web', 'native']).default('web'),
});
export type LoginRequest = z.input<typeof loginRequestSchema>;

/** Staff PIN sign-in at the location hub (never offered by the internet-facing cloud). */
export const pinLoginRequestSchema = z.object({
  employeeCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,20}$/),
  pin: z.string().regex(/^\d{4,8}$/),
  client: z.enum(['web', 'native']).default('native'),
});
export type PinLoginRequest = z.input<typeof pinLoginRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1).max(512).optional(),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

/**
 * Switching to another brand of the signed-in person's account. A native client names its refresh
 * token here; a browser's comes with the cookie.
 */
export const switchSchema = z.object({
  tenantId: idSchema,
  refreshToken: z.string().min(1).max(512).optional(),
});
export type SwitchRequest = z.infer<typeof switchSchema>;

export const roleAssignmentDtoSchema = z.object({
  roleId: idSchema,
  roleName: z.string(),
  locationId: idSchema.nullable(),
  permissions: z.array(permissionSchema),
});
export type RoleAssignmentDto = z.infer<typeof roleAssignmentDtoSchema>;

/** A brand the signed-in person can work in (one entry per usable user of their account). */
export const authBrandSchema = z.object({
  id: idSchema,
  nameEn: z.string(),
  nameAr: z.string(),
  logoFileId: idSchema.nullable(),
  organizationId: idSchema.nullable(),
});
export type AuthBrand = z.infer<typeof authBrandSchema>;

/** An organization the signed-in person is a member of, with their role in it. */
export const authOrganizationSchema = z.object({
  id: idSchema,
  nameEn: z.string(),
  nameAr: z.string(),
  role: organizationRoleSchema,
});
export type AuthOrganization = z.infer<typeof authOrganizationSchema>;

export const authUserSchema = z.object({
  id: idSchema,
  /** The person's login, shared by their users in every brand. */
  accountId: idSchema,
  email: z.email(),
  displayName: z.string(),
  preferredLocale: localeSchema,
  tenantId: idSchema,
  roles: z.array(roleAssignmentDtoSchema),
  tenants: z.array(authBrandSchema),
  organizations: z.array(authOrganizationSchema),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const tokenResponseSchema = z.object({
  accessToken: z.string(),
  /** Seconds until the access token expires. */
  expiresIn: z.int(),
  /** Present only for `client: 'native'`. */
  refreshToken: z.string().optional(),
  user: authUserSchema,
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

import { PERMISSIONS } from '@pos/shared-types';
import { z } from 'zod';
import { idSchema, localeSchema } from './common';

export const permissionSchema = z.enum(PERMISSIONS);

export const loginRequestSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(256),
  /**
   * Browser apps receive the refresh token only as an httpOnly cookie. Native clients (the Tauri
   * POS / location hub) cannot rely on cookies and ask for it in the body instead.
   */
  client: z.enum(['web', 'native']).default('web'),
});
export type LoginRequest = z.input<typeof loginRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1).max(512).optional(),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const roleAssignmentDtoSchema = z.object({
  roleId: idSchema,
  roleName: z.string(),
  locationId: idSchema.nullable(),
  permissions: z.array(permissionSchema),
});
export type RoleAssignmentDto = z.infer<typeof roleAssignmentDtoSchema>;

export const authUserSchema = z.object({
  id: idSchema,
  email: z.email(),
  displayName: z.string(),
  preferredLocale: localeSchema,
  restaurantId: idSchema,
  roles: z.array(roleAssignmentDtoSchema),
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

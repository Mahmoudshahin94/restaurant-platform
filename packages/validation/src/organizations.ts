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

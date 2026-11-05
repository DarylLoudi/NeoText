import { z } from 'zod';
import { InstanceModeSchema, RegistrationPolicySchema } from './auth';
import { QuotaSchema } from './quotas';

export const UserRoleSchema = z.enum(['admin', 'member']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserStatusSchema = z.enum(['active', 'disabled']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

/** A user as the admin sees them: no keys, no content, only this month's known spend. */
export const AdminUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  role: UserRoleSchema,
  status: UserStatusSchema,
  createdAt: z.number(),
  /** The latest activity of any of their sessions; null when they have none. */
  lastSeenAt: z.number().nullable(),
  /** Known cost this UTC month; calls with an unknown cost add nothing. */
  monthCostUsd: z.number(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const AdminUserListResponseSchema = z.object({ users: z.array(AdminUserSchema) });
export type AdminUserListResponse = z.infer<typeof AdminUserListResponseSchema>;

export const AdminUserResponseSchema = z.object({ user: AdminUserSchema });
export type AdminUserResponse = z.infer<typeof AdminUserResponseSchema>;

export const UpdateAdminUserBodySchema = z.object({
  role: UserRoleSchema.optional(),
  status: UserStatusSchema.optional(),
});
export type UpdateAdminUserBody = z.infer<typeof UpdateAdminUserBodySchema>;

export const AdminInstanceSchema = z.object({
  mode: InstanceModeSchema,
  registration: RegistrationPolicySchema,
  /** On: the server keeps a copy of each user's key, so an admin can reset passwords. */
  escrow: z.boolean(),
  /** What members may spend on shared providers unless they have their own limit; null: no limit. */
  defaultQuota: QuotaSchema.nullable(),
});
export type AdminInstance = z.infer<typeof AdminInstanceSchema>;

export const UpdateAdminInstanceBodySchema = AdminInstanceSchema.partial();
export type UpdateAdminInstanceBody = z.infer<typeof UpdateAdminInstanceBodySchema>;

/** Shown to the admin once; never stored or logged. */
export const ResetPasswordResponseSchema = z.object({ temporaryPassword: z.string() });
export type ResetPasswordResponse = z.infer<typeof ResetPasswordResponseSchema>;

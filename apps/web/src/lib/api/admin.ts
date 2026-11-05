import {
  type AdminInstance,
  AdminInstanceSchema,
  type AdminUser,
  AdminUserListResponseSchema,
  AdminUserResponseSchema,
  type CreateInviteBody,
  type CreateInviteResponse,
  CreateInviteResponseSchema,
  InviteListResponseSchema,
  type InvitePublic,
  ResetPasswordResponseSchema,
  type UpdateAdminInstanceBody,
  type UpdateAdminUserBody,
} from '@neotext/shared';
import { apiFetch } from './client';

const user = (id: string) => `/admin/users/${encodeURIComponent(id)}`;

/** Admin-only endpoints; a member gets 403 from each. */
export const adminApi = {
  /** Unwraps `{ users }`. */
  users: async (): Promise<AdminUser[]> =>
    (await apiFetch('/admin/users', { schema: AdminUserListResponseSchema })).users,
  /** Unwraps `{ user }`. */
  updateUser: async (id: string, body: UpdateAdminUserBody): Promise<AdminUser> =>
    (await apiFetch(user(id), { method: 'PATCH', body, schema: AdminUserResponseSchema })).user,
  /** The temporary password; the server keeps no copy, so this is the only time it exists. */
  resetPassword: async (id: string): Promise<string> =>
    (
      await apiFetch(`${user(id)}/reset-password`, {
        method: 'POST',
        schema: ResetPasswordResponseSchema,
      })
    ).temporaryPassword,
  /** Unwraps `{ invites }`. */
  invites: async (): Promise<InvitePublic[]> =>
    (await apiFetch('/admin/invites', { schema: InviteListResponseSchema })).invites,
  createInvite: (body: CreateInviteBody): Promise<CreateInviteResponse> =>
    apiFetch('/admin/invites', { method: 'POST', body, schema: CreateInviteResponseSchema }),
  revokeInvite: (id: string): Promise<void> =>
    apiFetch(`/admin/invites/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  instance: (): Promise<AdminInstance> =>
    apiFetch('/admin/instance', { schema: AdminInstanceSchema }),
  updateInstance: (body: UpdateAdminInstanceBody): Promise<AdminInstance> =>
    apiFetch('/admin/instance', { method: 'PATCH', body, schema: AdminInstanceSchema }),
};

import {
  type ChangePasswordBody,
  type InstanceInfo,
  InstanceInfoSchema,
  type LoginBody,
  MeResponseSchema,
  type PublicUser,
  type RecoverBody,
  RecoverResponseSchema,
  RecoveryKeyResponseSchema,
  type RegisterBody,
  RegisterResponseSchema,
  type RotateRecoveryKeyBody,
  type SessionInfo,
  SessionListResponseSchema,
  type SetupBody,
  SetupResponseSchema,
} from '@neotext/shared';
import { apiFetch } from './client';

export interface UserWithKey {
  user: PublicUser;
  recoveryKey: string;
}

export const authApi = {
  instance: (): Promise<InstanceInfo> => apiFetch('/instance', { schema: InstanceInfoSchema }),
  setup: (body: SetupBody): Promise<UserWithKey> =>
    apiFetch('/setup', { method: 'POST', body, schema: SetupResponseSchema }),
  register: (body: RegisterBody): Promise<UserWithKey> =>
    apiFetch('/auth/register', { method: 'POST', body, schema: RegisterResponseSchema }),
  /** Unwraps `{ user }`. */
  login: async (body: LoginBody): Promise<PublicUser> =>
    (await apiFetch('/auth/login', { method: 'POST', body, schema: MeResponseSchema })).user,
  logout: (): Promise<void> => apiFetch('/auth/logout', { method: 'POST' }),
  /** Unwraps `{ user }`. */
  me: async (): Promise<PublicUser> =>
    (await apiFetch('/auth/me', { schema: MeResponseSchema })).user,
  changePassword: (body: ChangePasswordBody): Promise<void> =>
    apiFetch('/auth/password', { method: 'POST', body }),
  recover: (body: RecoverBody): Promise<UserWithKey> =>
    apiFetch('/auth/recover', { method: 'POST', body, schema: RecoverResponseSchema }),
  /** Unwraps `{ items }`. */
  sessions: async (): Promise<SessionInfo[]> =>
    (await apiFetch('/auth/sessions', { schema: SessionListResponseSchema })).items,
  revokeSession: (id: string): Promise<void> =>
    apiFetch(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  revokeOtherSessions: (): Promise<void> =>
    apiFetch('/auth/sessions/revoke-others', { method: 'POST' }),
  /** Unwraps `{ recoveryKey }` to the key string. */
  rotateRecoveryKey: async (body: RotateRecoveryKeyBody): Promise<string> =>
    (
      await apiFetch('/auth/recovery-key', {
        method: 'POST',
        body,
        schema: RecoveryKeyResponseSchema,
      })
    ).recoveryKey,
};

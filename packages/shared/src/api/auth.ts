import { z } from 'zod';

export const PublicUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  role: z.enum(['admin', 'member']),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const InstanceModeSchema = z.enum(['personal', 'community']);
export type InstanceMode = z.infer<typeof InstanceModeSchema>;

export const RegistrationPolicySchema = z.enum(['closed', 'invite', 'open']);
export type RegistrationPolicy = z.infer<typeof RegistrationPolicySchema>;

export const InstanceInfoSchema = z.object({
  setupRequired: z.boolean(),
  mode: InstanceModeSchema.nullable(),
  registration: RegistrationPolicySchema.nullable(),
  version: z.string(),
  envProviderAvailable: z.boolean(),
  /** On: an admin can reset passwords, so sign-up and Security say so. */
  escrow: z.boolean(),
});
export type InstanceInfo = z.infer<typeof InstanceInfoSchema>;

export const SetupBodySchema = z.object({
  username: z.string(),
  password: z.string(),
  displayName: z.string().optional(),
  mode: InstanceModeSchema,
  useEnvProvider: z.boolean().optional(),
});
export type SetupBody = z.infer<typeof SetupBodySchema>;

export const LoginBodySchema = z.object({ username: z.string(), password: z.string() });
export type LoginBody = z.infer<typeof LoginBodySchema>;

export const ChangePasswordBodySchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string(),
});
export type ChangePasswordBody = z.infer<typeof ChangePasswordBodySchema>;

export const RecoverBodySchema = z.object({
  username: z.string(),
  recoveryKey: z.string(),
  newPassword: z.string(),
});
export type RecoverBody = z.infer<typeof RecoverBodySchema>;

export const RotateRecoveryKeyBodySchema = z.object({ password: z.string() });
export type RotateRecoveryKeyBody = z.infer<typeof RotateRecoveryKeyBodySchema>;

export const SetupResponseSchema = z.object({ user: PublicUserSchema, recoveryKey: z.string() });
export type SetupResponse = z.infer<typeof SetupResponseSchema>;

export const MeResponseSchema = z.object({ user: PublicUserSchema });
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const RecoverResponseSchema = z.object({ user: PublicUserSchema, recoveryKey: z.string() });
export type RecoverResponse = z.infer<typeof RecoverResponseSchema>;

export const RecoveryKeyResponseSchema = z.object({ recoveryKey: z.string() });
export type RecoveryKeyResponse = z.infer<typeof RecoveryKeyResponseSchema>;

export const RegisterBodySchema = z.object({
  username: z.string(),
  password: z.string(),
  displayName: z.string().optional(),
  inviteCode: z.string().optional(),
});
export type RegisterBody = z.infer<typeof RegisterBodySchema>;

export const RegisterResponseSchema = z.object({ user: PublicUserSchema, recoveryKey: z.string() });
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;

/** An invite as the admin sees it. The code itself is shown once, on creation, and never again. */
export const InvitePublicSchema = z.object({
  id: z.string(),
  role: z.enum(['admin', 'member']),
  expiresAt: z.number(),
  usedBy: z.string().nullable(),
  /** The username `usedBy` resolves to, for the admin's list. */
  usedByUsername: z.string().nullable(),
  usedAt: z.number().nullable(),
  createdAt: z.number(),
});
export type InvitePublic = z.infer<typeof InvitePublicSchema>;

export const CreateInviteBodySchema = z.object({
  role: z.enum(['admin', 'member']).default('member'),
  expiresInDays: z.number().int().min(1).max(90).default(14),
});
export type CreateInviteBody = z.infer<typeof CreateInviteBodySchema>;

export const CreateInviteResponseSchema = z.object({
  invite: InvitePublicSchema,
  code: z.string(),
});
export type CreateInviteResponse = z.infer<typeof CreateInviteResponseSchema>;

export const InviteListResponseSchema = z.object({ invites: z.array(InvitePublicSchema) });
export type InviteListResponse = z.infer<typeof InviteListResponseSchema>;

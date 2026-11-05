import { z } from 'zod';

/**
 * Every kind the server records. The server keeps the same list next to its writers; a server
 * test fails if the two drift, and the web checks that each kind has a label in every locale.
 */
export const AUDIT_KINDS = [
  'auth.setup',
  'auth.login.success',
  'auth.login.failure',
  'auth.logout',
  'auth.password.changed',
  'auth.recovery.used',
  'auth.recovery.rotated',
  'auth.registered',
  'session.revoked',
  'admin.invite.created',
  'admin.invite.revoked',
  'admin.user.updated',
  'admin.instance.updated',
  'admin.password.reset',
  'admin.quota.updated',
  'settings.restored',
  'settings.quarantined',
  'data.exported',
  'data.imported',
] as const;

/** A device signed in to the account, as its owner sees it. */
export const SessionInfoSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  lastSeenAt: z.number(),
  expiresAt: z.number(),
  userAgent: z.string().nullable(),
  /** The session making this request. */
  current: z.boolean(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

export const SessionListResponseSchema = z.object({ items: z.array(SessionInfoSchema) });
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;

/** Only plain facts: no secrets and no content are ever recorded, and the server filters keys. */
export const AuditDetailsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);
export type AuditDetails = z.infer<typeof AuditDetailsSchema>;

export const AuditEventSchema = z.object({
  id: z.string(),
  /** A string, not the enum: a newer server may send a kind this web does not know yet. */
  kind: z.string(),
  userId: z.string().nullable(),
  createdAt: z.number(),
  details: AuditDetailsSchema,
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_MAX_PAGE_SIZE = 100;

export const AuditQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(AUDIT_MAX_PAGE_SIZE).default(AUDIT_PAGE_SIZE),
  /** `1` asks for everyone's events (admin only). */
  all: z.enum(['1']).optional(),
  /** With `all`, narrows to one user. */
  userId: z.string().min(1).max(64).optional(),
});
export type AuditQuery = z.infer<typeof AuditQuerySchema>;

export const AuditListResponseSchema = z.object({
  items: z.array(AuditEventSchema),
  nextCursor: z.string().nullable(),
});
export type AuditListResponse = z.infer<typeof AuditListResponseSchema>;

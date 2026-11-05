import { type AuditDetails, type AuditEvent, newId } from '@neotext/shared';
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import type { DbHandle } from '../db/client';
import { auditEvents } from '../db/schema';
import { AppError } from '../http/errors';
import type { Clock } from '../lib/clock';

/** Kept in step with the list in `@neotext/shared`; a test fails if they drift. */
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

export type AuditKind = (typeof AUDIT_KINDS)[number];

/** The only meta keys a client ever sees; every writer stores plain facts under these. */
const SAFE_DETAIL_KEYS: ReadonlySet<string> = new Set([
  'targetId',
  'inviteId',
  'role',
  'status',
  'mode',
  'registration',
  'escrow',
  'via',
  'format',
  'source',
  'imported',
  'skipped',
  'failed',
  'error',
  'count',
  'version',
  'from',
  'to',
]);

export interface AuditQuery {
  /** Only this user's events; omitted means everyone's. */
  userId?: string;
  cursor?: string;
  limit: number;
}

export interface AuditLog {
  record(
    kind: AuditKind,
    userId: string | null,
    meta?: Record<string, string | number | boolean | null>,
  ): void;
  /** Newest first. Throws a 400 `AppError` for a cursor this log did not issue. */
  list(q: AuditQuery): { items: AuditEvent[]; nextCursor: string | null };
}

function safeDetails(meta: Record<string, unknown> | null): AuditDetails {
  const out: AuditDetails = {};
  for (const [key, value] of Object.entries(meta ?? {})) {
    if (!SAFE_DETAIL_KEYS.has(key)) continue;
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      out[key] = value;
    }
  }
  return out;
}

const encodeCursor = (createdAt: number, id: string) =>
  Buffer.from(JSON.stringify([createdAt, id])).toString('base64url');

function decodeCursor(cursor: string): { createdAt: number; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'number' &&
      typeof parsed[1] === 'string'
    ) {
      return { createdAt: parsed[0], id: parsed[1] };
    }
  } catch {
    // Falls through to the error below.
  }
  throw new AppError(
    'bad_request',
    'That page of events is no longer valid. Reload the list.',
    400,
  );
}

export function createAuditLog(db: DbHandle, clock: Clock): AuditLog {
  return {
    record(kind, userId, meta) {
      db.orm
        .insert(auditEvents)
        .values({ id: newId('aud'), userId, kind, meta: meta ?? null, createdAt: clock.now() })
        .run();
    },
    list(q) {
      const conditions: (SQL | undefined)[] = [];
      if (q.userId !== undefined) conditions.push(eq(auditEvents.userId, q.userId));
      if (q.cursor !== undefined) {
        const at = decodeCursor(q.cursor);
        conditions.push(
          or(
            lt(auditEvents.createdAt, at.createdAt),
            and(eq(auditEvents.createdAt, at.createdAt), lt(auditEvents.id, at.id)),
          ),
        );
      }
      const rows = db.orm
        .select()
        .from(auditEvents)
        .where(and(...conditions))
        .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
        .limit(q.limit + 1)
        .all();
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((r) => ({
          id: r.id,
          kind: r.kind,
          userId: r.userId,
          createdAt: r.createdAt,
          details: safeDetails(r.meta),
        })),
        nextCursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null,
      };
    },
  };
}

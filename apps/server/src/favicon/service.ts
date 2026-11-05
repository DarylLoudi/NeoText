import { and, asc, count, eq, inArray, lte } from 'drizzle-orm';
import type { DbHandle } from '../db/client';
import { faviconCache } from '../db/schema';
import { createRateLimiter } from '../http/rate-limit';
import type { Clock } from '../lib/clock';
import type { HttpClient } from '../net/http-client';
import { checkUrlShape } from '../net/ssrf';

export const FAVICON_OK_TTL_MS = 7 * 86_400_000;
export const FAVICON_FAIL_TTL_MS = 86_400_000;
export const FAVICON_MAX_BYTES = 65_536;
export const FAVICON_TIMEOUT_MS = 3_000;
/** Rows kept at most; the least recently fetched go first. */
export const FAVICON_CACHE_MAX_ROWS = 5000;
/** Icons one user may have fetched per minute; cached icons do not count. */
export const FAVICON_MISSES_PER_MINUTE = 60;
const MAX_REDIRECTS = 3;

type Icon = { mime: string; data: Buffer };

export interface FaviconService {
  /** The site's icon, or null for none, including when the user is over the miss limit. */
  get(host: string, userId: string): Promise<Icon | null>;
  /** Deletes expired rows and trims the table to its cap; returns how many rows went. */
  prune(): number;
}

/** Lowercase DNS-style names with at least one dot; no ports, paths or IP-like surprises. */
export function isValidHost(host: string): boolean {
  return (
    host.length <= 253 &&
    /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) &&
    host.split('.').every((label) => label.length >= 1 && label.length <= 63)
  );
}

/**
 * The type comes from the bytes, never from the remote header. Only raster formats that cannot
 * carry script are served; SVG, HTML and anything unrecognised are refused.
 */
export function sniffImage(b: Buffer): string | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png';
  }
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 12 &&
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  // ICO: reserved 0, type 1, then a non-zero image count.
  if (b.length >= 6 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 && (b[4] ?? 0) > 0) {
    return 'image/x-icon';
  }
  return null;
}

/** Reads at most `FAVICON_MAX_BYTES + 1` bytes; null when the body is larger than the limit. */
async function readCapped(res: Response): Promise<Buffer | null> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size <= FAVICON_MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return size > FAVICON_MAX_BYTES ? null : Buffer.concat(chunks);
}

async function download(
  host: string,
  http: HttpClient,
): Promise<{ mime: string; data: Buffer } | null> {
  const signal = AbortSignal.timeout(FAVICON_TIMEOUT_MS);
  let url = `https://${host}/favicon.ico`;
  for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
    checkUrlShape(url);
    const res = await http.fetch(url, {
      redirect: 'manual',
      signal,
      headers: { accept: 'image/*', 'user-agent': 'NeoText/0.1' },
    });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => {});
      const location = res.headers.get('location');
      if (!location) return null;
      url = new URL(location, url).href;
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > FAVICON_MAX_BYTES) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const data = await readCapped(res);
    const mime = data ? sniffImage(data) : null;
    return data && mime ? { mime, data } : null;
  }
  return null;
}

/**
 * Icons cached for every user of the instance, keyed by host only (ruling R25). A user can tell
 * from the timing whether anyone here has seen a site's icon; that leak is accepted, because
 * which domains others have seen is low-sensitivity and a per-user cache would multiply the
 * storage. The table is bounded instead: expired rows are pruned before each backup, the row
 * count is capped, and each user may cause only `FAVICON_MISSES_PER_MINUTE` fetches a minute.
 */
export function createFaviconService(deps: {
  db: DbHandle;
  http: HttpClient;
  clock: Clock;
  maxRows?: number;
}): FaviconService {
  const { db, http, clock } = deps;
  const maxRows = deps.maxRows ?? FAVICON_CACHE_MAX_ROWS;
  const inflight = new Map<string, Promise<Icon | null>>();
  const misses = createRateLimiter({ windowMs: 60_000, max: FAVICON_MISSES_PER_MINUTE, clock });

  /** Deletes the least recently fetched rows over the cap. */
  function trim(): number {
    const rows = db.orm.select({ n: count() }).from(faviconCache).get()?.n ?? 0;
    if (rows <= maxRows) return 0;
    const oldest = db.orm
      .select({ host: faviconCache.host })
      .from(faviconCache)
      .orderBy(asc(faviconCache.fetchedAt), asc(faviconCache.host))
      .limit(rows - maxRows)
      .all()
      .map((r) => r.host);
    return db.orm.delete(faviconCache).where(inArray(faviconCache.host, oldest)).run().changes;
  }

  async function load(host: string): Promise<Icon | null> {
    let found: Icon | null = null;
    try {
      found = await download(host, http);
    } catch {
      found = null;
    }
    const row = {
      ok: found ? 1 : 0,
      mime: found?.mime ?? null,
      data: found?.data ?? null,
      fetchedAt: clock.now(),
    };
    db.orm
      .insert(faviconCache)
      .values({ host, ...row })
      .onConflictDoUpdate({ target: faviconCache.host, set: row })
      .run();
    trim();
    return found;
  }

  return {
    prune() {
      const now = clock.now();
      const expired = db.orm
        .delete(faviconCache)
        .where(and(eq(faviconCache.ok, 1), lte(faviconCache.fetchedAt, now - FAVICON_OK_TTL_MS)))
        .run().changes;
      const failed = db.orm
        .delete(faviconCache)
        .where(and(eq(faviconCache.ok, 0), lte(faviconCache.fetchedAt, now - FAVICON_FAIL_TTL_MS)))
        .run().changes;
      return expired + failed + trim();
    },

    async get(host, userId) {
      const cached = db.orm.select().from(faviconCache).where(eq(faviconCache.host, host)).get();
      if (cached) {
        const ttl = cached.ok ? FAVICON_OK_TTL_MS : FAVICON_FAIL_TTL_MS;
        if (clock.now() - cached.fetchedAt < ttl) {
          return cached.ok && cached.mime && cached.data
            ? { mime: cached.mime, data: cached.data }
            : null;
        }
      }
      let pending = inflight.get(host);
      if (!pending) {
        // Over the limit: no fetch and nothing cached, so the user sees the generic icon.
        if (!misses.hit(userId).allowed) return null;
        pending = load(host).finally(() => inflight.delete(host));
        inflight.set(host, pending);
      }
      return pending;
    },
  };
}

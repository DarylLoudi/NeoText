import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type DbHandle, openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { faviconCache } from '../db/schema';
import { createFakeClock } from '../lib/clock';
import type { HttpClient } from '../net/http-client';
import {
  createFaviconService,
  FAVICON_CACHE_MAX_ROWS,
  FAVICON_FAIL_TTL_MS,
  FAVICON_MAX_BYTES,
  FAVICON_MISSES_PER_MINUTE,
  FAVICON_OK_TTL_MS,
  isValidHost,
} from './service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ICO = Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0]);

let dir: string;
let db: DbHandle;
const clock = createFakeClock();

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neotext fav-'));
  db = openDatabase(path.join(dir, 'neotext.db'));
  await runMigrations(db, { backupDir: path.join(dir, 'b'), clock, keepPreMigration: 5 });
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

type Reply = { status?: number; type?: string; body?: Buffer | string; location?: string };
function fakeHttp(reply: (url: string) => Reply | Promise<Reply>) {
  const urls: string[] = [];
  const http: HttpClient = {
    async fetch(url) {
      urls.push(url);
      const r = await reply(url);
      const headers: Record<string, string> = {};
      if (r.type) headers['content-type'] = r.type;
      if (r.location) headers.location = r.location;
      return new Response(r.body ?? '', { status: r.status ?? 200, headers });
    },
    async close() {},
  };
  return { http, urls };
}
const service = (http: HttpClient) => createFaviconService({ db, http, clock });

describe('favicon service', () => {
  test('fetches once and caches', async () => {
    const { http, urls } = fakeHttp(() => ({ type: 'image/png', body: PNG }));
    const svc = service(http);
    const a = await svc.get('example.com', 'usr_1');
    const b = await svc.get('example.com', 'usr_1');
    expect(urls).toEqual(['https://example.com/favicon.ico']);
    expect(a?.mime).toBe('image/png');
    expect(a?.data.equals(PNG)).toBe(true);
    expect(b?.data.equals(PNG)).toBe(true);
  });

  test('refetches after the success lifetime', async () => {
    const { http, urls } = fakeHttp(() => ({ type: 'image/png', body: PNG }));
    const svc = service(http);
    await svc.get('example.com', 'usr_1');
    clock.advance(7 * 86_400_000 + 1);
    await svc.get('example.com', 'usr_1');
    expect(urls).toHaveLength(2);
  });

  test('failures are remembered for a day', async () => {
    const { http, urls } = fakeHttp(() => ({ status: 404 }));
    const svc = service(http);
    expect(await svc.get('gone.example', 'usr_1')).toBeNull();
    expect(await svc.get('gone.example', 'usr_1')).toBeNull();
    expect(urls).toHaveLength(1);
    clock.advance(FAVICON_FAIL_TTL_MS + 1);
    expect(await svc.get('gone.example', 'usr_1')).toBeNull();
    expect(urls).toHaveLength(2);
  });

  test('rejects svg and non-images', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const cases = [
      ['image/svg+xml', svg],
      ['text/html', '<html></html>'],
      ['image/png', '<html><script>alert(1)</script></html>'],
      ['image/png', svg],
    ] as const;
    for (const [i, [type, body]] of cases.entries()) {
      const { http } = fakeHttp(() => ({ type, body }));
      expect(await service(http).get(`h${i}.example`, 'usr_1')).toBeNull();
    }
  });

  test('decides the type by sniffing, not by the remote header', async () => {
    const { http } = fakeHttp(() => ({ type: 'image/gif', body: PNG }));
    expect((await service(http).get('lie.example', 'usr_1'))?.mime).toBe('image/png');
    const ico = fakeHttp(() => ({ type: 'image/vnd.microsoft.icon', body: ICO }));
    expect((await service(ico.http).get('ico.example', 'usr_1'))?.mime).toBe('image/x-icon');
  });

  test('rejects oversize icons', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(70 * 1024)]);
    const { http } = fakeHttp(() => ({ type: 'image/png', body: big }));
    expect(big.length).toBeGreaterThan(FAVICON_MAX_BYTES);
    expect(await service(http).get('big.example', 'usr_1')).toBeNull();
  });

  test('concurrent requests share one fetch', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { http, urls } = fakeHttp(async () => {
      await gate;
      return { type: 'image/png', body: PNG };
    });
    const svc = service(http);
    const pending = Promise.all([
      svc.get('same.example', 'usr_1'),
      svc.get('same.example', 'usr_1'),
    ]);
    release();
    const [a, b] = await pending;
    expect(urls).toHaveLength(1);
    expect(a?.data.equals(b?.data ?? Buffer.alloc(0))).toBe(true);
  });

  test('follows a redirect and checks the target', async () => {
    const { http, urls } = fakeHttp((url) =>
      url === 'https://r.example/favicon.ico'
        ? { status: 301, location: 'https://cdn.example/i.png' }
        : { type: 'image/png', body: PNG },
    );
    expect((await service(http).get('r.example', 'usr_1'))?.mime).toBe('image/png');
    expect(urls).toEqual(['https://r.example/favicon.ico', 'https://cdn.example/i.png']);
    const file = fakeHttp(() => ({ status: 302, location: 'file:///etc/passwd' }));
    expect(await service(file.http).get('f.example', 'usr_1')).toBeNull();
    expect(file.urls).toHaveLength(1);
  });

  test('a network error is a cached failure', async () => {
    let calls = 0;
    const http: HttpClient = {
      async fetch() {
        calls++;
        throw new TypeError('fetch failed');
      },
      async close() {},
    };
    const svc = service(http);
    expect(await svc.get('down.example', 'usr_1')).toBeNull();
    expect(await svc.get('down.example', 'usr_1')).toBeNull();
    expect(calls).toBe(1);
  });

  test.each(['localhost', 'a b.com', `${'x'.repeat(300)}.com`, '../etc', 'UPPER.com', ''])(
    'invalid host %s',
    (h) => expect(isValidHost(h)).toBe(false),
  );
  test('valid hosts', () => {
    expect(isValidHost('example.com')).toBe(true);
    expect(isValidHost('sub-1.example.co.id')).toBe(true);
  });

  test('prune drops expired successes and failures and keeps fresh rows', async () => {
    const ok = fakeHttp(() => ({ type: 'image/png', body: PNG }));
    const svc = service(ok.http);
    await svc.get('old-ok.example', 'usr_1');
    const fail = service(fakeHttp(() => ({ status: 404 })).http);
    await fail.get('old-fail.example', 'usr_1');
    clock.advance(FAVICON_FAIL_TTL_MS + 1);
    await svc.get('fresh.example', 'usr_1');
    expect(svc.prune()).toBe(1);
    expect(hosts()).toEqual(['fresh.example', 'old-ok.example']);
    clock.advance(FAVICON_OK_TTL_MS);
    expect(svc.prune()).toBe(2);
    expect(hosts()).toEqual([]);
  });

  test(`the cache holds at most ${FAVICON_CACHE_MAX_ROWS} rows, dropping the oldest first`, async () => {
    expect(FAVICON_CACHE_MAX_ROWS).toBe(5000);
    const { http } = fakeHttp(() => ({ type: 'image/png', body: PNG }));
    const svc = createFaviconService({ db, http, clock, maxRows: 3 });
    for (const h of ['a.example', 'b.example', 'c.example', 'd.example']) {
      await svc.get(h, 'usr_1');
      clock.advance(1);
    }
    expect(hosts()).toEqual(['b.example', 'c.example', 'd.example']);
    // prune keeps the cap too, for rows written before it applied.
    db.orm.insert(faviconCache).values({ host: 'e.example', ok: 0, fetchedAt: clock.now() }).run();
    svc.prune();
    expect(hosts()).toEqual(['c.example', 'd.example', 'e.example']);
  });

  test('cache misses are limited per user; over the limit nothing is fetched', async () => {
    expect(FAVICON_MISSES_PER_MINUTE).toBe(60);
    const { http, urls } = fakeHttp(() => ({ type: 'image/png', body: PNG }));
    const svc = service(http);
    for (let i = 0; i < 60; i++) await svc.get(`h${i}.example`, 'usr_a');
    expect(urls).toHaveLength(60);
    expect(await svc.get('one-more.example', 'usr_a')).toBeNull();
    expect(urls).toHaveLength(60);
    // Cached icons are still served, and other users are not affected.
    expect((await svc.get('h0.example', 'usr_a'))?.mime).toBe('image/png');
    expect((await svc.get('other.example', 'usr_b'))?.mime).toBe('image/png');
    // The refused miss is not cached as a failure: it loads once the minute is over.
    clock.advance(60_000);
    expect((await svc.get('one-more.example', 'usr_a'))?.mime).toBe('image/png');
  });
});

function hosts(): string[] {
  return db.orm
    .select({ host: faviconCache.host })
    .from(faviconCache)
    .all()
    .map((r) => r.host)
    .sort();
}

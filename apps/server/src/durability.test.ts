import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { type SpawnedServer, spawnServer } from '../test-support/spawn-server';

function json(body: unknown, origin: string, cookie?: string, method = 'POST'): RequestInit {
  return {
    method,
    headers: {
      'content-type': 'application/json',
      origin,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  };
}

const servers: SpawnedServer[] = [];
const dirs: string[] = [];

async function freshDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neotext durability-'));
  dirs.push(dir);
  return dir;
}

async function start(dataDir: string, env?: Record<string, string>): Promise<SpawnedServer> {
  const s = await spawnServer({ dataDir, env });
  servers.push(s);
  return s;
}

afterEach(async () => {
  for (const s of servers.splice(0)) await s.kill();
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

test('a saved setting survives an abrupt kill', async () => {
  const dataDir = await freshDir();
  const s1 = await start(dataDir);
  const setup = await fetch(
    `${s1.baseUrl}/api/setup`,
    json({ username: 'daryl', password: 'correct horse battery', mode: 'personal' }, s1.baseUrl),
  );
  expect(setup.status).toBe(201);
  const cookie = (setup.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const patch = await fetch(
    `${s1.baseUrl}/api/settings`,
    json({ patch: { appearance: { theme: 'dark' } } }, s1.baseUrl, cookie, 'PATCH'),
  );
  expect(patch.status).toBe(200);
  await s1.kill();

  const s2 = await start(dataDir);
  const res = await fetch(`${s2.baseUrl}/api/settings`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { settings: { appearance: { theme: string } } };
  expect(body.settings.appearance.theme).toBe('dark');
  await s2.stop();
}, 60_000);

/** POST a failed login from a chosen local source address, so each "client" has its own socket IP. */
function loginFrom(baseUrl: string, localAddress: string, username: string): Promise<number> {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: '/api/auth/login',
        method: 'POST',
        localAddress,
        headers: { 'content-type': 'application/json', origin: baseUrl },
      },
      (res) => {
        res.resume();
        res.once('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.once('error', reject);
    req.end(JSON.stringify({ username, password: 'wrong password here' }));
  });
}

test('login rate limits are keyed by the real client address', async () => {
  const s = await start(await freshDir(), { NEOTEXT_HOST: '0.0.0.0' });
  // Distinct usernames keep the per-username limit (5/min) out of the way of the per-IP limit.
  for (let i = 0; i < 10; i++) {
    expect(await loginFrom(s.baseUrl, '127.0.0.1', `ghost${i}`)).toBe(401);
  }
  expect(await loginFrom(s.baseUrl, '127.0.0.1', 'ghost10')).toBe(429);
  // A different client address has its own bucket; a shared 'unknown' key would answer 429 here.
  expect(await loginFrom(s.baseUrl, '127.0.0.2', 'ghost11')).toBe(401);
  await s.stop();
}, 60_000);

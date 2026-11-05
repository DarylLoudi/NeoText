import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { InstanceMode, PublicUser } from '@neotext/shared';
import { newId } from '@neotext/shared';
import type { Hono } from 'hono';
import { createApp } from '../src/app';
import { sessionCookieName } from '../src/auth/cookies';
import type { UserRow } from '../src/auth/users-repo';
import { loadConfig } from '../src/config/env';
import { type Container, createContainer } from '../src/container';
import { argon2Params } from '../src/crypto/kdf';
import { createVault } from '../src/crypto/vault';
import type { AppEnv, AuthContext } from '../src/http/env';
import { createFakeClock, type FakeClock } from '../src/lib/clock';
import type { Logger } from '../src/lib/logger';

export interface TestApp {
  app: Hono<AppEnv>;
  c: Container;
  dataDir: string;
  clock: FakeClock;
  close(opts?: { keepData?: boolean }): Promise<void>;
}

export async function createTestApp(
  opts: { env?: Record<string, string>; dataDir?: string; clock?: FakeClock; log?: Logger } = {},
): Promise<TestApp> {
  const dataDir = opts.dataDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'neotext test-')));
  const clock = opts.clock ?? createFakeClock();
  const config = loadConfig({
    NODE_ENV: 'test',
    NEOTEXT_ARGON2_MEMORY_KIB: '1024',
    NEOTEXT_ARGON2_PASSES: '1',
    NEOTEXT_PUBLIC_URL: 'http://localhost:3420',
    NEOTEXT_DATA_DIR: dataDir,
    ...opts.env,
  });
  const c = await createContainer(config, { clock, ...(opts.log ? { log: opts.log } : {}) });
  const app = createApp(c);
  return {
    app,
    c,
    dataDir,
    clock,
    close: async (closeOpts) => {
      await c.close();
      if (!closeOpts?.keepData) await fs.rm(dataDir, { recursive: true, force: true });
    },
  };
}

export async function setupOwner(
  t: TestApp,
  opts: {
    username?: string;
    password?: string;
    mode?: InstanceMode;
    useEnvProvider?: boolean;
  } = {},
): Promise<{ cookie: string; user: PublicUser; recoveryKey: string; password: string }> {
  const password = opts.password ?? 'correct horse battery';
  const res = await t.app.request('/api/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3420' },
    body: JSON.stringify({
      username: opts.username ?? 'daryl',
      password,
      mode: opts.mode ?? 'personal',
      ...(opts.useEnvProvider ? { useEnvProvider: true } : {}),
    }),
  });
  if (res.status !== 201) throw new Error(`setupOwner failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { user: PublicUser; recoveryKey: string };
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  return { cookie, user: body.user, recoveryKey: body.recoveryKey, password };
}

export function authed(t: TestApp, cookie: string) {
  return (path: string, init?: RequestInit) =>
    t.app.request(path, {
      ...init,
      headers: {
        ...(init?.headers as Record<string, string> | undefined),
        cookie,
        origin: 'http://localhost:3420',
        'content-type': 'application/json',
      },
    });
}

/** Adds a user directly (vault, row, session), bypassing registration rules. */
export async function addUser(
  t: TestApp,
  username: string,
  role: 'admin' | 'member' = 'member',
): Promise<{ cookie: string; userId: string; auth: AuthContext }> {
  const userId = newId('usr');
  const vault = await createVault(userId, 'correct horse battery', argon2Params(t.c.config.argon2));
  const now = t.c.clock.now();
  const row: UserRow = {
    id: userId,
    username,
    displayName: username,
    role,
    status: 'active',
    kdfSalt: vault.password.kdfSalt,
    kdfParams: vault.password.kdfParams,
    authVerifier: vault.password.authVerifier,
    dekByPassword: vault.password.dekByPassword,
    dekByRecovery: vault.dekByRecovery,
    dekByInstance: null,
    createdAt: now,
    updatedAt: now,
    passwordChangedAt: now,
  };
  t.c.users.insert(row);
  const session = t.c.sessions.create(userId, vault.dek, null);
  const cookie = `${sessionCookieName(t.c.config)}=${session.token}`;
  return { cookie, userId, auth: authContextFor(t, cookie) };
}

export function authContextFor(t: TestApp, cookie: string): AuthContext {
  const token = cookie.slice(cookie.indexOf('=') + 1);
  const session = t.c.sessions.resolve(token);
  const user = session ? t.c.users.findById(session.userId) : null;
  if (!session || !user) throw new Error('authContextFor: the cookie does not match a session');
  return {
    userId: user.id,
    username: user.username,
    role: user.role,
    sessionId: session.sessionId,
    dek: session.dek,
  };
}

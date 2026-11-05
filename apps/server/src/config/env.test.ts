import path from 'node:path';
import { expect, test } from 'vitest';
import { loadConfig } from './env';

test('defaults', () => {
  const cfg = loadConfig({}, 'C:/tmp/neo text');
  expect(cfg).toMatchObject({
    env: 'development',
    host: '127.0.0.1',
    port: 3420,
    publicUrl: 'http://localhost:3420',
    cookieSecure: false,
    trustProxy: false,
  });
  expect(path.isAbsolute(cfg.dataDir)).toBe(true);
  expect(cfg.dataDir.endsWith(path.join('neo text', 'data'))).toBe(true);
  expect(cfg.allowedOrigins).toEqual(['http://localhost:3420', 'http://localhost:5173']);
  expect(cfg.argon2).toEqual({ memoryKiB: 65536, passes: 2 });
});
test('rejects a bad port and names the variable', () => {
  expect(() => loadConfig({ NEOTEXT_PORT: 'abc' })).toThrow(/NEOTEXT_PORT/);
});
test('https public url turns on secure cookies; production has no dev origin', () => {
  const cfg = loadConfig({
    NODE_ENV: 'production',
    NEOTEXT_PUBLIC_URL: 'https://chat.example.org',
  });
  expect(cfg.cookieSecure).toBe(true);
  expect(cfg.allowedOrigins).toEqual(['https://chat.example.org']);
});
test('test env is silent', () => {
  expect(loadConfig({ NODE_ENV: 'test' }).logLevel).toBe('silent');
});
test('backup interval above the timer limit is rejected and names the variable', () => {
  expect(() => loadConfig({ NEOTEXT_BACKUP_INTERVAL_HOURS: '720' })).toThrow(
    /NEOTEXT_BACKUP_INTERVAL_HOURS/,
  );
  expect(loadConfig({ NEOTEXT_BACKUP_INTERVAL_HOURS: '596' }).backup.intervalHours).toBe(596);
});
test('webDistDir: env override, default when apps/web/dist exists, else null', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'neotext-cfg-'));
  try {
    expect(loadConfig({}, cwd).webDistDir).toBeNull();
    fs.mkdirSync(path.join(cwd, 'apps', 'web', 'dist'), { recursive: true });
    expect(loadConfig({}, cwd).webDistDir).toBe(path.join(cwd, 'apps', 'web', 'dist'));
    expect(loadConfig({ NEOTEXT_WEB_DIST: 'other' }, cwd).webDistDir).toBe(path.join(cwd, 'other'));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

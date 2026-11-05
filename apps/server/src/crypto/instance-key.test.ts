import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { loadOrCreateInstanceKey } from './instance-key';
import { randomKey } from './kdf';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neotext ik-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('instance key', () => {
  test('creates once and reuses', async () => {
    const a = await loadOrCreateInstanceKey(dir, null);
    const b = await loadOrCreateInstanceKey(dir, null);
    expect(a.length).toBe(32);
    expect(a.equals(b)).toBe(true);
    await expect(fs.stat(path.join(dir, 'keys', 'instance.key'))).resolves.toBeTruthy();
  });

  test('env key wins and writes no file', async () => {
    const env = randomKey();
    const k = await loadOrCreateInstanceKey(dir, env.toString('base64'));
    expect(k.equals(env)).toBe(true);
    await expect(fs.stat(path.join(dir, 'keys'))).rejects.toThrow();
  });

  test('env key of the wrong length throws', async () => {
    await expect(loadOrCreateInstanceKey(dir, Buffer.alloc(5).toString('base64'))).rejects.toThrow(
      'NEOTEXT_INSTANCE_KEY',
    );
  });

  test('corrupt key file throws a helpful error', async () => {
    await fs.mkdir(path.join(dir, 'keys'));
    await fs.writeFile(path.join(dir, 'keys', 'instance.key'), 'AAAA');
    await expect(loadOrCreateInstanceKey(dir, null)).rejects.toThrow('instance.key');
  });
});

describe('instance key hardening', () => {
  const keyFile = () => path.join(dir, 'keys', 'instance.key');

  test('strict base64 rejects trailing junk in the env value', async () => {
    const good = randomKey().toString('base64');
    await expect(loadOrCreateInstanceKey(dir, `${good}!!!`)).rejects.toThrow(
      'NEOTEXT_INSTANCE_KEY',
    );
    await expect(
      loadOrCreateInstanceKey(dir, `${good.slice(0, 20)}\n${good.slice(20)}`),
    ).rejects.toThrow('NEOTEXT_INSTANCE_KEY');
    const k = await loadOrCreateInstanceKey(dir, `  ${good}\n`);
    expect(k.toString('base64')).toBe(good);
  });

  test('strict base64 rejects trailing junk in the key file', async () => {
    await fs.mkdir(path.join(dir, 'keys'));
    await fs.writeFile(keyFile(), `${randomKey().toString('base64')}@@`);
    await expect(loadOrCreateInstanceKey(dir, null)).rejects.toThrow('instance.key');
  });

  test('an empty key file is an error that warns about sealed data', async () => {
    await fs.mkdir(path.join(dir, 'keys'));
    await fs.writeFile(keyFile(), '');
    await expect(loadOrCreateInstanceKey(dir, null)).rejects.toThrow(
      /restore the key from a backup/,
    );
  });

  test('two concurrent first runs agree on one key and leave no temp files', async () => {
    const keys = await Promise.all([1, 2, 3, 4].map(() => loadOrCreateInstanceKey(dir, null)));
    expect(new Set(keys.map((k) => k.toString('hex'))).size).toBe(1);
    expect(await fs.readdir(path.join(dir, 'keys'))).toEqual(['instance.key']);
    const again = await loadOrCreateInstanceKey(dir, null);
    expect(again.equals(keys[0] as Buffer)).toBe(true);
  });
});

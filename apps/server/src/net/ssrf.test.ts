import type dns from 'node:dns';
import { describe, expect, test } from 'vitest';
import { assertHostAllowed, BlockedUrlError, checkUrlShape, createGuardedLookup } from './ssrf';

type Cb = (...a: unknown[]) => void;
const fake = (addr: string, family = 4) =>
  ((_host: string, _opts: unknown, cb: Cb) =>
    cb(null, [{ address: addr, family }])) as unknown as typeof dns.lookup;

describe('checkUrlShape', () => {
  test.each(['file:///etc/passwd', 'ftp://x.org', 'http://user:pw@x.org'])('rejects %s', (u) =>
    expect(() => checkUrlShape(u)).toThrow(BlockedUrlError),
  );
  test('rejects garbage as invalid', () => {
    expect(() => checkUrlShape('nope')).toThrow(expect.objectContaining({ reason: 'invalid' }));
  });
  test('accepts http and https', () => {
    expect(checkUrlShape('https://example.org/a').hostname).toBe('example.org');
    expect(checkUrlShape('http://example.org').protocol).toBe('http:');
  });
});

describe('assertHostAllowed', () => {
  test('private blocked unless allowed', async () => {
    await expect(
      assertHostAllowed('intranet.test', { allowPrivate: false }, fake('10.0.0.5')),
    ).rejects.toMatchObject({ reason: 'private' });
    await expect(
      assertHostAllowed('intranet.test', { allowPrivate: true }, fake('10.0.0.5')),
    ).resolves.toBeUndefined();
  });
  test('metadata blocked even when private is allowed', async () => {
    await expect(
      assertHostAllowed('meta.test', { allowPrivate: true }, fake('169.254.169.254')),
    ).rejects.toMatchObject({ reason: 'metadata' });
  });
  test('public passes', async () => {
    await expect(
      assertHostAllowed('x.test', { allowPrivate: false }, fake('8.8.8.8')),
    ).resolves.toBeUndefined();
  });
  test('literal IP hosts are checked without DNS', async () => {
    const boom = (() => {
      throw new Error('dns used');
    }) as unknown as typeof dns.lookup;
    await expect(
      assertHostAllowed('127.0.0.1', { allowPrivate: false }, boom),
    ).rejects.toMatchObject({ reason: 'private' });
    await expect(assertHostAllowed('[::1]', { allowPrivate: false }, boom)).rejects.toMatchObject({
      reason: 'private',
    });
    await expect(
      assertHostAllowed('169.254.169.254', { allowPrivate: true }, boom),
    ).rejects.toMatchObject({ reason: 'metadata' });
    await expect(
      assertHostAllowed('127.0.0.1', { allowPrivate: true }, boom),
    ).resolves.toBeUndefined();
  });
  test('one bad address among several blocks', async () => {
    const mixed = ((_h: string, _o: unknown, cb: Cb) =>
      cb(null, [
        { address: '8.8.8.8', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ])) as unknown as typeof dns.lookup;
    await expect(
      assertHostAllowed('mixed.test', { allowPrivate: false }, mixed),
    ).rejects.toMatchObject({ reason: 'private' });
  });
});

describe('createGuardedLookup', () => {
  test('passes addresses through when allowed', async () => {
    const lookup = createGuardedLookup({ allowPrivate: false }, fake('8.8.8.8'));
    const res = await new Promise<unknown>((resolve, reject) =>
      lookup('x.test', { all: true }, (err, addrs) => (err ? reject(err) : resolve(addrs))),
    );
    expect(res).toEqual([{ address: '8.8.8.8', family: 4 }]);
  });
  test('single-address callers get a single address', async () => {
    const lookup = createGuardedLookup({ allowPrivate: false }, fake('8.8.8.8'));
    const res = await new Promise<unknown[]>((resolve, reject) =>
      (lookup as unknown as (h: string, o: object, cb: Cb) => void)(
        'x.test',
        {},
        (err: unknown, ...rest: unknown[]) => (err ? reject(err) : resolve(rest)),
      ),
    );
    expect(res).toEqual(['8.8.8.8', 4]);
  });
  test('errors with BlockedUrlError', async () => {
    const lookup = createGuardedLookup({ allowPrivate: false }, fake('192.168.0.9'));
    const err = await new Promise<unknown>((resolve) =>
      lookup('x.test', { all: true }, (e) => resolve(e)),
    );
    expect(err).toBeInstanceOf(BlockedUrlError);
  });
});

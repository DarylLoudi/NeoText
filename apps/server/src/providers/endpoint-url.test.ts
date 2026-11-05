import type dns from 'node:dns';
import { expect, test } from 'vitest';
import { AppError } from '../http/errors';
import {
  checkEndpointUrl,
  HOST_NOT_FOUND_MESSAGE,
  METADATA_MESSAGE,
  PRIVATE_NETWORK_MESSAGE,
} from './endpoint-url';

/** A lookup that answers every name with `address`, or fails like an unknown host. */
const lookupTo = (address: string | null) =>
  ((_host: string, _opts: unknown, cb: (...a: unknown[]) => void) => {
    if (address === null) cb(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }));
    else cb(null, [{ address, family: address.includes(':') ? 6 : 4 }]);
  }) as unknown as typeof dns.lookup;

const refusal = (p: Promise<void>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? [e.status, e.message] : e),
  );

test('a public host passes under every policy', async () => {
  for (const allowPrivate of [true, false]) {
    await expect(
      checkEndpointUrl('https://api.example/v1', { allowPrivate }, lookupTo('8.8.8.8')),
    ).resolves.toBeUndefined();
  }
});

test('metadata is refused even where private networks are allowed', async () => {
  expect(
    await refusal(checkEndpointUrl('http://169.254.169.254/', { allowPrivate: true })),
  ).toEqual([400, METADATA_MESSAGE]);
});

test('private networks follow the policy', async () => {
  const lookup = lookupTo('10.0.0.5');
  expect(
    await refusal(checkEndpointUrl('http://box.lan/mcp', { allowPrivate: false }, lookup)),
  ).toEqual([400, PRIVATE_NETWORK_MESSAGE]);
  expect(
    await refusal(checkEndpointUrl('http://box.lan/mcp', { allowPrivate: true }, lookup)),
  ).toBeNull();
});

test('an unknown host is refused only where private networks are not allowed', async () => {
  const lookup = lookupTo(null);
  expect(
    await refusal(checkEndpointUrl('https://typo.example/', { allowPrivate: false }, lookup)),
  ).toEqual([400, HOST_NOT_FOUND_MESSAGE]);
  expect(
    await refusal(checkEndpointUrl('https://typo.example/', { allowPrivate: true }, lookup)),
  ).toBeNull();
});

test('a bad URL shape is a 400', async () => {
  const out = await refusal(checkEndpointUrl('ftp://x.example/', { allowPrivate: true }));
  expect(Array.isArray(out) && out[0]).toBe(400);
});

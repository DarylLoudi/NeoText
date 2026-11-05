import dns from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import { isMetadataAddress, isPrivateAddress } from './ip';

export interface NetPolicy {
  allowPrivate: boolean;
}

export type BlockedReason = 'scheme' | 'credentials' | 'private' | 'metadata' | 'invalid';

export class BlockedUrlError extends Error {
  reason: BlockedReason;
  constructor(reason: BlockedReason, message: string) {
    super(message);
    this.name = 'BlockedUrlError';
    this.reason = reason;
  }
}

/** Parses the URL and rejects anything but http(s) without embedded credentials. */
export function checkUrlShape(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BlockedUrlError('invalid', 'That is not a valid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BlockedUrlError('scheme', 'Only http and https URLs are allowed.');
  }
  if (parsed.username || parsed.password) {
    throw new BlockedUrlError('credentials', 'URLs with a username or password are not allowed.');
  }
  return parsed;
}

function checkAddresses(addresses: string[], policy: NetPolicy): BlockedUrlError | null {
  for (const address of addresses) {
    if (isMetadataAddress(address)) {
      return new BlockedUrlError('metadata', 'That address is a cloud metadata endpoint.');
    }
    if (!policy.allowPrivate && isPrivateAddress(address)) {
      return new BlockedUrlError(
        'private',
        'That address is on a private network, which this connection may not reach.',
      );
    }
  }
  return null;
}

/** A dns.lookup replacement that refuses blocked addresses at connect time (rebinding-safe). */
export function createGuardedLookup(
  policy: NetPolicy,
  base: typeof dns.lookup = dns.lookup,
): LookupFunction {
  return (hostname, options, callback) => {
    const wantsAll = Boolean(options.all);
    base(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) {
        callback(err, '', 4);
        return;
      }
      const list = addresses as unknown as dns.LookupAddress[];
      const blocked = checkAddresses(
        list.map((a) => a.address),
        policy,
      );
      if (blocked) {
        callback(blocked, '', 4);
        return;
      }
      if (wantsAll) {
        (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
      } else {
        const first = list[0] as dns.LookupAddress;
        callback(null, first.address, first.family);
      }
    });
  };
}

/** Resolves the host (or checks a literal IP directly) and throws BlockedUrlError if not allowed. */
export async function assertHostAllowed(
  hostname: string,
  policy: NetPolicy,
  base: typeof dns.lookup = dns.lookup,
): Promise<void> {
  const host = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  if (isIP(host)) {
    const blocked = checkAddresses([host], policy);
    if (blocked) throw blocked;
    return;
  }
  const lookup = createGuardedLookup(policy, base);
  await new Promise<void>((resolve, reject) => {
    (lookup as unknown as (h: string, o: object, cb: (e: Error | null) => void) => void)(
      host,
      { all: true },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

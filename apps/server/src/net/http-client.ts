import type dns from 'node:dns';
import { isIP } from 'node:net';
import { Agent, buildConnector, fetch as undiciFetch } from 'undici';
import { assertHostAllowed, checkUrlShape, createGuardedLookup, type NetPolicy } from './ssrf';

export interface HttpClient {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

/**
 * Pooled undici client that refuses blocked addresses.
 * Hostnames are checked at connect time by the guarded lookup; literal-IP hosts never use DNS,
 * so they are checked here before connecting. Connect-time refusals surface from undici as a
 * TypeError whose `cause` chain holds the BlockedUrlError; literal-IP and shape refusals throw
 * BlockedUrlError directly.
 */
export function createHttpClient(
  policy: NetPolicy,
  opts: { lookup?: typeof dns.lookup } = {},
): HttpClient {
  const connector = buildConnector({
    timeout: 10_000,
    lookup: createGuardedLookup(policy, opts.lookup),
  });
  // Redirects reuse the dispatcher, so literal-IP hops are re-checked here too.
  const connect: buildConnector.connector = (connectOpts, callback) => {
    const host = connectOpts.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host)) {
      assertHostAllowed(host, policy).then(
        () => connector(connectOpts, callback),
        (err: Error) => callback(err, null),
      );
      return;
    }
    connector(connectOpts, callback);
  };
  const agent = new Agent({
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 600_000,
    connections: 64,
    headersTimeout: 120_000,
    bodyTimeout: 0,
    connect,
  });
  return {
    async fetch(url, init) {
      const parsed = checkUrlShape(url);
      if (isIP(parsed.hostname.replace(/^\[|\]$/g, ''))) {
        await assertHostAllowed(parsed.hostname, policy);
      }
      const res = await undiciFetch(url, {
        ...(init as object),
        dispatcher: agent,
      } as Parameters<typeof undiciFetch>[1]);
      return res as unknown as Response;
    },
    close: () => agent.close(),
  };
}

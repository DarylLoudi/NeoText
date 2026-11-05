import type dns from 'node:dns';
import { AppError } from '../http/errors';
import { assertHostAllowed, BlockedUrlError, checkUrlShape, type NetPolicy } from '../net/ssrf';

const LOOKUP_TIMEOUT_MS = 3000;
export const METADATA_MESSAGE =
  "This address is reserved for cloud metadata and can't be used as an endpoint.";
export const PRIVATE_NETWORK_MESSAGE =
  'This address is on a private network. Only the admin can add endpoints like that.';
export const HOST_NOT_FOUND_MESSAGE =
  "Couldn't find that host. Check the address and your connection.";

/**
 * Checks an endpoint address someone is saving (a provider's base URL, an MCP server): the URL
 * shape, never a metadata address, private networks only when `policy` allows them. The lookup
 * gives up after a few seconds so a request never hangs on DNS. A host that does not resolve
 * (typo, offline, server not started) is only refused where the connect-time guard cannot
 * decide, that is where private networks are not allowed. Throws a 400 `AppError`.
 */
export async function checkEndpointUrl(
  url: string,
  policy: NetPolicy,
  lookup?: typeof dns.lookup,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('lookup timed out')), LOOKUP_TIMEOUT_MS);
  });
  try {
    await Promise.race([assertHostAllowed(checkUrlShape(url).hostname, policy, lookup), timeout]);
  } catch (e) {
    if (e instanceof BlockedUrlError) {
      const message =
        e.reason === 'metadata'
          ? METADATA_MESSAGE
          : e.reason === 'private'
            ? PRIVATE_NETWORK_MESSAGE
            : e.message;
      throw new AppError('bad_request', message, 400);
    }
    if (policy.allowPrivate) return;
    throw new AppError('bad_request', HOST_NOT_FOUND_MESSAGE, 400);
  } finally {
    clearTimeout(timer);
  }
}

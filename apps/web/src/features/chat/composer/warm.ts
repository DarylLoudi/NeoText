import { providersApi } from '../../../lib/api/providers';

/** A provider is warmed at most this often; the connection it opens stays warm for a while. */
export const WARM_EVERY_MS = 60_000;

const lastWarmed = new Map<string, number>();

/**
 * Asks the server to open its connection to a provider early, so the next message starts
 * sooner. Fire and forget: a failure only means the first token comes a little later.
 */
export function warmProvider(providerId: string): void {
  const now = Date.now();
  const last = lastWarmed.get(providerId);
  if (last !== undefined && now - last < WARM_EVERY_MS) return;
  lastWarmed.set(providerId, now);
  providersApi.warm(providerId).catch(() => undefined);
}

export function resetWarmThrottle(): void {
  lastWarmed.clear();
}

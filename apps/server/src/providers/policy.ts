import type { NetPolicy } from '../net/ssrf';

/**
 * Only admins may reach private networks. A personal instance's owner is its admin, so a
 * personal owner keeps that; but a member left over after a community instance was switched
 * back to personal must not gain it.
 */
export function endpointPolicy(role: 'admin' | 'member'): NetPolicy {
  return { allowPrivate: role === 'admin' };
}

/** First 8 characters and last 4 of the key; short keys show only the last 4. */
export function keyHint(key: string): string {
  if (key.length < 16) return `…${key.slice(-4)}`;
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

import type { PublicUser } from '@neotext/shared';
import type { QueryClient } from '@tanstack/react-query';
import { authApi } from '../lib/api/auth';
import { translate } from '../lib/i18n';
import { qk } from '../lib/query';
import { flushSettings, hydrateSettings, teardownSettings } from '../state/settings';
import { toast } from '../ui';

const FLUSH_WAIT_MS = 3000;

let hydratedFor: string | null = null;

/** Loads this user's settings. Safe to call again; failures show a note instead of blocking. */
export function beginSession(user: PublicUser, queryClient: QueryClient): void {
  // A different user signing in after a mid-session 401 must not see the previous user's cache.
  if (hydratedFor && hydratedFor !== user.id) queryClient.clear();
  hydratedFor = user.id;
  hydrateSettings(user.id).catch(() => {
    toast({ message: translate('common.offline'), tone: 'danger' });
  });
}

/** For an already signed-in session found at page load. */
export function resumeSession(user: PublicUser, queryClient: QueryClient): void {
  if (hydratedFor !== user.id) beginSession(user, queryClient);
}

/** Pending edits go out first, but a stuck save never traps the user signed in. */
export async function endSession(queryClient: QueryClient): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, FLUSH_WAIT_MS);
  });
  try {
    await Promise.race([flushSettings().catch(() => {}), wait]);
  } finally {
    clearTimeout(timer);
  }
  await authApi.logout();
  try {
    await teardownSettings();
  } finally {
    hydratedFor = null;
    queryClient.clear();
    queryClient.setQueryData(qk.session, null);
  }
}

/** Marks the user as signed in for the route guards. */
export function setSignedIn(queryClient: QueryClient, user: PublicUser): void {
  queryClient.setQueryData(qk.session, user);
}

export function resetSessionFlowForTests(): void {
  hydratedFor = null;
}

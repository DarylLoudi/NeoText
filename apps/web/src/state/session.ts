import type { InstanceInfo, PublicUser, RegistrationPolicy } from '@neotext/shared';
import {
  queryOptions,
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { endSession } from '../app/session-flow';
import { authApi } from '../lib/api/auth';
import { ApiError } from '../lib/api/client';
import { qk } from '../lib/query';

export const instanceQuery = queryOptions({ queryKey: qk.instance, queryFn: authApi.instance });

/** `null` when signed out: a 401 from /auth/me is an answer, not an error. */
export const sessionQuery = queryOptions({
  queryKey: qk.session,
  queryFn: async (): Promise<PublicUser | null> => {
    try {
      return await authApi.me();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  },
});

/** Whether a visitor can create their own account. */
export const signUpsOpen = (registration: RegistrationPolicy | null): boolean =>
  registration === 'invite' || registration === 'open';

export function useInstance(): UseQueryResult<InstanceInfo> {
  return useQuery(instanceQuery);
}

export function useSession(): UseQueryResult<PublicUser | null> {
  return useQuery(sessionQuery);
}

/** Saves pending edits, logs out, then drops local state and every cached query. */
export function useSignOut(): UseMutationResult<void> {
  const client = useQueryClient();
  return useMutation({ mutationFn: () => endSession(client) });
}

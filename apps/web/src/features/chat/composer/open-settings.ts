import { useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';

/** Goes to Settings, Providers. Outside a router (a component test) it does nothing. */
export function useOpenProviderSettings(): () => void {
  const router = useRouter({ warn: false });
  return useCallback(() => {
    void router?.navigate({ to: '/settings/$section', params: { section: 'providers' } });
  }, [router]);
}

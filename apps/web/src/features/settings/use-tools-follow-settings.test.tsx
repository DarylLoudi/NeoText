import type { JsonObject, SettingsResponse } from '@neotext/shared';
import { defaultSettings } from '@neotext/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, test, vi } from 'vitest';
import { createQueryClient, qk } from '../../lib/query';
import { onServerSettings } from '../../test/fake-settings';
import { useToolsFollowSettings } from './use-tools-follow-settings';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

const response = (backendProviderId: string | null, extra: JsonObject = {}): SettingsResponse => {
  const settings = defaultSettings();
  settings.webSearch.backendProviderId = backendProviderId;
  return { version: 1, settings, resetPaths: [], recovered: false, ...extra };
};

test('the tools refresh when a saved search backend changes, not on other saves', () => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(qk.tools, { tools: [], webSearchBackend: false });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  renderHook(() => useToolsFollowSettings(), { wrapper });
  const listener = onServerSettings.mock.lastCall?.[0];
  if (!listener) throw new Error('not subscribed');
  const invalidated = () => queryClient.getQueryState(qk.tools)?.isInvalidated;

  listener(response(null), null);
  expect(invalidated()).toBe(false);
  listener(response(null), response(null));
  expect(invalidated()).toBe(false);
  listener(response('prv_s'), response(null));
  expect(invalidated()).toBe(true);
});

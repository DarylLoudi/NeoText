import type { ToolsResponse } from '@neotext/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import { createQueryClient, qk } from '../../../lib/query';
import { server } from '../../../test/msw';
import { TOOLS_STALE_MS, useCallName } from './tool-names';

const tools: ToolsResponse = {
  webSearchBackend: false,
  tools: [
    {
      name: 'mcp_web_search',
      description: 'Search.',
      source: 'mcp',
      policy: 'ask',
      defaultPolicy: 'ask',
      mcp: { server: 'web', tool: 'search' },
    },
  ],
};

let requests = 0;
beforeEach(() => {
  requests = 0;
  server.use(
    http.get('/api/tools', () => {
      requests += 1;
      return HttpResponse.json(tools);
    }),
  );
});

function Name() {
  return <span>{useCallName({ name: 'mcp_web_search', source: 'mcp' })}</span>;
}

test('tool rows mounted within a minute reuse the tools list', async () => {
  expect(TOOLS_STALE_MS).toBe(60_000);
  const queryClient = createQueryClient();
  const mount = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <Name />
      </QueryClientProvider>,
    );
  const first = mount();
  expect(await screen.findByText('web: search')).toBeInTheDocument();
  first.unmount();
  // Older than the client's default freshness, younger than a minute.
  queryClient.setQueryData(qk.tools, tools, { updatedAt: Date.now() - 45_000 });
  mount();
  expect(await screen.findByText('web: search')).toBeInTheDocument();
  await new Promise((r) => setTimeout(r, 20));
  expect(requests).toBe(1);
});

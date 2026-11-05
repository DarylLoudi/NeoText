import type { ProviderPublic, ToolsResponse } from '@neotext/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import {
  flushSettings,
  getSettingsState,
  resetFakeSettings,
  setFakeSettings,
  updateSettings,
} from '../../../test/fake-settings';
import { server } from '../../../test/msw';
import { mockBackend, renderApp } from '../../../test/renderApp';

vi.mock('../../../state/settings', () => import('../../../test/fake-settings'));

const tools: ToolsResponse = {
  tools: [
    {
      name: 'fetch_url',
      description: 'Fetch a web page and return its readable text.',
      source: 'app',
      policy: 'ask',
      defaultPolicy: 'ask',
    },
    {
      name: 'mcp_github_issues',
      description: 'List issues in a repository.',
      source: 'mcp',
      policy: 'ask',
      defaultPolicy: 'ask',
      mcp: { server: 'github', tool: 'issues' },
    },
    {
      name: 'mcp_old_thing',
      description: 'Named by the server only.',
      source: 'mcp',
      policy: 'ask',
      defaultPolicy: 'ask',
    },
  ],
  webSearchBackend: false,
};

const searx: ProviderPublic = {
  id: 'prv_s',
  category: 'search',
  kind: 'searxng',
  name: 'Home SearXNG',
  baseUrl: 'http://192.168.1.5:8080',
  hasKey: false,
  keyHint: null,
  enabled: true,
  shared: false,
  manualModels: [],
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  resetFakeSettings();
  mockBackend({ signedIn: true });
  server.use(
    http.get('/api/tools', () => HttpResponse.json(tools)),
    http.get('/api/providers', () => HttpResponse.json({ providers: [searx] })),
  );
});

/** The Tools page inside the app, so its links have a router. */
async function open() {
  const view = renderApp('/settings/tools');
  await screen.findByRole('heading', { level: 1, name: 'Tools' });
  return view;
}

test('engine change saves engine and a valid mode', async () => {
  const { user } = await open();
  const engine = screen.getByRole('combobox', { name: 'Search engine' });
  expect(engine).toHaveTextContent('Parallel');
  expect(screen.getByRole('combobox', { name: 'Search mode' })).toHaveTextContent('Fast');

  await user.click(engine);
  const exa = await screen.findByRole('option', { name: /Exa/ });
  expect(exa).toHaveTextContent('From $0.007 per search');
  await user.click(exa);
  expect(updateSettings).toHaveBeenLastCalledWith({ webSearch: { engine: 'exa', mode: 'auto' } });

  await user.click(screen.getByRole('combobox', { name: 'Search mode' }));
  await user.click(await screen.findByRole('option', { name: /Deep/ }));
  expect(updateSettings).toHaveBeenLastCalledWith({ webSearch: { mode: 'deep' } });

  // An engine without modes saves only the engine and hides the mode choice, whatever mode the
  // saved settings go on holding (a merge patch cannot store a null mode).
  await user.click(screen.getByRole('combobox', { name: 'Search engine' }));
  await user.click(await screen.findByRole('option', { name: /Perplexity/ }));
  expect(updateSettings).toHaveBeenLastCalledWith({ webSearch: { engine: 'perplexity' } });
  expect(getSettingsState().settings.webSearch.engine).toBe('perplexity');
  expect(screen.queryByRole('combobox', { name: 'Search mode' })).not.toBeInTheDocument();

  // Back on an engine with modes, it gets one of its own.
  await user.click(screen.getByRole('combobox', { name: 'Search engine' }));
  await user.click(await screen.findByRole('option', { name: /Parallel/ }));
  expect(updateSettings).toHaveBeenLastCalledWith({
    webSearch: { engine: 'parallel', mode: 'fast' },
  });
});

test.each(['firecrawl', 'native', 'auto'])('%s saves no mode and shows none', async (engine) => {
  setFakeSettings({ settings: { webSearch: { engine, mode: 'fast' } } });
  await open();
  expect(screen.queryByRole('combobox', { name: 'Search mode' })).not.toBeInTheDocument();
});

test('a stored mode the engine does not offer shows the engine’s first mode', async () => {
  setFakeSettings({ settings: { webSearch: { engine: 'exa', mode: 'fast' } } });
  await open();
  expect(screen.getByRole('combobox', { name: 'Search mode' })).toHaveTextContent('Auto');
});

test('web search defaults save', async () => {
  const { user } = await open();
  await user.click(screen.getByRole('switch', { name: 'Search the web by default' }));
  expect(updateSettings).toHaveBeenLastCalledWith({ webSearch: { defaultOn: true } });

  const results = screen.getByLabelText('Results per search');
  await user.clear(results);
  await user.type(results, '8');
  await user.tab();
  expect(updateSettings).toHaveBeenLastCalledWith({ webSearch: { maxResults: 8 } });

  await user.click(screen.getByRole('combobox', { name: 'Search backend' }));
  await user.click(await screen.findByRole('option', { name: 'Home SearXNG' }));
  expect(updateSettings).toHaveBeenLastCalledWith({ webSearch: { backendProviderId: 'prv_s' } });

  await user.click(screen.getByRole('combobox', { name: 'Context size' }));
  await user.click(await screen.findByRole('option', { name: 'High' }));
  expect(updateSettings).toHaveBeenLastCalledWith({ webSearch: { contextSize: 'high' } });
});

test('policy select saves per tool', async () => {
  setFakeSettings({ settings: { tools: { policies: { mcp_github_issues: 'off' } } } });
  const { user } = await open();
  const list = await screen.findByRole('list', { name: 'Tools' });
  const reader = within(list).getByRole('combobox', { name: 'Web page reader' });
  expect(reader).toHaveTextContent('Ask first');
  // Saved under its raw name, shown with its server; the raw name when the server gives no details.
  expect(within(list).getByRole('combobox', { name: 'github: issues' })).toHaveTextContent('Off');
  expect(within(list).getByRole('combobox', { name: 'mcp_old_thing' })).toBeInTheDocument();
  // MCP descriptions come from the server as plain text.
  expect(within(list).getByText('List issues in a repository.')).toBeInTheDocument();

  await user.click(reader);
  await user.click(await screen.findByRole('option', { name: 'Run automatically' }));
  expect(updateSettings).toHaveBeenLastCalledWith({ tools: { policies: { fetch_url: 'auto' } } });

  const steps = screen.getByLabelText('Most tool steps per answer');
  await user.clear(steps);
  await user.type(steps, '12');
  await user.tab();
  expect(updateSettings).toHaveBeenLastCalledWith({ tools: { maxSteps: 12 } });
});

test('a search backend change refreshes the tools only after the settings reach the server', async () => {
  let toolReads = 0;
  server.use(
    http.get('/api/tools', () => {
      toolReads += 1;
      return HttpResponse.json(tools);
    }),
  );
  let reached: () => void = () => {};
  flushSettings.mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        reached = r;
      }),
  );
  const { user } = await open();
  await screen.findByRole('list', { name: 'Tools' });
  const before = toolReads;
  await user.click(screen.getByRole('combobox', { name: 'Search backend' }));
  await user.click(await screen.findByRole('option', { name: 'Home SearXNG' }));
  expect(flushSettings).toHaveBeenCalled();
  await new Promise((r) => setTimeout(r, 30));
  expect(toolReads).toBe(before);
  reached();
  await waitFor(() => expect(toolReads).toBe(before + 1));
});

test.each([
  ['Results per search', '5'],
  ['Most searches per answer', '3'],
  ['Most tool steps per answer', '8'],
])('clearing %s puts the saved value back on blur', async (label, saved) => {
  const { user } = await open();
  const box = screen.getByLabelText(label);
  await user.clear(box);
  await user.tab();
  expect(box).toHaveValue(Number(saved));
  expect(updateSettings).not.toHaveBeenCalled();
});

test('the backend list has enabled providers only, and marks a chosen one that is off', async () => {
  const off: ProviderPublic = { ...searx, id: 'prv_off', name: 'Old Brave', enabled: false };
  const other: ProviderPublic = { ...searx, id: 'prv_o2', name: 'Spare Tavily', enabled: false };
  server.use(
    http.get('/api/providers', () => HttpResponse.json({ providers: [searx, off, other] })),
  );
  setFakeSettings({ settings: { webSearch: { backendProviderId: 'prv_off' } } });
  const { user } = await open();
  const select = await screen.findByRole('combobox', { name: 'Search backend' });
  await waitFor(() => expect(select).toHaveTextContent('Old Brave (turned off)'));
  await user.click(select);
  const names = (await screen.findAllByRole('option')).map((o) => o.textContent).join('|');
  expect(names).toContain('Home SearXNG');
  expect(names).toContain('Old Brave (turned off)');
  expect(names).not.toContain('Spare Tavily');
});

test('the backend select does not claim None while providers load or fail', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  server.use(
    http.get('/api/providers', async () => {
      await gate;
      return HttpResponse.json({ error: { code: 'internal', message: 'Nope.' } }, { status: 500 });
    }),
  );
  setFakeSettings({ settings: { webSearch: { backendProviderId: 'prv_s' } } });
  await open();
  const select = screen.getByRole('combobox', { name: 'Search backend' });
  expect(select).toHaveTextContent('Loading');
  expect(select).toBeDisabled();
  release();
  expect(
    await screen.findByText(
      'Search providers could not load. Check your connection and try again.',
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Search backend' })).not.toHaveTextContent('None');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  expect(updateSettings).not.toHaveBeenCalled();
});

test('links to the tool servers page', async () => {
  await open();
  expect(screen.getByRole('link', { name: 'Manage tool servers' })).toHaveAttribute(
    'href',
    '/settings/mcp',
  );
});

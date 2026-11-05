import type { ProviderPreset, ProviderPublic } from '@neotext/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import { qk } from '../../../lib/query';
import { modelsResponse } from '../../../test/model-fixtures';
import { server } from '../../../test/msw';
import { renderWithClient } from '../../../test/renderWithClient';
import { ProvidersSettings } from './ProvidersSettings';

const presets: ProviderPreset[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyRequired: true,
  },
  {
    id: 'custom',
    name: 'Custom endpoint',
    kind: 'openai-compatible',
    baseUrl: '',
    keyRequired: false,
  },
  { id: 'searxng', name: 'SearXNG', kind: 'searxng', baseUrl: '', keyRequired: false },
  {
    id: 'tavily',
    name: 'Tavily',
    kind: 'tavily',
    baseUrl: 'https://api.tavily.com',
    keyRequired: true,
  },
];

const openrouter: ProviderPublic = {
  id: 'prv_1',
  category: 'llm',
  kind: 'openrouter',
  name: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  hasKey: true,
  keyHint: 'sk-or-v1…6666',
  enabled: true,
  shared: false,
  manualModels: [],
  createdAt: 1,
  updatedAt: 1,
};
const local: ProviderPublic = {
  ...openrouter,
  id: 'prv_2',
  kind: 'openai-compatible',
  name: 'Home Ollama',
  baseUrl: 'http://localhost:11434/v1',
  hasKey: false,
  keyHint: null,
  enabled: false,
};

const signedInAs = (role: 'admin' | 'member') =>
  server.use(
    http.get('/api/auth/me', () =>
      HttpResponse.json({ user: { id: 'u1', username: 'ada', displayName: 'Ada', role } }),
    ),
  );

let providers: ProviderPublic[];
let counts: { providers: number };
let deleted: string[];
let created: { name: string; shared?: boolean }[];

beforeEach(() => {
  providers = [openrouter, local];
  counts = { providers: 0 };
  deleted = [];
  created = [];
  server.use(
    http.get('/api/provider-presets', () => HttpResponse.json({ presets })),
    http.get('/api/providers', () => {
      counts.providers += 1;
      return HttpResponse.json({ providers });
    }),
    http.post('/api/providers', async ({ request }) => {
      const body = (await request.json()) as { name: string; shared?: boolean };
      created.push(body);
      const made = {
        ...openrouter,
        id: 'prv_3',
        name: body.name,
        hasKey: false,
        keyHint: null,
        shared: body.shared === true,
      };
      providers = [...providers, made];
      return HttpResponse.json({ provider: made }, { status: 201 });
    }),
    http.delete('/api/providers/:id', ({ params }) => {
      deleted.push(String(params.id));
      providers = providers.filter((p) => p.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
});

test('lists each provider with its kind, key hint and status', async () => {
  renderWithClient(<ProvidersSettings />);
  const rows = await screen.findAllByRole('listitem');
  expect(within(rows[0] as HTMLElement).getByText('OpenRouter')).toBeInTheDocument();
  expect(within(rows[0] as HTMLElement).getByText('Saved: sk-or-v1…6666')).toBeInTheDocument();
  expect(within(rows[0] as HTMLElement).getByText('On')).toBeInTheDocument();
  expect(within(rows[1] as HTMLElement).getByText('Home Ollama')).toBeInTheDocument();
  expect(within(rows[1] as HTMLElement).getByText('OpenAI-compatible')).toBeInTheDocument();
  expect(within(rows[1] as HTMLElement).getByText('No key')).toBeInTheDocument();
  expect(within(rows[1] as HTMLElement).getByText('Off')).toBeInTheDocument();
  expect(screen.queryByText('sk-or-v1')).not.toBeInTheDocument();
});

test('says so when there is no provider yet', async () => {
  providers = [];
  renderWithClient(<ProvidersSettings />);
  expect(await screen.findByText(/No provider yet/)).toBeInTheDocument();
});

test('adding a provider refreshes the provider list and marks the model catalog stale', async () => {
  const { user, queryClient } = renderWithClient(<ProvidersSettings />);
  // The model picker is not open here, so the catalog is only marked stale; it reloads when used.
  queryClient.setQueryData(qk.models, modelsResponse([]));
  await screen.findByText('Home Ollama');
  const before = { ...counts };
  await user.click(screen.getByRole('button', { name: 'Add provider' }));
  const dialog = await screen.findByRole('dialog', { name: 'Add provider' });
  await user.clear(within(dialog).getByRole('textbox', { name: 'Name' }));
  await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Second router');
  await user.click(within(dialog).getByRole('button', { name: 'Add provider' }));
  expect(await screen.findByText('Second router')).toBeInTheDocument();
  expect(counts.providers).toBeGreaterThan(before.providers);
  await waitFor(() => expect(queryClient.getQueryState(qk.models)?.isInvalidated).toBe(true));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('deleting asks first and says what stays', async () => {
  const { user } = renderWithClient(<ProvidersSettings />);
  await user.click(await screen.findByRole('button', { name: 'Edit Home Ollama' }));
  const editor = await screen.findByRole('dialog', { name: 'Edit provider' });
  await user.click(within(editor).getByRole('button', { name: 'Delete provider' }));

  const confirm = await screen.findByRole('dialog', { name: 'Delete Home Ollama?' });
  expect(confirm).toHaveTextContent("Your chats stay. New messages can't use this provider.");
  expect(deleted).toEqual([]);
  await user.click(within(confirm).getByRole('button', { name: 'Delete provider' }));

  await waitFor(() => expect(deleted).toEqual(['prv_2']));
  await waitFor(() => expect(screen.queryByText('Home Ollama')).not.toBeInTheDocument());
});

test('keeping a provider leaves it alone', async () => {
  const { user } = renderWithClient(<ProvidersSettings />);
  await user.click(await screen.findByRole('button', { name: 'Edit Home Ollama' }));
  const editor = await screen.findByRole('dialog', { name: 'Edit provider' });
  await user.click(within(editor).getByRole('button', { name: 'Delete provider' }));
  const confirm = await screen.findByRole('dialog', { name: 'Delete Home Ollama?' });
  await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
  expect(deleted).toEqual([]);
});

test('a failed delete keeps the editor open and says why', async () => {
  server.use(
    http.delete('/api/providers/:id', () =>
      HttpResponse.json(
        { error: { code: 'internal', message: 'The server could not delete it.' } },
        { status: 500 },
      ),
    ),
  );
  const { user } = renderWithClient(<ProvidersSettings />);
  await user.click(await screen.findByRole('button', { name: 'Edit Home Ollama' }));
  const editor = await screen.findByRole('dialog', { name: 'Edit provider' });
  await user.click(within(editor).getByRole('button', { name: 'Delete provider' }));
  const confirm = await screen.findByRole('dialog', { name: 'Delete Home Ollama?' });
  await user.click(within(confirm).getByRole('button', { name: 'Delete provider' }));
  expect(await screen.findByText('The server could not delete it.')).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Delete Home Ollama?' })).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('dialog', { name: 'Edit provider' })).toBeInTheDocument();
});

test('search providers have their own group, apart from model providers', async () => {
  const brave: ProviderPublic = {
    ...openrouter,
    id: 'prv_9',
    category: 'search',
    kind: 'brave',
    name: 'Team Brave',
    baseUrl: 'https://api.search.brave.com',
  };
  providers = [openrouter, brave];
  const { user } = renderWithClient(<ProvidersSettings />);
  const models = await screen.findByRole('list', { name: 'Providers' });
  expect(within(models).queryByText('Team Brave')).not.toBeInTheDocument();
  const search = screen.getByRole('list', { name: 'Search providers' });
  expect(within(search).getByText('Team Brave')).toBeInTheDocument();
  expect(within(search).getByText('Brave Search')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Add search provider' }));
  const dialog = await screen.findByRole('dialog', { name: 'Add search provider' });
  await user.click(within(dialog).getByRole('combobox', { name: 'Service' }));
  const names = (await screen.findAllByRole('option')).map((o) => o.textContent);
  expect(names).toEqual(['SearXNG', 'Tavily']);
});

const lab: ProviderPublic = {
  ...openrouter,
  id: 'prv_lab',
  kind: 'openai-compatible',
  name: 'Lab GPUs',
  baseUrl: 'http://10.0.0.5:8000/v1',
  keyHint: null,
  shared: true,
};

test('a member sees a shared provider as shared by the admin, without edit controls', async () => {
  signedInAs('member');
  providers = [openrouter, lab];
  renderWithClient(<ProvidersSettings />);
  const row = (await screen.findByText('Lab GPUs')).closest('li') as HTMLElement;
  expect(within(row).getByText('Shared by your admin')).toBeInTheDocument();
  expect(within(row).queryByText('Key saved')).not.toBeInTheDocument();
  expect(within(row).queryByText('http://10.0.0.5:8000/v1')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit Lab GPUs' })).not.toBeInTheDocument();
  // Their own provider is still editable.
  expect(screen.getByRole('button', { name: 'Edit OpenRouter' })).toBeInTheDocument();
});

test('an admin can edit a shared provider and sees it marked as shared', async () => {
  signedInAs('admin');
  providers = [openrouter, lab];
  renderWithClient(<ProvidersSettings />);
  const row = (await screen.findByText('Lab GPUs')).closest('li') as HTMLElement;
  await waitFor(() => expect(within(row).getByText('Shared with everyone')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Edit Lab GPUs' })).toBeInTheDocument();
});

test('only an admin is offered the share switch, and it sends shared', async () => {
  signedInAs('member');
  const member = renderWithClient(<ProvidersSettings />);
  await screen.findByText('Home Ollama');
  await member.user.click(screen.getByRole('button', { name: 'Add provider' }));
  const memberDialog = await screen.findByRole('dialog', { name: 'Add provider' });
  expect(
    within(memberDialog).queryByRole('switch', { name: 'Share with everyone on this NeoText' }),
  ).not.toBeInTheDocument();
  member.unmount();

  signedInAs('admin');
  const { user } = renderWithClient(<ProvidersSettings />);
  await screen.findByText('Home Ollama');
  await user.click(screen.getByRole('button', { name: 'Add provider' }));
  const dialog = await screen.findByRole('dialog', { name: 'Add provider' });
  const share = await within(dialog).findByRole('switch', {
    name: 'Share with everyone on this NeoText',
  });
  await user.click(share);
  await user.clear(within(dialog).getByRole('textbox', { name: 'Name' }));
  await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Team router');
  await user.click(within(dialog).getByRole('button', { name: 'Add provider' }));
  await waitFor(() => expect(created).toHaveLength(1));
  expect(created[0]).toMatchObject({ kind: 'openrouter', name: 'Team router', shared: true });
});

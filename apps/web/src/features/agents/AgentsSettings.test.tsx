import type { AgentPublic } from '@neotext/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import { resetFakeSettings, updateSettings } from '../../test/fake-settings';
import { server } from '../../test/msw';
import { mockBackend, renderApp } from '../../test/renderApp';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

const agent = (over: Partial<AgentPublic> = {}): AgentPublic => ({
  id: 'agt_1',
  name: 'Reviewer',
  position: 'a0',
  createdAt: 0,
  updatedAt: 0,
  data: {
    description: 'Reviews frontend code',
    instructions: 'Be strict.',
    model: null,
    tools: { webSearch: true, fetchUrl: true },
    autoDelegate: false,
    enabled: true,
  },
  ...over,
});

beforeEach(() => {
  resetFakeSettings();
  mockBackend({ signedIn: true });
});

async function open(agents: AgentPublic[]) {
  server.use(http.get('/api/agents', () => HttpResponse.json({ agents })));
  const view = renderApp('/settings/agents');
  await screen.findByRole('heading', { level: 1, name: 'Agents' });
  return view;
}

test('lists agents', async () => {
  await open([agent()]);
  expect(await screen.findByText('Reviewer')).toBeInTheDocument();
  expect(screen.getByText('Reviews frontend code')).toBeInTheDocument();
});

test('shows an empty state', async () => {
  await open([]);
  expect(await screen.findByText(/No agents yet/)).toBeInTheDocument();
});

test('create sends the right body', async () => {
  let body: unknown;
  server.use(
    http.post('/api/agents', async ({ request }) => {
      body = await request.json();
      return HttpResponse.json(agent(), { status: 201 });
    }),
  );
  const { user } = await open([]);
  await user.click(await screen.findByRole('button', { name: 'New agent' }));
  const dialog = await screen.findByRole('dialog', { name: 'New agent' });
  await user.type(within(dialog).getByLabelText('Name'), 'Writer');
  await user.type(within(dialog).getByLabelText('When to use it'), 'Drafts text');
  await user.type(within(dialog).getByLabelText('Instructions'), 'Write well.');
  await user.click(within(dialog).getByRole('switch', { name: 'Can search the web' }));
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(body).toBeDefined());
  expect(body).toEqual({
    name: 'Writer',
    data: {
      description: 'Drafts text',
      instructions: 'Write well.',
      model: null,
      tools: { webSearch: false, fetchUrl: true },
      autoDelegate: false,
      enabled: true,
    },
  });
});

test('importing a .md fills the instructions', async () => {
  const { user } = await open([]);
  await user.click(await screen.findByRole('button', { name: 'New agent' }));
  const dialog = await screen.findByRole('dialog', { name: 'New agent' });
  const file = new File(['# Rules\nBe kind.'], 'rules.md', { type: 'text/markdown' });
  await user.upload(within(dialog).getByLabelText('Instructions file'), file);
  await waitFor(() =>
    expect((within(dialog).getByLabelText('Instructions') as HTMLTextAreaElement).value).toBe(
      '# Rules\nBe kind.',
    ),
  );
});

test('a file over 200 KB is refused', async () => {
  const { user } = await open([]);
  await user.click(await screen.findByRole('button', { name: 'New agent' }));
  const dialog = await screen.findByRole('dialog', { name: 'New agent' });
  const file = new File(['x'.repeat(200 * 1024 + 1)], 'big.md', { type: 'text/markdown' });
  await user.upload(within(dialog).getByLabelText('Instructions file'), file);
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('larger than 200 KB');
  expect((within(dialog).getByLabelText('Instructions') as HTMLTextAreaElement).value).toBe('');
});

test('delete asks before deleting', async () => {
  let deleted = false;
  server.use(
    http.delete('/api/agents/agt_1', () => {
      deleted = true;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { user } = await open([agent()]);
  await user.click(await screen.findByRole('button', { name: 'Delete Reviewer' }));
  const dialog = await screen.findByRole('dialog', { name: 'Delete Reviewer?' });
  expect(deleted).toBe(false);
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(deleted).toBe(true));
});

test('the sub-agent limit is saved to settings', async () => {
  const { user } = await open([]);
  const box = screen.getByLabelText('Most sub-agents per task');
  await user.clear(box);
  await user.type(box, '3');
  await user.tab();
  expect(updateSettings).toHaveBeenLastCalledWith({ tools: { maxSubagents: 3 } });
});

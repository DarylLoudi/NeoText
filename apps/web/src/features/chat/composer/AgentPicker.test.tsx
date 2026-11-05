import type { AgentPublic } from '@neotext/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { closeUserPersistence, openUserPersistence } from '../../../lib/persist/db';
import { flushDrafts } from '../../../lib/persist/drafts';
import { createQueryClient } from '../../../lib/query';
import { resetFakeSettings } from '../../../test/fake-settings';
import { deepseekFlash } from '../../../test/model-fixtures';
import { server } from '../../../test/msw';
import { TooltipProvider } from '../../../ui';
import { resetCompare, toggleCompare } from '../../compare/compare-state';
import { mentionQuery } from './AgentPicker';
import { Composer, type ComposerStream } from './Composer';

vi.mock('../../../state/settings', () => import('../../../test/fake-settings'));
vi.mock('../../../lib/api/tools', () => ({
  toolsApi: {
    list: async () => ({ tools: [], webSearchBackend: false }),
    meta: async () => ({ tools: [], webSearchBackend: false }),
  },
}));

function agent(id: string, name: string, enabled = true): AgentPublic {
  return {
    id,
    name,
    data: {
      description: `${name} helps.`,
      instructions: 'Be useful.',
      model: null,
      tools: { webSearch: true, fetchUrl: true },
      autoDelegate: false,
      enabled,
    },
    position: id,
    createdAt: 1,
    updatedAt: 1,
  };
}

const AGENTS = [
  agent('agt_1', 'Agent-Frontend'),
  agent('agt_2', 'Agent-Backend'),
  agent('agt_3', 'Agent-Retired', false),
];

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await openUserPersistence('u1');
  resetFakeSettings();
  resetCompare();
  server.use(
    http.get('/api/agents', () => HttpResponse.json({ agents: AGENTS })),
    http.get('/api/providers', () => HttpResponse.json({ providers: [] })),
    http.get('/api/models', () => HttpResponse.json({ providers: [] })),
    http.post('/api/providers/:id/warm', () => new HttpResponse(null, { status: 204 })),
  );
});
afterEach(async () => {
  await flushDrafts();
  closeUserPersistence();
});

function setup() {
  const s: ComposerStream = {
    send: vi.fn(async () => true),
    stop: vi.fn(),
    generating: false,
    ready: true,
  };
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <Composer conversationId={null} model={deepseekFlash} stream={s} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const box = () => screen.getByRole('textbox', { name: 'Message' });
  return { s, box, user: userEvent.setup() };
}

test('mentionQuery reads an @word only at the very start', () => {
  expect(mentionQuery('@fro', 4)).toBe('fro');
  expect(mentionQuery('@', 1)).toBe('');
  expect(mentionQuery('hi @fro', 7)).toBeNull();
  expect(mentionQuery('@fro end', 8)).toBeNull();
});

test('the agent menu lists only enabled agents, and the chosen one gets the message', async () => {
  const { s, box, user } = setup();
  await user.click(await screen.findByRole('button', { name: 'Agent' }));
  expect(await screen.findByRole('menuitem', { name: 'Agent-Frontend' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Agent-Backend' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Agent-Retired' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('menuitem', { name: 'Agent-Frontend' }));

  expect(await screen.findByRole('button', { name: 'Remove Agent-Frontend' })).toBeInTheDocument();
  await user.type(box(), 'Build the page');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(s.send).toHaveBeenCalledTimes(1));
  expect(s.send).toHaveBeenCalledWith(
    'Build the page',
    expect.objectContaining({ agentId: 'agt_1' }),
  );
  // The chip was for that message only.
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Remove Agent-Frontend' })).not.toBeInTheDocument(),
  );
  await user.type(box(), 'Next');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(s.send).toHaveBeenCalledTimes(2));
  expect(vi.mocked(s.send).mock.calls[1]?.[1]).not.toHaveProperty('agentId');
});

test('an @ at the start suggests agents; Enter picks one and leaves the rest of the text', async () => {
  const { s, box, user } = setup();
  await screen.findByRole('button', { name: 'Agent' });
  await user.click(box());
  await user.type(box(), '@back');
  const list = await screen.findByRole('listbox', { name: 'Agents' });
  expect(list).toHaveTextContent('Agent-Backend');
  expect(list).not.toHaveTextContent('Agent-Frontend');
  await user.keyboard('{Enter}');
  expect(screen.queryByRole('listbox', { name: 'Agents' })).not.toBeInTheDocument();
  expect(box()).toHaveValue('');
  expect(await screen.findByRole('button', { name: 'Remove Agent-Backend' })).toBeInTheDocument();
  expect(s.send).not.toHaveBeenCalled();
});

test('compare is off and cannot be turned on while an agent is chosen', async () => {
  toggleCompare(null);
  const { user } = setup();
  const compare = () => screen.getByRole('button', { name: 'Compare' });
  expect(compare()).toHaveAttribute('aria-pressed', 'true');
  await user.click(await screen.findByRole('button', { name: 'Agent' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Agent-Frontend' }));

  expect(compare()).toHaveAttribute('aria-pressed', 'false');
  expect(compare()).toHaveAttribute('aria-disabled', 'true');
  await user.hover(compare());
  expect(await screen.findByRole('tooltip', {}, { timeout: 2000 })).toHaveTextContent(
    'Agents answer alone',
  );
  await user.click(compare());
  expect(compare()).toHaveAttribute('aria-pressed', 'false');

  await user.click(screen.getByRole('button', { name: 'Remove Agent-Frontend' }));
  expect(compare()).not.toHaveAttribute('aria-disabled');
});

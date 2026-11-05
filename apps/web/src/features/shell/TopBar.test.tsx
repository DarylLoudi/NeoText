import type { ConversationDetail, Usage } from '@neotext/shared';
import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import { msg, summary } from '../../test/chat-fixtures';
import { resetFakeSettings, setFakeSettings } from '../../test/fake-settings';
import { modelInfo, modelsResponse } from '../../test/model-fixtures';
import { server } from '../../test/msw';
import { mockBackend, renderApp } from '../../test/renderApp';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

const usage = (costUsd: number | null): Usage => ({
  promptTokens: 10,
  completionTokens: 5,
  reasoningTokens: 0,
  cachedTokens: 0,
  costUsd,
  webSearchRequests: 0,
  ttftMs: null,
  durationMs: null,
  upstreamProvider: null,
  contextTokens: null,
});

// Two answers to one question (two branches) and one whose cost is unknown.
const detail: ConversationDetail = {
  conversation: summary({ id: 'cnv_1', title: 'Budget talk', activeLeafId: 'msg_b' }),
  messages: [
    msg({ id: 'msg_u', role: 'user', parts: [{ type: 'text', text: 'Hai' }] }),
    msg({ id: 'msg_a', parentId: 'msg_u', usage: usage(0.25) }),
    msg({ id: 'msg_b', parentId: 'msg_u', usage: usage(0.5) }),
    msg({ id: 'msg_c', parentId: 'msg_b', usage: usage(null) }),
  ],
};

beforeEach(() => {
  resetFakeSettings();
  mockBackend({ signedIn: true });
  server.use(http.get('/api/conversations/cnv_1', () => HttpResponse.json(detail)));
});

test('shows the chat total across every branch when costs are on', async () => {
  renderApp('/c/cnv_1');
  expect(
    await screen.findByText('Total cost of this chat, all branches: $0.75'),
  ).toBeInTheDocument();
  expect(screen.getByText('$0.75')).toBeInTheDocument();
});

test('shows no total when costs are off', async () => {
  setFakeSettings({ settings: { appearance: { showCost: false } } });
  renderApp('/c/cnv_1');
  expect(await screen.findByRole('button', { name: 'Budget talk' })).toBeInTheDocument();
  expect(screen.queryByText(/Total cost of this chat/)).toBeNull();
});

const answered = (modelId: string, promptTokens: number): ConversationDetail => ({
  conversation: summary({
    id: 'cnv_1',
    title: 'Budget talk',
    activeLeafId: 'msg_a',
    modelRef: { providerId: 'prv_1', modelId },
  }),
  messages: [
    msg({ id: 'msg_u', role: 'user', parts: [{ type: 'text', text: 'Hai' }] }),
    msg({ id: 'msg_a', parentId: 'msg_u', usage: { ...usage(null), promptTokens } }),
  ],
});

test('shows how much of the context window is used', async () => {
  server.use(
    http.get('/api/models', () => HttpResponse.json(modelsResponse())),
    http.get('/api/conversations/cnv_1', () =>
      HttpResponse.json(answered('deepseek/deepseek-v4.1-flash', 12_340)),
    ),
  );
  renderApp('/c/cnv_1');
  expect(
    await screen.findByRole('img', {
      name: 'Context window: 12,345 of 256,000 tokens used (243,655 left)',
    }),
  ).toBeInTheDocument();
  expect(screen.getByText('12.3k / 256k')).toBeInTheDocument();
});

test('hides the context meter when the size is unknown', async () => {
  server.use(
    http.get('/api/models', () =>
      HttpResponse.json(modelsResponse([modelInfo({ id: 'acme/free-1', contextLength: null })])),
    ),
    http.get('/api/conversations/cnv_1', () => HttpResponse.json(answered('acme/free-1', 12_340))),
  );
  renderApp('/c/cnv_1');
  expect(await screen.findByRole('button', { name: 'Budget talk' })).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /Context window/ })).toBeNull();
});

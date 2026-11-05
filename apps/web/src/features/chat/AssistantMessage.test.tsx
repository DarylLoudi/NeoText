import type { MessagePublic } from '@neotext/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, test, vi } from 'vitest';
import { setLocale } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query';
import { msg } from '../../test/chat-fixtures';
import { server } from '../../test/msw';
import { TooltipProvider } from '../../ui';
import { AssistantMessage } from './AssistantMessage';
import { type ChatActions, ChatActionsContext } from './MessageActions';

const usage = {
  promptTokens: 10,
  completionTokens: 20,
  reasoningTokens: 0,
  cachedTokens: 0,
  costUsd: 0.0004,
  webSearchRequests: 0,
  ttftMs: 300,
  durationMs: 2100,
  upstreamProvider: null,
  contextTokens: null,
};

interface SetupOptions {
  showCost?: boolean;
  reconnecting?: boolean;
  lost?: boolean;
  generating?: boolean;
  siblings?: number;
}

function setup(message: MessagePublic, opts: SetupOptions = {}) {
  const actions: ChatActions = {
    conversationId: 'cnv_1',
    generating: opts.generating ?? false,
    regenerate: vi.fn(async () => true),
    editAndResend: vi.fn(async () => true),
  };
  const siblingIds = [
    message.id,
    ...Array.from({ length: (opts.siblings ?? 1) - 1 }, (_, i) => `s${i}`),
  ];
  const item = { message, siblingIndex: 0, siblingCount: siblingIds.length, siblingIds };
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <ChatActionsContext.Provider value={actions}>
          <AssistantMessage
            item={item}
            showCost={opts.showCost ?? true}
            reconnecting={opts.reconnecting ?? false}
            lost={opts.lost ?? false}
          />
        </ChatActionsContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { actions, user: userEvent.setup() };
}

const answer = (over: Partial<MessagePublic> = {}) =>
  msg({
    id: 'a1',
    parentId: 'u1',
    model: { providerId: 'prv_1', modelId: 'deepseek/deepseek-v4.1-flash' },
    parts: [{ type: 'text', text: 'Here is a structure.' }],
    usage,
    finishReason: 'stop',
    ...over,
  });

test('shows the short model name, duration and cost when enabled', () => {
  setup(answer());
  expect(screen.getByText('deepseek v4.1 flash')).toBeInTheDocument();
  expect(screen.getByText('2.1 s')).toBeInTheDocument();
  expect(screen.getByText('$0.0004')).toBeInTheDocument();
  expect(screen.getByText('Here is a structure.')).toBeInTheDocument();
});

test('an agent answer names the agent before the model, and the agent part shows nothing', () => {
  setup(
    answer({
      parts: [
        { type: 'agent', agentId: 'agt_1', name: 'Agent-Frontend' },
        { type: 'text', text: 'Here is a structure.' },
      ],
    }),
  );
  const agent = screen.getByText('Agent-Frontend');
  const model = screen.getByText('deepseek v4.1 flash');
  expect(agent.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getAllByText('Agent-Frontend')).toHaveLength(1);
});

test('shows cost only when enabled', () => {
  setup(answer(), { showCost: false });
  expect(screen.queryByText('$0.0004')).not.toBeInTheDocument();
  expect(screen.getByText('2.1 s')).toBeInTheDocument();
});

test('error part offers retry', async () => {
  const { actions, user } = setup(
    answer({
      status: 'error',
      finishReason: 'error',
      parts: [
        { type: 'text', text: 'Partial' },
        { type: 'error', code: 'upstream_timeout', message: 'The provider timed out. Try again.' },
      ],
    }),
  );
  expect(screen.getByText('The provider timed out. Try again.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(actions.regenerate).toHaveBeenCalledWith('u1');
});

test('an answer budget spent on thinking is explained in the reader language', () => {
  const spent = answer({
    status: 'error',
    finishReason: 'error',
    parts: [{ type: 'error', code: 'thinking_budget', message: 'Server copy.' }],
  });
  setup(spent);
  expect(
    screen.getByText(
      'The model used its whole answer budget on thinking. Try again, or raise the answer length or lower the reasoning effort.',
    ),
  ).toBeInTheDocument();
  act(() => setLocale('id'));
  try {
    expect(
      screen.getByText(
        'Model memakai seluruh jatah jawabannya untuk berpikir. Coba lagi, atau naikkan panjang jawaban, atau turunkan tingkat penalaran.',
      ),
    ).toBeInTheDocument();
  } finally {
    act(() => setLocale('en'));
  }
});

test('interrupted and aborted notes', () => {
  setup(answer({ id: 'a2', status: 'interrupted', finishReason: null }));
  expect(
    screen.getByText('The server restarted while this was being written. You can regenerate it.'),
  ).toBeInTheDocument();
  setup(answer({ id: 'a3', status: 'aborted', finishReason: null }));
  expect(screen.getByText('Stopped.')).toBeInTheDocument();
});

test('length, unknown finish and reconnecting notes', () => {
  setup(answer({ id: 'a4', finishReason: 'length' }));
  expect(screen.getByText('Cut off at the length limit.')).toBeInTheDocument();
  setup(answer({ id: 'a5', finishReason: 'unknown' }));
  expect(screen.getByText('This answer may be cut off.')).toBeInTheDocument();
  setup(answer({ id: 'a6', status: 'streaming', finishReason: null }), { reconnecting: true });
  expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
});

test('streaming shows the caret and hides the actions', () => {
  setup(answer({ status: 'streaming', finishReason: null, usage: null }));
  expect(document.querySelector('[data-caret]')).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'Regenerate' })).not.toBeInTheDocument();
});

test('a finished answer can be regenerated', async () => {
  const { actions, user } = setup(answer());
  await user.click(screen.getByRole('button', { name: 'Regenerate' }));
  expect(actions.regenerate).toHaveBeenCalledWith('u1');
});

test('a lost connection shows its note instead of the caret', () => {
  setup(answer({ status: 'streaming', finishReason: null, usage: null }), { lost: true });
  expect(screen.getByText('Lost the connection. Reload to see the rest.')).toBeInTheDocument();
  expect(document.querySelector('[data-caret]')).toBeNull();
  expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();
});

test('versions cannot be switched while an answer is being written', () => {
  setup(answer(), { generating: true, siblings: 2 });
  expect(screen.getByRole('button', { name: 'Next version' })).toBeDisabled();
});

test('the answer is not busy while a tool waits for you, so its buttons stay reachable', () => {
  server.use(http.get('/api/generations/active', () => HttpResponse.json({ items: [] })));
  setup(
    answer({
      id: 'a_wait',
      status: 'streaming',
      finishReason: null,
      parts: [
        {
          type: 'tool_call',
          id: 'c1',
          name: 'fetch_url',
          source: 'app',
          args: '{}',
          status: 'awaiting_approval',
          result: null,
          startedAt: 1,
          finishedAt: null,
        },
      ],
    }),
  );
  expect(document.querySelector('[aria-busy="true"]')).toBeNull();
});

test('an agent answer is named while it still streams', () => {
  setup(
    answer({
      status: 'streaming',
      finishReason: null,
      usage: null,
      parts: [
        { type: 'agent', agentId: 'agt_1', name: 'Agent-Frontend' },
        { type: 'text', text: 'Working' },
      ],
    }),
  );
  expect(screen.getByText('Agent-Frontend')).toBeInTheDocument();
});

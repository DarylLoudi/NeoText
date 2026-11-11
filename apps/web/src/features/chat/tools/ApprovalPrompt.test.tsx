import type { MessagePublic, ToolCallPart } from '@neotext/shared';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { qk } from '../../../lib/query';
import { flushEvents, ingestEvents, markLost, resetGenerations } from '../../../state/generations';
import { msg } from '../../../test/chat-fixtures';
import { refetchSettings, resetFakeSettings } from '../../../test/fake-settings';
import { server } from '../../../test/msw';
import { renderWithClient } from '../../../test/renderWithClient';
import { PartRenderer } from '../PartRenderer';
import { APPROVAL_ARGS_MAX, ApprovalPrompt } from './ApprovalPrompt';

const waiting: ToolCallPart = {
  type: 'tool_call',
  id: 'call_7',
  name: 'fetch_url',
  source: 'app',
  args: '{"url":"https://example.com/a"}',
  status: 'awaiting_approval',
  result: null,
  startedAt: 1,
  finishedAt: null,
};

vi.mock('../../../state/settings', () => import('../../../test/fake-settings'));

beforeEach(() => {
  resetFakeSettings();
  server.use(
    http.get('/api/tools', () =>
      HttpResponse.json({
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
      }),
    ),
  );
});
afterEach(() => {
  // Unmounted first: a mounted prompt that loses its generation asks the server what is active.
  cleanup();
  resetGenerations();
});

function recordApprovals(status = 204) {
  const bodies: unknown[] = [];
  server.use(
    http.post('/api/generations/:id/approvals', async ({ request, params }) => {
      bodies.push({ id: params.id, body: await request.json() });
      if (status === 204) return new HttpResponse(null, { status });
      return HttpResponse.json(
        { error: { code: 'not_found', message: 'That tool call is not waiting any more.' } },
        { status },
      );
    }),
  );
  return bodies;
}

test('allow calls the endpoint', async () => {
  const bodies = recordApprovals();
  const { user, rerender } = renderWithClient(
    <ApprovalPrompt call={waiting} generationId="gen_1" />,
  );
  expect(screen.getByText('Web page reader wants to run')).toBeInTheDocument();
  expect(document.querySelector('pre')?.textContent).toBe('{\n  "url": "https://example.com/a"\n}');

  await user.click(screen.getByRole('button', { name: 'Allow' }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toEqual({
    id: 'gen_1',
    body: { callId: 'call_7', decision: 'allow', remember: false },
  });

  rerender(<ApprovalPrompt call={{ ...waiting, id: 'call_8' }} generationId="gen_1" />);
  await user.click(screen.getByRole('button', { name: 'Always allow' }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toMatchObject({
    body: { callId: 'call_8', decision: 'allow', remember: true },
  });

  rerender(<ApprovalPrompt call={{ ...waiting, id: 'call_9' }} generationId="gen_1" />);
  await user.click(screen.getByRole('button', { name: 'Decline' }));
  await waitFor(() => expect(bodies).toHaveLength(3));
  expect(bodies[2]).toMatchObject({
    body: { callId: 'call_9', decision: 'deny', remember: false },
  });
});

test('a failed answer says why and lets you choose again', async () => {
  recordApprovals(404);
  const { user } = renderWithClient(<ApprovalPrompt call={waiting} generationId="gen_1" />);
  await user.click(screen.getByRole('button', { name: 'Allow' }));
  expect(await screen.findByText('That tool call is not waiting any more.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
});

test('the prompt comes back after a resume, from the generation snapshot', async () => {
  const bodies = recordApprovals();
  const stale: MessagePublic = msg({ id: 'msg_a', status: 'streaming', parts: [] });
  // A reload: the page has only the saved message, then the resume stream's snapshot arrives.
  const live: MessagePublic = {
    ...stale,
    parts: [{ type: 'text', text: 'Let me check.' }, waiting],
  };
  act(() => {
    ingestEvents([{ type: 'generation.snapshot', generationId: 'gen_2', seq: 4, message: live }]);
    flushEvents();
  });
  const part = live.parts[1] as ToolCallPart;
  const { user } = renderWithClient(
    <PartRenderer part={part} message={live} live={false} codeTheme="auto" />,
  );
  expect(await screen.findByText('Web page reader wants to run')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Allow' }));
  await waitFor(() => expect(bodies).toEqual([expect.objectContaining({ id: 'gen_2' })]));
});

test('always allow refreshes the settings and the tools list; other answers do not', async () => {
  recordApprovals();
  const { user, rerender, queryClient } = renderWithClient(
    <ApprovalPrompt call={waiting} generationId="gen_1" />,
  );
  queryClient.setQueryData(qk.tools, { tools: [], webSearchBackend: false });
  await user.click(screen.getByRole('button', { name: 'Allow' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled());
  expect(refetchSettings).not.toHaveBeenCalled();
  expect(queryClient.getQueryState(qk.tools)?.isInvalidated).toBe(false);

  rerender(<ApprovalPrompt call={{ ...waiting, id: 'call_8' }} generationId="gen_1" />);
  await user.click(screen.getByRole('button', { name: 'Always allow' }));
  await waitFor(() => expect(refetchSettings).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(queryClient.getQueryState(qk.tools)?.isInvalidated).toBe(true));
});

test('a failed always allow changes nothing on this page', async () => {
  recordApprovals(404);
  const { user } = renderWithClient(<ApprovalPrompt call={waiting} generationId="gen_1" />);
  await user.click(screen.getByRole('button', { name: 'Always allow' }));
  await screen.findByRole('alert');
  expect(refetchSettings).not.toHaveBeenCalled();
});

test('a double click sends one answer', async () => {
  const bodies = recordApprovals();
  const { user } = renderWithClient(<ApprovalPrompt call={waiting} generationId="gen_1" />);
  await user.dblClick(screen.getByRole('button', { name: 'Allow' }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  await new Promise((r) => setTimeout(r, 30));
  expect(bodies).toHaveLength(1);
});

test('spoofing characters in arguments show as escapes; the answer is unchanged', async () => {
  const bodies = recordApprovals();
  const spoof: ToolCallPart = {
    ...waiting,
    args: JSON.stringify({ path: '/tmp/\u202Etxt.exe', note: 'pay\u200Bment' }),
  };
  const { user } = renderWithClient(<ApprovalPrompt call={spoof} generationId="gen_1" />);
  const pre = document.querySelector('pre') as HTMLElement;
  expect(pre.textContent).toContain('/tmp/\\u202Etxt.exe');
  expect(pre.textContent).toContain('pay\\u200Bment');
  expect(pre.textContent).not.toMatch(/[\u202E\u200B]/);
  expect(pre).toHaveAttribute('dir', 'ltr');
  await user.click(screen.getByRole('button', { name: 'Allow' }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toMatchObject({ body: { callId: 'call_7' } });
});

test('names the server of an MCP tool, and the raw name when it cannot', async () => {
  const mcp: ToolCallPart = { ...waiting, name: 'mcp_web_search', source: 'mcp', args: '{}' };
  const { rerender } = renderWithClient(<ApprovalPrompt call={mcp} generationId="gen_1" />);
  expect(screen.getByText('mcp_web_search wants to run')).toBeInTheDocument();
  expect(await screen.findByText('web: search wants to run')).toBeInTheDocument();
  rerender(<ApprovalPrompt call={{ ...mcp, name: 'mcp_gone_tool' }} generationId="gen_1" />);
  expect(screen.getByText('mcp_gone_tool wants to run')).toBeInTheDocument();
});

test('the prompt is a labelled group, announced politely, with scrollable arguments', async () => {
  renderWithClient(<ApprovalPrompt call={waiting} generationId="gen_1" />);
  expect(screen.getByRole('group', { name: 'Web page reader wants to run' })).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Web page reader wants to run. Choose Allow, Always allow or Decline.',
    ),
  );
  expect(document.querySelector('pre')).toHaveAttribute('tabindex', '0');
});

test('the prompt shows arguments in full, so a target cannot hide past a cap', () => {
  const args = JSON.stringify({ note: 'A'.repeat(3990), url: 'https://evil.example/steal' });
  renderWithClient(<ApprovalPrompt call={{ ...waiting, args }} generationId="gen_1" />);
  expect(document.querySelector('pre')?.textContent).toContain('https://evil.example/steal');
  expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
  expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument();
});

test('arguments right at the limit still show in full and can be allowed', () => {
  const args = 'z'.repeat(APPROVAL_ARGS_MAX);
  renderWithClient(<ApprovalPrompt call={{ ...waiting, args }} generationId="gen_1" />);
  expect(document.querySelector('pre')?.textContent).toHaveLength(APPROVAL_ARGS_MAX);
  expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
});

test('arguments too long to review cannot be allowed, only declined', async () => {
  const bodies = recordApprovals();
  const args = 'z'.repeat(65 * 1024);
  const { user } = renderWithClient(
    <ApprovalPrompt call={{ ...waiting, args }} generationId="gen_1" />,
  );
  expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Always allow' })).toBeDisabled();
  // Shown, and announced.
  expect(screen.getAllByText(/too long to review/).length).toBeGreaterThan(0);
  await user.click(screen.getByRole('button', { name: 'Decline' }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toMatchObject({ body: { decision: 'deny' } });
});

describe('the cue for arguments past the fold', () => {
  let scrollHeight = 0;
  let clientHeight = 0;
  let observed: (() => void) | null = null;

  beforeEach(() => {
    scrollHeight = 400;
    clientHeight = 192;
    observed = null;
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => clientHeight,
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          observed = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
    Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    vi.unstubAllGlobals();
  });

  test('shows while more follows, clears at the end, and never gates the buttons', () => {
    renderWithClient(<ApprovalPrompt call={waiting} generationId="gen_1" />);
    const pre = document.querySelector('pre') as HTMLElement;
    expect(screen.getByText('More below')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();

    pre.scrollTop = 100;
    fireEvent.scroll(pre);
    expect(screen.getByText('More below')).toBeInTheDocument();

    pre.scrollTop = 208;
    fireEvent.scroll(pre);
    expect(screen.queryByText('More below')).not.toBeInTheDocument();

    pre.scrollTop = 0;
    fireEvent.scroll(pre);
    expect(screen.getByText('More below')).toBeInTheDocument();
  });

  test('follows the box when its size changes', () => {
    scrollHeight = 192;
    renderWithClient(<ApprovalPrompt call={waiting} generationId="gen_1" />);
    expect(screen.queryByText('More below')).not.toBeInTheDocument();
    scrollHeight = 400;
    act(() => observed?.());
    expect(screen.getByText('More below')).toBeInTheDocument();
    clientHeight = 400;
    act(() => observed?.());
    expect(screen.queryByText('More below')).not.toBeInTheDocument();
  });
});

test('during a reload the saved prompt waits quietly until the active list is known', async () => {
  let answer: () => void = () => {};
  const gate = new Promise<void>((r) => {
    answer = r;
  });
  server.use(
    http.get('/api/generations/active', async () => {
      await gate;
      return HttpResponse.json({ items: [] });
    }),
  );
  const saved = msg({ id: 'msg_b', status: 'streaming', parts: [waiting] });
  renderWithClient(<PartRenderer part={waiting} message={saved} live={false} codeTheme="auto" />);
  // Not known yet: the question shows, with nothing to press and no claim that it has ended.
  expect(screen.getByText('Web page reader wants to run')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
  expect(screen.queryByText('Interrupted')).not.toBeInTheDocument();
  answer();
  // Known, and nothing runs for this message.
  expect(await screen.findByText('Interrupted')).toBeInTheDocument();
  expect(screen.queryByText('Web page reader wants to run')).not.toBeInTheDocument();
});

test('a saved running call stops spinning once nothing runs for it', async () => {
  server.use(http.get('/api/generations/active', () => HttpResponse.json({ items: [] })));
  const running: ToolCallPart = { ...waiting, status: 'running' };
  const saved = msg({ id: 'msg_c', status: 'streaming', parts: [running] });
  renderWithClient(<PartRenderer part={running} message={saved} live={false} codeTheme="auto" />);
  expect(screen.getByText('Reading a web page')).toBeInTheDocument();
  expect(await screen.findByText('Interrupted')).toBeInTheDocument();
});

test('a call left unfinished in an ended message is interrupted without asking the server', () => {
  const ended = msg({ id: 'msg_d', status: 'interrupted', parts: [waiting] });
  renderWithClient(<PartRenderer part={waiting} message={ended} live={false} codeTheme="auto" />);
  expect(screen.getByText('Interrupted')).toBeInTheDocument();
});

test('a call in a generation this page lost contact with stops waiting', async () => {
  const live: MessagePublic = msg({ id: 'msg_e', status: 'streaming', parts: [waiting] });
  act(() => {
    ingestEvents([{ type: 'generation.snapshot', generationId: 'gen_5', seq: 1, message: live }]);
    flushEvents();
    markLost('gen_5');
  });
  renderWithClient(<PartRenderer part={waiting} message={live} live={false} codeTheme="auto" />);
  expect(screen.getByText('Interrupted')).toBeInTheDocument();
});

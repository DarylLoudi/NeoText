import type { ToolCallPart } from '@neotext/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import { qk } from '../../../lib/query';
import { server } from '../../../test/msw';
import { renderWithClient } from '../../../test/renderWithClient';
import { ToolCallBlock } from './ToolCallBlock';

function call(over: Partial<ToolCallPart> = {}): ToolCallPart {
  return {
    type: 'tool_call',
    id: 'call_1',
    name: 'fetch_url',
    source: 'app',
    args: '{"url":"https://example.com/guide"}',
    status: 'ok',
    result: 'Example guide text',
    startedAt: 1_000,
    finishedAt: 2_500,
    ...over,
  };
}

beforeEach(() => {
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

test('row labels and states', async () => {
  const { user, rerender } = renderWithClient(
    <ToolCallBlock part={call({ status: 'running', result: null, finishedAt: null })} />,
  );
  // Running: a spinner with the present-tense label, no duration yet.
  const running = screen.getByText('Reading a web page').closest('details');
  expect(running).toHaveAttribute('aria-busy', 'true');
  expect(running?.querySelector('[class*="spinner"]')).not.toBeNull();
  expect(screen.queryByText(/\ds$/)).not.toBeInTheDocument();

  rerender(<ToolCallBlock part={call()} />);
  expect(screen.getByText('Read a web page')).toBeInTheDocument();
  expect(screen.getByText('example.com')).toBeInTheDocument();
  expect(screen.getByText('1.5 s')).toBeInTheDocument();

  rerender(<ToolCallBlock part={call({ status: 'error', result: 'The page did not answer.' })} />);
  expect(screen.getByText('Failed')).toBeInTheDocument();

  rerender(<ToolCallBlock part={call({ status: 'denied', result: null })} />);
  expect(screen.getByText('Declined')).toBeInTheDocument();

  rerender(
    <ToolCallBlock
      part={call({ name: 'web_search', args: '{"query":"bun vs node"}', result: '3 results' })}
    />,
  );
  expect(screen.getByText('Searched the web')).toBeInTheDocument();
  expect(screen.getByText('bun vs node')).toBeInTheDocument();

  rerender(
    <ToolCallBlock
      part={call({ name: 'mcp_github_issues', source: 'mcp', args: '{"repo":"a/b","n":2}' })}
    />,
  );
  // An MCP tool the server does not list any more shows its full raw name.
  expect(await screen.findByText('Used mcp_github_issues')).toBeInTheDocument();

  // The disclosure shows the arguments as indented JSON and the result as text.
  const summary = screen.getByText('Used mcp_github_issues').closest('summary');
  if (!summary) throw new Error('no summary');
  await user.click(summary);
  const details = summary.parentElement as HTMLElement;
  expect(within(details).getByText('Arguments')).toBeInTheDocument();
  const args = details.querySelector('pre');
  expect(args?.textContent).toBe('{\n  "repo": "a/b",\n  "n": 2\n}');
  expect(within(details).getByText('Example guide text')).toBeInTheDocument();
});

test('arguments that are not JSON show as they came', async () => {
  const { user } = renderWithClient(<ToolCallBlock part={call({ args: '{"url": broken' })} />);
  await user.click(screen.getByText('Read a web page'));
  expect(document.querySelector('pre')?.textContent).toBe('{"url": broken');
});

test('result text is not interpreted as HTML', async () => {
  const hostile = '<img src=x onerror="window.__pwned=1"><b>bold</b> **not markdown**';
  const { user, container } = renderWithClient(
    <ToolCallBlock part={call({ result: hostile, args: '{"url":"<script>x</script>"}' })} />,
  );
  await user.click(screen.getByText('Read a web page'));
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('b')).toBeNull();
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('strong')).toBeNull();
  expect(screen.getByText(hostile)).toBeInTheDocument();
});

test('an MCP call names its tool and server, so it cannot pass for a built-in tool', async () => {
  renderWithClient(
    <ToolCallBlock part={call({ name: 'mcp_web_search', source: 'mcp', args: '{}' })} />,
  );
  // The full name until the server's list has arrived.
  expect(screen.getByText('Used mcp_web_search')).toBeInTheDocument();
  expect(await screen.findByText('Used web: search')).toBeInTheDocument();
});

test('a declined or timed-out call shows no duration', () => {
  renderWithClient(
    <ToolCallBlock part={call({ status: 'denied', startedAt: 1_000, finishedAt: 601_000 })} />,
  );
  expect(screen.getByText('Declined')).toBeInTheDocument();
  expect(screen.queryByText(/\d (ms|s|min)$/)).not.toBeInTheDocument();
});

test('bidi and invisible characters show as visible escapes in the row', async () => {
  const name = 'odd\u202Ename';
  const args = JSON.stringify({ query: 'safe\u202Etxt.exe', note: 'a\u200Bb\u{E0041}c\u00AD' });
  const { user, container } = renderWithClient(
    <ToolCallBlock part={call({ name, source: 'provider', args })} />,
  );
  const label = screen.getByText('Used odd\\u202Ename');
  expect(label).toHaveAttribute('dir', 'ltr');
  await user.click(label);
  const pre = container.querySelector('pre');
  expect(pre?.textContent).toContain('safe\\u202Etxt.exe');
  expect(pre?.textContent).toContain('a\\u200Bb\\u{E0041}c\\u00AD');
  expect(pre).toHaveAttribute('dir', 'ltr');
  expect(container.textContent).not.toMatch(/[\u202E\u200B\u00AD]|\u{E0041}/u);
});

test('web_search detail shows escapes too', () => {
  renderWithClient(
    <ToolCallBlock part={call({ name: 'web_search', args: '{"query":"a\u2066b"}' })} />,
  );
  const detail = screen.getByText('a\\u2066b');
  expect(detail).toHaveAttribute('dir', 'ltr');
});

test('a long name keeps its full text as a title', async () => {
  const name = `mcp_${'x'.repeat(60)}`;
  const { queryClient } = renderWithClient(
    <ToolCallBlock part={call({ name, source: 'mcp', args: '{}' })} />,
  );
  expect(screen.getByText(`Used ${name}`)).toHaveAttribute('title', `Used ${name}`);
  await waitFor(() => expect(queryClient.getQueryState(qk.tools)?.status).toBe('success'));
});

test('a call whose generation ended shows as interrupted, not running or waiting', () => {
  const { rerender, container } = renderWithClient(
    <ToolCallBlock part={call({ status: 'running', result: null, finishedAt: null })} ended />,
  );
  expect(screen.getByText('Interrupted')).toBeInTheDocument();
  expect(screen.getByText('Read a web page').closest('details')).not.toHaveAttribute('aria-busy');
  expect(container.querySelector('[class*="spinner"]')).toBeNull();

  rerender(
    <ToolCallBlock
      part={call({ status: 'awaiting_approval', result: null, finishedAt: null })}
      ended
    />,
  );
  expect(screen.getByText('Interrupted')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
});

test('long arguments are cut at 4,000 characters, with a note', async () => {
  const { user, container } = renderWithClient(
    <ToolCallBlock part={call({ args: `not json ${'y'.repeat(5000)}` })} />,
  );
  await user.click(screen.getByText('Read a web page'));
  expect(container.querySelector('pre')?.textContent).toHaveLength(4000);
  expect(screen.getByText('Showing the first 4000 characters.')).toBeInTheDocument();
});

test('arguments are parsed once while the call does not change', () => {
  const args = '{"url":"https://example.com/once"}';
  const parse = vi.spyOn(JSON, 'parse');
  const { rerender } = renderWithClient(<ToolCallBlock part={call({ args })} />);
  const parsedArgs = () => parse.mock.calls.filter(([text]) => text === args).length;
  const first = parsedArgs();
  expect(first).toBeGreaterThan(0);
  rerender(<ToolCallBlock part={call({ args, finishedAt: 3_000 })} />);
  expect(parsedArgs()).toBe(first);
  parse.mockRestore();
});

test('a call nobody answered says so, and does not claim you declined it', () => {
  renderWithClient(
    <ToolCallBlock
      part={call({
        status: 'no_answer',
        result: 'Timed out.',
        startedAt: 1_000,
        finishedAt: 601_000,
      })}
    />,
  );
  expect(screen.getByText('No answer')).toBeInTheDocument();
  expect(screen.queryByText('Declined')).not.toBeInTheDocument();
  expect(screen.queryByText(/\d (ms|s|min)$/)).not.toBeInTheDocument();
});

test('look-alike spaces in a name show as escapes; arguments keep their whitespace', async () => {
  const name = 'read\u00A0all\u2003files\u3000now\u2800';
  const args = '{"text":"a\u00A0b\u3000c"}';
  const { user, container } = renderWithClient(
    <ToolCallBlock part={call({ name, source: 'provider', args })} />,
  );
  const label = screen.getByText('Used read\\u00A0all\\u2003files\\u3000now\\u2800');
  await user.click(label);
  expect(container.querySelector('pre')?.textContent).toContain('a\u00A0b\u3000c');
});

test('a tool name longer than the limit is cut, whatever sent it', async () => {
  const long = 'Safe to allow. '.repeat(100);
  server.use(
    http.get('/api/tools', () =>
      HttpResponse.json({
        webSearchBackend: false,
        tools: [
          {
            name: 'mcp_x_y',
            description: '',
            source: 'mcp',
            policy: 'ask',
            defaultPolicy: 'ask',
            mcp: { server: 'x', tool: long },
          },
        ],
      }),
    ),
  );
  renderWithClient(<ToolCallBlock part={call({ name: 'mcp_x_y', source: 'mcp', args: '{}' })} />);
  const label = await screen.findByText(/^Used x: Safe to allow/);
  expect(label.textContent?.length).toBeLessThan(80);
  expect(label.textContent).toMatch(/\u2026$/u);
});

import type { MessagePart, MessagePublic } from '@neotext/shared';
import { renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';
import { msg } from '../../test/chat-fixtures';
import { usePanelProject } from './panel-project';

const write = (id: string, path: string, status: 'ok' | 'running' = 'ok'): MessagePart => ({
  type: 'tool_call',
  id,
  name: 'write_file',
  source: 'app',
  args: JSON.stringify({ path, content: `<h1>${path}</h1>` }),
  status,
  result: null,
  startedAt: 0,
  finishedAt: 0,
});
const text = (t: string): MessagePart => ({ type: 'text', text: t });
const user = msg({ id: 'u1', role: 'user', parts: [text('go')] });
const done = msg({ id: 'a1', parts: [write('c1', 'index.html')] });
const live = (parts: MessagePart[]): MessagePublic => msg({ id: 'a2', status: 'streaming', parts });

test('prose streaming into an answer reuses the project it had', () => {
  const { result, rerender } = renderHook(({ path }) => usePanelProject(path), {
    initialProps: { path: [user, done, live([write('c2', 'b.html'), text('Now')])] },
  });
  const first = result.current;
  expect(first.versions).toHaveLength(2);
  rerender({ path: [user, done, live([write('c2', 'b.html'), text('Now the rest')])] });
  expect(result.current).toBe(first);
  // A call still running is not a change yet either.
  rerender({
    path: [
      user,
      done,
      live([write('c2', 'b.html'), text('More'), write('c3', 'c.html', 'running')]),
    ],
  });
  expect(result.current).toBe(first);
});

test('a finished call, or another message, makes a new project', () => {
  const { result, rerender } = renderHook(({ path }) => usePanelProject(path), {
    initialProps: { path: [user, done, live([text('a')])] },
  });
  const first = result.current;
  expect(first.versions).toHaveLength(1);
  rerender({ path: [user, done, live([text('a'), write('c2', 'b.html')])] });
  expect(result.current).not.toBe(first);
  expect(result.current.versions).toHaveLength(2);
  const second = result.current;
  rerender({ path: [user, done] });
  expect(result.current).not.toBe(second);
  expect(result.current.versions).toHaveLength(1);
});

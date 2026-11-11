import { expect, test } from 'vitest';
import {
  call,
  start,
  stop,
  text,
  tool,
  toolCalls,
  toolParts,
  waitFor,
} from '../../../test-support/tool-harness';

test('ordered tools run in call order, even when the later call is approved first', async () => {
  const ran: string[] = [];
  const t = tool(
    'write',
    async (args) => {
      ran.push((args as { q: string }).q);
      return { ok: true, content: 'done' };
    },
    { defaultPolicy: 'ask', ordered: true },
  );
  const s = start(
    [
      [...call(0, 'a', 'write', '{"q":"a"}'), ...call(1, 'b', 'write', '{"q":"b"}'), toolCalls],
      [text('ok'), stop],
    ],
    [t],
  );
  const asking = () =>
    toolParts(s.generation.snapshot()).filter((p) => p.status === 'awaiting_approval').length;
  await waitFor(() => asking() === 2);
  expect(s.generation.resolveApproval('b', 'allow')).toBe(true);
  await new Promise((r) => setTimeout(r, 20));
  expect(ran).toEqual([]);
  expect(s.generation.resolveApproval('a', 'allow')).toBe(true);
  await s.finished;
  expect(ran).toEqual(['a', 'b']);
});

test('a denied ordered call lets the next one run', async () => {
  const ran: string[] = [];
  const t = tool(
    'write',
    async (args) => {
      ran.push((args as { q: string }).q);
      return { ok: true, content: 'done' };
    },
    { defaultPolicy: 'ask', ordered: true },
  );
  const s = start(
    [
      [...call(0, 'a', 'write', '{"q":"a"}'), ...call(1, 'b', 'write', '{"q":"b"}'), toolCalls],
      [text('ok'), stop],
    ],
    [t],
  );
  await waitFor(
    () =>
      toolParts(s.generation.snapshot()).filter((p) => p.status === 'awaiting_approval').length ===
      2,
  );
  s.generation.resolveApproval('b', 'allow');
  s.generation.resolveApproval('a', 'deny');
  await s.finished;
  expect(ran).toEqual(['b']);
});

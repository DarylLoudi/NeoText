import { ApprovalBodySchema, CALL_ID_MAX } from '@neotext/shared';
import { expect, test } from 'vitest';
import {
  awaiting,
  callStep,
  echo,
  start,
  stop,
  text,
  toolParts,
  waitFor,
} from '../../../test-support/tool-harness';
import type { ChatRequest } from '../../providers/types';
import { uniqueCallIds } from './tool-loop';

const toolIds = (r: ChatRequest) =>
  r.messages.flatMap((m) => (m.role === 'tool' ? [m.toolCallId] : []));

test('an id the provider reuses in a later step gets a new one for this turn', async () => {
  const s = start(
    [
      callStep('call_0', 'echo', '{"q":"1"}'),
      callStep('call_0', 'echo', '{"q":"2"}'),
      [text('Done'), stop],
    ],
    [echo()],
  );
  const final = await s.finished;
  expect(toolParts(final).map((p) => [p.id, p.result])).toEqual([
    ['call_0', 'echo: 1'],
    ['call_0_2', 'echo: 2'],
  ]);
  // The history sent upstream pairs each tool message with one call.
  expect(toolIds(s.requests[2] as ChatRequest)).toEqual(['call_0', 'call_0_2']);
  const assistants = (s.requests[2] as ChatRequest).messages.flatMap((m) =>
    m.role === 'assistant' ? (m.toolCalls ?? []).map((c) => c.id) : [],
  );
  expect(assistants).toEqual(['call_0', 'call_0_2']);
});

test(`ids longer than ${CALL_ID_MAX} characters get a short local id that can be approved`, async () => {
  const long = `call_${'x'.repeat(300)}`;
  const s = start([callStep(long, 'echo', '{"q":"1"}'), [text('Done'), stop]], [echo()], {
    policies: { echo: 'ask' },
  });
  await waitFor(() => awaiting(s.generation));
  const part = toolParts(s.generation.snapshot())[0];
  const id = part?.id ?? '';
  expect(id.length).toBeLessThanOrEqual(CALL_ID_MAX);
  expect(ApprovalBodySchema.safeParse({ callId: id, decision: 'allow' }).success).toBe(true);
  expect(s.generation.resolveApproval(id, 'allow')).toBe(true);
  const final = await s.finished;
  expect(toolParts(final)[0]).toMatchObject({ id, status: 'ok', result: 'echo: 1' });
  expect(toolIds(s.requests[1] as ChatRequest)).toEqual([id]);
});

test('renamed ids never clash with ids already used in the turn', () => {
  const used = new Set(['a', 'a_2', 'call_1']);
  const long = 'y'.repeat(CALL_ID_MAX + 1);
  const near = 'z'.repeat(CALL_ID_MAX);
  const out = uniqueCallIds(
    [
      { id: 'a', name: 'n', arguments: '' },
      { id: 'a', name: 'n', arguments: '' },
      { id: long, name: 'n', arguments: '' },
      { id: near, name: 'n', arguments: '' },
      { id: near, name: 'n', arguments: '' },
    ],
    used,
  ).map((c) => c.id);
  expect(out.slice(0, 2)).toEqual(['a_3', 'a_4']);
  expect(out[3]).toBe(near);
  expect(new Set([...out, 'a_2', 'call_1']).size).toBe(7);
  expect(out.every((id) => id.length <= CALL_ID_MAX)).toBe(true);
  expect(used.size).toBe(3 + 5);
});

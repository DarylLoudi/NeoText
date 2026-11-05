import type { ToolCallPart } from '@neotext/shared';
import { expect, test } from 'vitest';
import {
  call,
  echo,
  run,
  stop,
  text,
  toolCalls,
  toolParts,
} from '../../../test-support/tool-harness';
import type { ChatRequest, ProviderEvent } from '../../providers/types';
import { MAX_TOOL_CALLS_PER_STEP, TOO_MANY_CALLS } from './tool-loop';

const manyCalls = (n: number): ProviderEvent[] => [
  ...Array.from({ length: n }, (_, i) => call(i, `c${i}`, 'echo', `{"q":"${i}"}`)).flat(),
  toolCalls,
];

test(`a step runs at most ${MAX_TOOL_CALLS_PER_STEP} tool calls; the rest get an error`, async () => {
  const t = echo();
  const r = await run([manyCalls(40), [text('Done'), stop]], [t]);
  expect(MAX_TOOL_CALLS_PER_STEP).toBe(16);
  expect(t.execute).toHaveBeenCalledTimes(16);
  const parts = toolParts(r.final);
  expect(parts).toHaveLength(40);
  expect(parts.slice(0, 16).every((p) => p.status === 'ok')).toBe(true);
  expect(parts.slice(16).map((p: ToolCallPart) => [p.status, p.result])).toEqual(
    Array.from({ length: 24 }, () => ['error', TOO_MANY_CALLS]),
  );
  // Every call is still answered, in order, so the ids stay paired.
  const replay = (r.requests[1] as ChatRequest).messages.filter((m) => m.role === 'tool');
  expect(replay.map((m) => (m as { toolCallId: string }).toolCallId)).toEqual(
    Array.from({ length: 40 }, (_, i) => `c${i}`),
  );
  expect((replay[39] as { content: string }).content).toBe(TOO_MANY_CALLS);
  expect(r.final.status).toBe('complete');
  expect(r.final.parts.at(-1)).toEqual({ type: 'text', text: 'Done' });
});

import { expect, test } from 'vitest';
import { SubagentRunSchema, UsageSchema } from '../chat';
import { parseSettings } from '../settings';
import { AgentNameSchema, AgentUpdateSchema } from './agents';

test('agent names become one line without control characters', () => {
  expect(AgentNameSchema.parse('  Re\nsearch\u0000er\u2028 ')).toBe('Re search er');
  expect(AgentNameSchema.safeParse('\n\t').success).toBe(false);
  expect(AgentNameSchema.safeParse('x'.repeat(61)).success).toBe(false);
});

test('a position longer than 32 characters is refused', () => {
  expect(AgentUpdateSchema.safeParse({ position: 'a'.repeat(32) }).success).toBe(true);
  expect(AgentUpdateSchema.safeParse({ position: 'a'.repeat(33) }).success).toBe(false);
});

test('maxSubagents is at least 2', () => {
  const { settings, resetPaths } = parseSettings({ tools: { maxSubagents: 1 } });
  expect(settings.tools.maxSubagents).toBe(4);
  expect(resetPaths).toContain('tools.maxSubagents');
  expect(parseSettings({ tools: { maxSubagents: 2 } }).settings.tools.maxSubagents).toBe(2);
});

test('usage without contextTokens reads as null; sub-agent rows may carry tool calls', () => {
  const usage = UsageSchema.parse({
    promptTokens: 1,
    completionTokens: 1,
    reasoningTokens: 0,
    cachedTokens: 0,
    costUsd: null,
    webSearchRequests: 0,
    ttftMs: null,
    durationMs: null,
    upstreamProvider: null,
  });
  expect(usage.contextTokens).toBeNull();
  const row = {
    id: 'sub_1',
    title: 'A',
    agentName: null,
    status: 'ok',
    startedAt: 1,
    finishedAt: 2,
    report: null,
    costUsd: null,
  };
  expect(SubagentRunSchema.safeParse(row).success).toBe(true);
  const calls = Array.from({ length: 21 }, () => ({ name: 'web_search', detail: 'q' }));
  expect(SubagentRunSchema.safeParse({ ...row, toolCalls: calls.slice(0, 20) }).success).toBe(true);
  expect(SubagentRunSchema.safeParse({ ...row, toolCalls: calls }).success).toBe(false);
});

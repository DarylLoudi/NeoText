import { expect, test } from 'vitest';
import { msg } from '../../test/chat-fixtures';
import { deepseek } from '../../test/model-fixtures';
import { effectiveContextLength, needsNewChat, usedContextTokens } from './context-window';

test('a new chat is needed only when both sizes are known and differ', () => {
  expect(needsNewChat(128_000, 64_000)).toBe(true);
  expect(needsNewChat(128_000, 128_000)).toBe(false);
  expect(needsNewChat(null, 64_000)).toBe(false);
  expect(needsNewChat(128_000, null)).toBe(false);
});

test('the user override wins over the catalog size', () => {
  const key = `${deepseek.providerId}|${deepseek.id}`;
  expect(effectiveContextLength(deepseek, { [key]: { contextLength: 1000 } })).toBe(1000);
  expect(effectiveContextLength(deepseek, {})).toBe(deepseek.contextLength);
  expect(effectiveContextLength(null, {})).toBeNull();
});

const usage = (p: number, c: number, contextTokens: number | null = null) => ({
  promptTokens: p,
  completionTokens: c,
  reasoningTokens: 0,
  cachedTokens: 0,
  costUsd: null,
  webSearchRequests: 0,
  ttftMs: null,
  durationMs: null,
  upstreamProvider: null,
  contextTokens,
});

test('used tokens come from the latest answer on the current branch', () => {
  const messages = [
    msg({ id: 'u', role: 'user' }),
    msg({ id: 'a1', parentId: 'u', usage: usage(10, 5) }),
    msg({ id: 'u2', role: 'user', parentId: 'a1' }),
    msg({ id: 'a2', parentId: 'u2', usage: usage(100, 20) }),
    msg({ id: 'other', parentId: 'u', usage: usage(999, 1) }),
  ];
  expect(usedContextTokens(messages, 'a2')).toBe(120);
  expect(usedContextTokens(messages, 'u2')).toBe(15);
  expect(usedContextTokens(messages, 'u')).toBeNull();
  expect(usedContextTokens(messages, null)).toBeNull();
});

test("the last model call's tokens win over the sum of a multi-step answer", () => {
  const messages = [
    msg({ id: 'u', role: 'user' }),
    // Three calls of about 40k each: the sum says 121k, the context holds 42k.
    msg({ id: 'a', parentId: 'u', usage: usage(120_000, 1_000, 42_000) }),
  ];
  expect(usedContextTokens(messages, 'a')).toBe(42_000);
});

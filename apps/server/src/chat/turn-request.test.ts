import { createHash } from 'node:crypto';
import {
  defaultSettings,
  type MessagePublic,
  type ModelInfo,
  type ReasoningEffort,
} from '@neotext/shared';
import { expect, test } from 'vitest';
import { createSearchBudget } from '../search/budget';
import { DELEGATE_GUIDANCE } from '../tools/builtin/delegate';
import type { ToolDefinition } from '../tools/types';
import {
  openRouterWebSearch,
  WEB_SEARCH_GUIDANCE,
  type WebSearchPlan,
} from './generation/web-search';
import { buildTurnRequest, endUserIdFor, resolveReasoningEffort } from './turn-request';

type Input = Parameters<typeof buildTurnRequest>[0];

const userMessage = (text: string): MessagePublic => ({
  id: 'm1',
  conversationId: 'c1',
  parentId: null,
  role: 'user',
  status: 'complete',
  parts: [{ type: 'text', text }],
  model: null,
  usage: null,
  finishReason: null,
  createdAt: 1,
  updatedAt: 1,
});

function modelInfo(over: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: 'm',
    providerId: 'p',
    name: 'M',
    description: null,
    contextLength: 100_000,
    maxOutputTokens: null,
    inputModalities: ['text'],
    outputModalities: ['text'],
    pricing: { promptPerM: null, completionPerM: null, cacheReadPerM: null },
    supports: { tools: null, reasoning: null, structuredOutputs: null, webSearch: false },
    reasoning: null,
    knowledgeCutoff: null,
    expiresAt: null,
    createdAt: null,
    ...over,
  };
}

function input(over: Partial<Input> = {}): Input {
  return {
    path: [userMessage('hello')],
    chat: { ...defaultSettings().chat, includeDate: false },
    options: {
      webSearch: false,
      reasoningEffort: null,
      temperature: null,
      maxOutputTokens: null,
      presetId: null,
      agentId: null,
      folderId: null,
      timeZone: 'UTC',
    },
    modelId: 'vendor/model',
    model: null,
    plan: { kind: 'none' },
    endUserId: 'u-hash',
    now: Date.UTC(2026, 10, 3),
    ...over,
  };
}

const withOptions = (o: Partial<Input['options']>): Input => {
  const base = input();
  return { ...base, options: { ...base.options, ...o } };
};

test('endUserIdFor is a stable 16 hex-character digest that hides the user id', () => {
  const id = endUserIdFor('usr_123');
  expect(id).toBe(createHash('sha256').update('usr_123').digest('hex').slice(0, 16));
  expect(id).toMatch(/^[0-9a-f]{16}$/);
  expect(endUserIdFor('usr_124')).not.toBe(id);
});

test('resolveReasoningEffort: request wins over the setting, auto means omitted', () => {
  expect(resolveReasoningEffort('high', 'low', null)).toBe('high');
  expect(resolveReasoningEffort(null, 'low', null)).toBe('low');
  expect(resolveReasoningEffort(null, 'auto', null)).toBeNull();
});

test('resolveReasoningEffort drops an effort the model does not list', () => {
  const model = modelInfo({
    reasoning: {
      mandatory: false,
      efforts: ['low', 'high'] as ReasoningEffort[],
      defaultEffort: null,
    },
  });
  expect(resolveReasoningEffort('medium', 'auto', model)).toBeNull();
  expect(resolveReasoningEffort('high', 'auto', model)).toBe('high');
  // A model that lists no efforts accepts whatever was asked for.
  const open = modelInfo({ reasoning: { mandatory: false, efforts: [], defaultEffort: null } });
  expect(resolveReasoningEffort('medium', 'auto', open)).toBe('medium');
});

test('buildTurnRequest carries the model, context messages and end user id', () => {
  const { request, webSearch, contextTrimmed } = buildTurnRequest(input());
  expect(request).toEqual({
    model: 'vendor/model',
    messages: [{ role: 'user', content: 'hello' }],
    endUserId: 'u-hash',
  });
  expect(webSearch).toBe(false);
  expect(contextTrimmed).toBe(0);
});

test('buildTurnRequest puts the system prompt and date line ahead of the history', () => {
  const base = input();
  const { request } = buildTurnRequest({
    ...base,
    chat: { ...base.chat, defaultSystemPrompt: 'Be brief.', includeDate: true },
    options: { ...base.options, timeZone: 'Asia/Jakarta' },
  });
  expect(request.messages[0]).toEqual({
    role: 'system',
    content: 'Be brief.\n\nCurrent date: 2026-11-03 (Asia/Jakarta)',
  });
  expect(request.messages).toHaveLength(2);
});

test('request options override the settings for temperature and output tokens', () => {
  const base = input();
  const chat = { ...base.chat, temperature: 0.2, maxOutputTokens: 500 };
  const fromSettings = buildTurnRequest({ ...base, chat }).request;
  expect(fromSettings.temperature).toBe(0.2);
  expect(fromSettings.maxTokens).toBe(500);
  const overridden = buildTurnRequest({
    ...base,
    chat,
    options: { ...base.options, temperature: 0, maxOutputTokens: 900 },
  }).request;
  expect(overridden.temperature).toBe(0);
  expect(overridden.maxTokens).toBe(900);
});

test('temperature, maxTokens and reasoning are absent when nothing sets them', () => {
  const { request } = buildTurnRequest(input());
  expect('temperature' in request).toBe(false);
  expect('maxTokens' in request).toBe(false);
  expect('reasoning' in request).toBe(false);
});

test('reasoning effort comes from the request, else the setting', () => {
  expect(buildTurnRequest(withOptions({ reasoningEffort: 'high' })).request.reasoning).toEqual({
    effort: 'high',
  });
  const base = input();
  const { request } = buildTurnRequest({ ...base, chat: { ...base.chat, reasoningEffort: 'low' } });
  expect(request.reasoning).toEqual({ effort: 'low' });
});

test('only a server plan puts the web search tool into the request', () => {
  const server = {
    kind: 'server' as const,
    serverTools: openRouterWebSearch().serverTools,
    maxServerToolCalls: 2,
    budget: createSearchBudget(2),
  };
  const on = buildTurnRequest({ ...input(), plan: server });
  expect(on.webSearch).toBe(true);
  expect(on.request.serverTools).toHaveLength(1);
  expect(on.request.maxServerToolCalls).toBe(2);

  for (const plan of [
    { kind: 'none' as const },
    { kind: 'pre-search' as const, run: async () => [] },
  ]) {
    const other = buildTurnRequest({ ...input(), plan });
    expect(other.webSearch).toBe(false);
    expect('serverTools' in other.request).toBe(false);
  }
});

test('the search guidance joins the system prompt only when a search tool is offered', () => {
  const guided = (plan: WebSearchPlan) =>
    buildTurnRequest({ ...input(), plan }).request.messages.some(
      (m) => m.role === 'system' && m.content.includes(WEB_SEARCH_GUIDANCE),
    );
  const server = {
    kind: 'server' as const,
    serverTools: openRouterWebSearch().serverTools,
    maxServerToolCalls: 2,
    budget: createSearchBudget(2),
  };
  const tool = { kind: 'tool' as const, tool: {} as ToolDefinition, budget: createSearchBudget(2) };
  expect(guided(server)).toBe(true);
  expect(guided(tool)).toBe(true);
  expect(guided({ kind: 'none' })).toBe(false);
});

test('contextTrimmed reports messages dropped to fit a small context window', () => {
  const long = 'word '.repeat(2000);
  const path = [userMessage(long), { ...userMessage('ok'), id: 'm2', role: 'assistant' as const }];
  const next = { ...userMessage(long), id: 'm3' };
  const model = modelInfo({ contextLength: 4_000 });
  const trimmed = buildTurnRequest({ ...input({ path: [...path, next], model }) });
  expect(trimmed.contextTrimmed).toBeGreaterThan(0);
  const none = buildTurnRequest({
    ...input({ path: [...path, next], model }),
    chat: { ...input().chat, contextStrategy: 'none' },
  });
  expect(none.contextTrimmed).toBe(0);
  expect(none.request.messages).toHaveLength(3);
});

test('the delegation guidance joins the system prompt only when delegate_tasks is offered', () => {
  const system = (delegation: boolean | undefined) =>
    buildTurnRequest({ ...input(), ...(delegation !== undefined ? { delegation } : {}) }).request
      .messages[0];
  expect(system(true)).toEqual({ role: 'system', content: DELEGATE_GUIDANCE });
  expect(system(false)?.role).not.toBe('system');
  expect(system(undefined)?.role).not.toBe('system');
  const server = {
    kind: 'server' as const,
    serverTools: openRouterWebSearch().serverTools,
    maxServerToolCalls: 2,
    budget: createSearchBudget(2),
  };
  const both = buildTurnRequest({ ...input(), plan: server, delegation: true }).request.messages[0];
  expect(both).toEqual({
    role: 'system',
    content: `${WEB_SEARCH_GUIDANCE}\n\n${DELEGATE_GUIDANCE}`,
  });
  // Small talk must not delegate: the text says so.
  expect(DELEGATE_GUIDANCE).toContain('Never use it for greetings, short questions');
});

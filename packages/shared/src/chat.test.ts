import { describe, expect, test } from 'vitest';
import { ChatRequestBodySchema, ListQuerySchema, MessagePartSchema } from './chat';
import { CreateProviderBodySchema } from './providers';
import { formatSSEData, StreamEventSchema } from './stream';

const target = { providerId: 'prv_1', modelId: 'm' };

describe('chat contracts', () => {
  test('chat request defaults', () => {
    const body = ChatRequestBodySchema.parse({
      conversationId: null,
      parentId: null,
      userMessage: { text: 'hi' },
      targets: [target],
    });
    expect(body.options).toEqual({
      webSearch: false,
      reasoningEffort: null,
      temperature: null,
      maxOutputTokens: null,
      presetId: null,
      agentId: null,
      folderId: null,
      timeZone: 'UTC',
    });
    expect(body.userMessage?.attachmentIds).toEqual([]);
  });
  test('the time zone must be one the runtime knows', () => {
    const body = (timeZone: string) => ({
      conversationId: null,
      parentId: null,
      userMessage: { text: 'hi' },
      targets: [target],
      options: { timeZone },
    });
    expect(ChatRequestBodySchema.safeParse(body('Asia/Kolkata')).success).toBe(true);
    const bad = ChatRequestBodySchema.safeParse(body('Nowhere/Land'));
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toBe(
      'Unknown time zone. Send an IANA name such as Asia/Jakarta.',
    );
  });
  test('targets are limited to 4', () => {
    const base = { conversationId: null, parentId: null, userMessage: { text: 'hi' } };
    const ok = (n: number) =>
      ChatRequestBodySchema.safeParse({ ...base, targets: Array(n).fill(target) }).success;
    expect(ok(5)).toBe(false);
    expect(ok(0)).toBe(false);
    expect(ok(4)).toBe(true);
  });
  test('empty text needs an attachment', () => {
    const ok = (userMessage: unknown) =>
      ChatRequestBodySchema.safeParse({
        conversationId: null,
        parentId: null,
        userMessage,
        targets: [target],
      }).success;
    expect(ok({ text: '' })).toBe(false);
    expect(ok({ text: '', attachmentIds: ['att_1'] })).toBe(true);
    expect(ok({ text: 'hi' })).toBe(true);
  });
  test('stream events validate', () => {
    expect(StreamEventSchema.safeParse({ type: 'text.delta', text: 'x' }).success).toBe(false);
    expect(
      StreamEventSchema.safeParse({ type: 'text.delta', text: 'x', generationId: 'g', seq: 1 })
        .success,
    ).toBe(true);
    expect(formatSSEData({ a: 1 })).toBe('data: {"a":1}\n\n');
  });
  test('list query coerces strings', () => {
    const q = ListQuerySchema.parse({ limit: '20', includeFoldered: 'true', updatedSince: '5' });
    expect(q).toMatchObject({ scope: 'recent', limit: 20, includeFoldered: true, updatedSince: 5 });
    expect(ListQuerySchema.parse({}).limit).toBe(50);
    expect(ListQuerySchema.parse({ includeFoldered: 'false' }).includeFoldered).toBe(false);
  });
  test('openai-compatible provider requires baseUrl', () => {
    const parse = (v: unknown) => CreateProviderBodySchema.safeParse(v).success;
    expect(parse({ kind: 'openai-compatible', name: 'x' })).toBe(false);
    expect(
      parse({ kind: 'openai-compatible', name: 'x', baseUrl: 'http://localhost:1234/v1' }),
    ).toBe(true);
    expect(parse({ kind: 'openrouter', name: 'x' })).toBe(true);
  });
  test('agent part parses and options.agentId defaults to null', () => {
    const part = { type: 'agent', agentId: 'agt_1', name: 'Researcher' };
    expect(MessagePartSchema.parse(part)).toEqual(part);
    const body = ChatRequestBodySchema.parse({
      conversationId: null,
      parentId: null,
      userMessage: { text: 'hi' },
      targets: [target],
    });
    expect(body.options.agentId).toBeNull();
  });
  test('a tool call part with sub-agent runs round-trips', () => {
    const part = {
      type: 'tool_call',
      id: 'c1',
      name: 'delegate_tasks',
      source: 'app',
      args: '{}',
      status: 'running',
      result: null,
      startedAt: 1,
      finishedAt: null,
      agents: [
        {
          id: 's1',
          title: 'Look it up',
          agentName: null,
          status: 'ok',
          startedAt: 1,
          finishedAt: 2,
          report: 'done',
          costUsd: 0.01,
        },
      ],
    };
    expect(MessagePartSchema.parse(part)).toEqual(part);
  });
});

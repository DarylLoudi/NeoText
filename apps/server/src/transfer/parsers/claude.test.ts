import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseClaude, readClaude } from './claude';

const fixture: unknown = JSON.parse(
  readFileSync(
    new URL('../../../test-support/fixtures/claude-export.json', import.meta.url),
    'utf8',
  ),
);
const clone = () => structuredClone(fixture) as Record<string, unknown>[];

describe('claude parser', () => {
  test('claude chain', () => {
    const [c] = parseClaude(fixture);
    if (!c) throw new Error('no conversation');
    expect(c.sourceId).toBe('conv-claude-1');
    expect(c.title).toBe('Resep nasi goreng');
    expect(c.createdAt).toBe(Date.UTC(2026, 0, 2, 3, 4, 5));
    expect(c.updatedAt).toBe(Date.UTC(2026, 0, 2, 3, 10, 0));
    expect(c.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    // Linear: each message hangs off the one before it.
    expect(c.messages.map((m) => m.parentSourceId)).toEqual([null, 'msg-c1', 'msg-c2', 'msg-c3']);
    // The content-only message has its text parts joined; other part types are ignored.
    expect(c.messages[2]?.text).toBe('Pakai telur?\n\nAtau tidak?');
    expect(c.messages[1]?.createdAt).toBe(Date.UTC(2026, 0, 2, 3, 4, 10, 500));
    expect(c.messages.every((m) => m.model === null)).toBe(true);
    expect(c.activeLeafSourceId).toBe('msg-c4');
  });

  test('empty messages and unknown senders are dropped without breaking the chain', () => {
    const data = clone();
    const conv = data[0] as { chat_messages: Record<string, unknown>[]; name: string };
    conv.name = '';
    (conv.chat_messages[1] as Record<string, unknown>).text = '';
    conv.chat_messages.splice(2, 0, { uuid: 'x', sender: 'system', text: 'hi', created_at: 'x' });
    const [c] = parseClaude(data);
    expect(c?.title).toBeNull();
    expect(c?.messages.map((m) => m.sourceId)).toEqual(['msg-c1', 'msg-c3', 'msg-c4']);
    expect(c?.messages[1]?.parentSourceId).toBe('msg-c1');
  });

  test('a bad date falls back to the conversation time', () => {
    const data = clone();
    const conv = data[0] as { chat_messages: Record<string, unknown>[] };
    (conv.chat_messages[0] as Record<string, unknown>).created_at = 'not a date';
    const [c] = parseClaude(data);
    expect(c?.messages[0]?.createdAt).toBe(Date.UTC(2026, 0, 2, 3, 4, 5));
  });

  test('garbage input is a clear error', () => {
    for (const bad of [{}, null, 'text']) {
      expect(() => parseClaude(bad)).toThrow(/conversations\.json/);
    }
  });

  test('one broken conversation is reported, not thrown', () => {
    const items = readClaude([{ name: 'Rusak', chat_messages: 5 }, ...clone()]);
    expect(items[0]).toMatchObject({ ok: false, title: 'Rusak' });
    expect(items[1]).toMatchObject({ ok: true });
  });
});

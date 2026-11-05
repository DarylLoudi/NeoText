import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseChatGPT, readChatGPT } from './chatgpt';

const fixture: unknown = JSON.parse(
  readFileSync(
    new URL('../../../test-support/fixtures/chatgpt-export.json', import.meta.url),
    'utf8',
  ),
);
const clone = () => structuredClone(fixture) as Record<string, unknown>[];

describe('chatgpt parser', () => {
  test('chatgpt tree with hidden and null nodes', () => {
    const [c] = parseChatGPT(fixture);
    if (!c) throw new Error('no conversation');
    expect(c.sourceId).toBe('conv-chatgpt-1');
    expect(c.title).toBe('Rencana liburan');
    expect(c.messages.map((m) => m.text)).toEqual([
      'Halo',
      'Jawaban A',
      'Jawaban B',
      'Lanjut',
      'Selesai',
    ]);
    const user = c.messages[0];
    if (!user) throw new Error('no user message');
    expect(user.parentSourceId).toBeNull(); // reattached past the hidden system node
    expect(c.messages.filter((m) => m.parentSourceId === user.sourceId)).toHaveLength(2);
    expect(c.activeLeafSourceId).toBe('node-last');
    expect(c.messages[1]?.model).toBe('gpt-4o');
    expect(user.model).toBeNull();
    expect(c.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'assistant',
      'user',
      'assistant',
    ]);
  });

  test('seconds become milliseconds and a missing time never precedes its parent', () => {
    const [c] = parseChatGPT(fixture);
    if (!c) throw new Error('no conversation');
    expect(c.createdAt).toBe(1767225600500);
    expect(c.updatedAt).toBe(1767225900250);
    expect(c.messages[0]?.createdAt).toBe(1767225601000);
    expect(c.messages[1]?.createdAt).toBe(1767225605125);
    // node-last has create_time null: it falls back to the conversation time, kept after its parent.
    const follow = c.messages[3];
    const last = c.messages[4];
    expect(last?.createdAt).toBeGreaterThanOrEqual(follow?.createdAt ?? Number.NaN);
  });

  test('current_node on a skipped node maps to its nearest kept ancestor', () => {
    const data = clone();
    const conv = data[0] as { current_node: string; mapping: Record<string, unknown> };
    conv.mapping['node-tool'] = {
      id: 'node-tool',
      parent: 'node-b',
      children: [],
      message: {
        author: { role: 'tool' },
        create_time: 1767225701,
        content: { content_type: 'text', parts: ['tool output'] },
        metadata: {},
      },
    };
    conv.current_node = 'node-tool';
    const [c] = parseChatGPT(data);
    expect(c?.activeLeafSourceId).toBe('node-b');
    expect(c?.messages.map((m) => m.text)).not.toContain('tool output');
  });

  test('non-text content, empty text and odd roles are skipped', () => {
    const data = clone();
    const conv = data[0] as { mapping: Record<string, { message: unknown }> };
    const a = conv.mapping['node-a'] as { message: { content: unknown } };
    a.message.content = { content_type: 'code', text: 'print(1)' };
    const follow = conv.mapping['node-follow'] as { message: { content: unknown } };
    follow.message.content = { content_type: 'text', parts: ['   '] };
    const [c] = parseChatGPT(data);
    expect(c?.messages.map((m) => m.text)).toEqual(['Halo', 'Jawaban B', 'Selesai']);
    // Selesai's parent was the skipped follow-up; it now hangs off Jawaban B.
    expect(c?.messages[2]?.parentSourceId).toBe('node-b');
  });

  test('a parent cycle does not hang the parser', () => {
    const data = clone();
    const conv = data[0] as { mapping: Record<string, { parent: string | null }> };
    (conv.mapping['node-root'] as { parent: string | null }).parent = 'node-system';
    (conv.mapping['node-system'] as { parent: string | null }).parent = 'node-root';
    const [c] = parseChatGPT(data);
    expect(c?.messages[0]?.parentSourceId).toBeNull();
  });

  test('a long run of hidden nodes is walked once, not once per message below it', () => {
    const hidden = 100_000;
    const mapping: Record<string, unknown> = {};
    const node = (id: string, parent: string | null, message: unknown) => {
      mapping[id] = { id, parent, children: [], message };
    };
    node('h0', null, null);
    for (let i = 1; i < hidden; i++) {
      node(`h${i}`, `h${i - 1}`, {
        author: { role: 'system' },
        content: { content_type: 'text', parts: ['x'] },
        metadata: { is_visually_hidden_from_conversation: true },
      });
    }
    // 100k kept messages all hang off the bottom of that chain: 200k nodes in all.
    for (let i = 0; i < 100_000; i++) {
      node(`u${i}`, `h${hidden - 1}`, {
        author: { role: 'user' },
        create_time: i,
        content: { content_type: 'text', parts: [`m${i}`] },
        metadata: {},
      });
    }
    const started = performance.now();
    const [c] = parseChatGPT([{ id: 'long', title: 'Panjang', mapping, current_node: 'h5' }]);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(c?.messages).toHaveLength(100_000);
    expect(c?.messages.every((m) => m.parentSourceId === null)).toBe(true);
    expect(c?.activeLeafSourceId).toBeNull();
  });

  test('assistant messages addressed to a tool are skipped', () => {
    const data = clone();
    const conv = data[0] as { mapping: Record<string, { message: Record<string, unknown> }> };
    (conv.mapping['node-a'] as { message: Record<string, unknown> }).message.recipient = 'python';
    (conv.mapping['node-b'] as { message: Record<string, unknown> }).message.recipient = 'all';
    const [c] = parseChatGPT(data);
    expect(c?.messages.map((m) => m.text)).toEqual(['Halo', 'Jawaban B', 'Lanjut', 'Selesai']);
  });

  test('garbage input is a clear error', () => {
    for (const bad of [{}, null, 'text', 42]) {
      expect(() => parseChatGPT(bad)).toThrow(/conversations\.json/);
      try {
        parseChatGPT(bad);
      } catch (err) {
        expect(err).toMatchObject({ code: 'bad_request', status: 400 });
      }
    }
  });

  test('one broken conversation is reported, not thrown', () => {
    const data = [{ title: 'Rusak', mapping: 'nope' }, ...clone()];
    const items = readChatGPT(data);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ ok: false, title: 'Rusak' });
    expect(items[1]).toMatchObject({ ok: true });
    expect(parseChatGPT(data)).toHaveLength(1);
  });
});

import { expect, test } from 'vitest';
import { msg } from '../../test/chat-fixtures';
import { buildThread, shortModelName, switchBranch, visibleLeaf } from './thread';

// u1 ─┬─ a1 ── u3 ── a4
//     └─ a2 ── u2 ─┬─ a3
//                  └─ a5 (newest)
const messages = [
  msg({ id: 'u1', role: 'user', createdAt: 1 }),
  msg({ id: 'a1', parentId: 'u1', createdAt: 2 }),
  msg({ id: 'a2', parentId: 'u1', createdAt: 3 }),
  msg({ id: 'u2', role: 'user', parentId: 'a2', createdAt: 4 }),
  msg({ id: 'a3', parentId: 'u2', createdAt: 5 }),
  msg({ id: 'u3', role: 'user', parentId: 'a1', createdAt: 6 }),
  msg({ id: 'a4', parentId: 'u3', createdAt: 7 }),
  msg({ id: 'a5', parentId: 'u2', createdAt: 8 }),
];

test('path, sibling counts and live overlay', () => {
  const live = msg({ id: 'a3', parentId: 'u2', status: 'streaming', createdAt: 5 });
  const thread = buildThread(messages, 'a3', (id) => (id === 'a3' ? live : undefined));
  expect(thread.map((t) => t.message.id)).toEqual(['u1', 'a2', 'u2', 'a3']);
  expect(thread.map((t) => [t.siblingIndex, t.siblingCount])).toEqual([
    [0, 1],
    [1, 2],
    [0, 1],
    [0, 2],
  ]);
  expect(thread[1]?.siblingIds).toEqual(['a1', 'a2']);
  expect(thread[3]?.message).toBe(live);
});

test('no messages show nothing; a missing or unknown leaf falls back to the newest path', () => {
  expect(buildThread([], null, () => undefined)).toEqual([]);
  expect(buildThread([], 'gone', () => undefined)).toEqual([]);
  const none = buildThread(messages, null, () => undefined).map((t) => t.message.id);
  expect(none).toEqual(['u1', 'a2', 'u2', 'a5']);
  const ids = buildThread(messages, 'gone', () => undefined).map((t) => t.message.id);
  expect(ids).toEqual(['u1', 'a2', 'u2', 'a5']);
});

test('visibleLeaf is the saved leaf when it exists, else the newest one', () => {
  expect(visibleLeaf(messages, 'a3')).toBe('a3');
  expect(visibleLeaf(messages, null)).toBe('a5');
  expect(visibleLeaf(messages, 'gone')).toBe('a5');
  expect(visibleLeaf([], null)).toBeNull();
});

test('switchBranch picks the newest leaf', () => {
  expect(switchBranch(messages, 'a1')).toBe('a4');
  expect(switchBranch(messages, 'a2')).toBe('a5');
  expect(switchBranch(messages, 'a3')).toBe('a3');
});

test('short model names drop the vendor and dashes', () => {
  expect(shortModelName('deepseek/deepseek-v4.1-flash')).toBe('deepseek v4.1 flash');
  expect(shortModelName('llama3')).toBe('llama3');
});

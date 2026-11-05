import { beforeEach, expect, test } from 'vitest';
import { msg } from '../../test/chat-fixtures';
import { buildThread, type ThreadItem } from '../chat/thread';
import { compareGroupFor } from './compare-group';
import { chooseAnswer, isChosen, resetCompare, showComparison } from './compare-state';

const none = () => undefined;
const u1 = msg({ id: 'u1', role: 'user' });
const a = msg({ id: 'a', parentId: 'u1', createdAt: 5 });
const b = msg({ id: 'b', parentId: 'u1', createdAt: 5 });
const c = msg({ id: 'c', parentId: 'u1', createdAt: 9 });

const itemOf = (message: typeof a): ThreadItem => ({
  message,
  siblingIndex: 0,
  siblingCount: 1,
  siblingIds: [message.id],
});

beforeEach(() => resetCompare());

test('groups same-turn siblings only', () => {
  const messages = [u1, a, b, c];
  expect(compareGroupFor(messages, itemOf(a))?.map((m) => m.id)).toEqual(['a', 'b']);
  expect(compareGroupFor(messages, itemOf(b))?.map((m) => m.id)).toEqual(['a', 'b']);
  expect(compareGroupFor(messages, itemOf(c))).toBeNull();
  expect(compareGroupFor(messages, itemOf(u1))).toBeNull();
});

test('a same-time answer under another user message is not in the group', () => {
  const u2 = msg({ id: 'u2', role: 'user', createdAt: 2 });
  const d = msg({ id: 'd', parentId: 'u2', createdAt: 5 });
  expect(compareGroupFor([u1, u2, a, d], itemOf(a))).toBeNull();
});

test('the last turn shows its comparison until an answer is chosen', () => {
  const messages = [u1, a, b, c];
  const open = buildThread(messages, 'a', none);
  expect(open.at(-1)?.compare?.map((m) => m.id)).toEqual(['a', 'b']);

  chooseAnswer('u1');
  expect(isChosen('u1')).toBe(true);
  const chosen = buildThread(messages, 'a', none, isChosen);
  expect(chosen.at(-1)?.compare).toBeUndefined();
  expect(chosen.at(-1)?.comparable).toBe(true);

  showComparison('u1');
  expect(buildThread(messages, 'a', none, isChosen).at(-1)?.compare).toHaveLength(2);
});

test('an earlier turn answered side by side reads as a normal turn', () => {
  const u2 = msg({ id: 'u2', role: 'user', parentId: 'a', createdAt: 10 });
  const a2 = msg({ id: 'a2', parentId: 'u2', createdAt: 11 });
  const items = buildThread([u1, a, b, u2, a2], 'a2', none);
  expect(items.map((i) => i.compare)).toEqual([undefined, undefined, undefined, undefined]);
  expect(items[1]?.siblingCount).toBe(2);
});

test('the comparison draws live copies of its answers', () => {
  const liveB = { ...b, status: 'streaming' as const };
  const items = buildThread([u1, a, b], 'a', (id) => (id === 'b' ? liveB : undefined));
  expect(items.at(-1)?.compare?.[1]).toBe(liveB);
});

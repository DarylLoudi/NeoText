import type { MessagePublic } from '@neotext/shared';
import { expect, test } from 'vitest';
import { msg } from '../../test/chat-fixtures';
import type { ThreadItem } from '../chat/thread';
import { panelPathFor } from './panel-path';

const u1 = msg({ id: 'u1', role: 'user', parts: [] });
const a1 = msg({ id: 'a1', parentId: 'u1' });
const a1b = msg({ id: 'a1b', parentId: 'u1', createdAt: 2 });
const all = [u1, a1, a1b];
const item = (message: MessagePublic, compare?: MessagePublic[]): ThreadItem => ({
  message,
  siblingIndex: 0,
  siblingCount: 1,
  siblingIds: [message.id],
  ...(compare ? { compare } : {}),
});
const none = () => undefined;

test('without an opener the panel shows the visible branch and follows its latest version', () => {
  expect(panelPathFor([item(u1), item(a1)], all, null, none)).toEqual({
    path: [u1, a1],
    messageId: null,
  });
});

test('an opener on the visible branch keeps its place', () => {
  expect(panelPathFor([item(u1), item(a1)], all, 'a1', none)).toEqual({
    path: [u1, a1],
    messageId: 'a1',
  });
});

test('after a regenerate the opener is gone from view: back to the visible branch', () => {
  expect(panelPathFor([item(u1), item(a1b)], all, 'a1', none)).toEqual({
    path: [u1, a1b],
    messageId: null,
  });
});

test('an opener in a compare column of this turn shows that column', () => {
  const live = (id: string) =>
    id === 'a1b' ? { ...a1b, status: 'streaming' as const } : undefined;
  const out = panelPathFor([item(u1), item(a1, [a1, a1b])], all, 'a1b', live);
  expect(out.messageId).toBe('a1b');
  expect(out.path.map((m) => [m.id, m.status])).toEqual([
    ['u1', 'complete'],
    ['a1b', 'streaming'],
  ]);
});

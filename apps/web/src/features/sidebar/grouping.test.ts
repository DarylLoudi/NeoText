import { expect, test } from 'vitest';
import { conv } from '../../test/sidebar-backend';
import { groupConversations } from './grouping';

const now = new Date(2026, 10, 3, 10).getTime();
const at = (m: number, d: number) => conv(new Date(2026, m, d, 9).getTime());

test('buckets in order', () => {
  const groups = groupConversations([at(10, 3), at(10, 2), at(9, 30), at(9, 10), at(8, 15)], now);
  expect(groups.map((g) => g.bucket.kind)).toEqual([
    'today',
    'yesterday',
    'previous7',
    'previous30',
    'month',
  ]);
});

test('each month is its own group with a stable key', () => {
  const groups = groupConversations([at(8, 15), at(8, 2), at(7, 20)], now);
  expect(groups.map((g) => g.key)).toEqual(['month-2026-09', 'month-2026-08']);
  expect(groups[0]?.items).toHaveLength(2);
});

test('items keep their order inside a group', () => {
  const a = at(10, 3);
  const b = at(10, 3);
  const groups = groupConversations([a, b], now);
  expect(groups).toHaveLength(1);
  expect(groups[0]?.items.map((c) => c.id)).toEqual([a.id, b.id]);
});

test('no items, no groups', () => {
  expect(groupConversations([], now)).toEqual([]);
});

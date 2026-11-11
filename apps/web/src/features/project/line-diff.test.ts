import { expect, test } from 'vitest';
import { lineDiff } from './line-diff';

test('marks kept, removed and added lines in order', () => {
  expect(lineDiff('a\nb\nc', 'a\nB\nc\nd')).toEqual([
    { kind: 'same', text: 'a' },
    { kind: 'del', text: 'b' },
    { kind: 'add', text: 'B' },
    { kind: 'same', text: 'c' },
    { kind: 'add', text: 'd' },
  ]);
});

test('a new file is all additions, a deleted one all removals', () => {
  expect(lineDiff('', 'x\ny')).toEqual([
    { kind: 'add', text: 'x' },
    { kind: 'add', text: 'y' },
  ]);
  expect(lineDiff('x', '')).toEqual([{ kind: 'del', text: 'x' }]);
});

test('very long files fall back to removing all, then adding all', () => {
  const a = Array.from({ length: 4001 }, (_, i) => `a${i}`).join('\n');
  const out = lineDiff(a, 'b');
  expect(out.filter((l) => l.kind === 'del')).toHaveLength(4001);
  expect(out.at(-1)).toEqual({ kind: 'add', text: 'b' });
});

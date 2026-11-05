import type { Snippet } from '@neotext/shared';
import { expect, test } from 'vitest';
import { extractVariables, fillVariables, matchSnippets, slashQuery } from './snippets';

const snip = (trigger: string, title = trigger): Snippet => ({
  id: trigger,
  trigger,
  title,
  body: `body ${trigger}`,
});

test('extracts unique variables in order', () => {
  expect(extractVariables('{{topic}} and {{ topic }}, {{level}}')).toEqual(['topic', 'level']);
});

test('names may hold spaces and dashes but not other characters', () => {
  expect(extractVariables('{{target-lang}} {{the topic}} {{a.b}} {{}}')).toEqual([
    'target-lang',
    'the topic',
  ]);
});

test('fills variables, leaves unknown intact', () => {
  expect(fillVariables('{{a}} {{b}}', { a: 'x' })).toBe('x {{b}}');
  expect(fillVariables('{{ a }} and {{a}}', { a: '$&' })).toBe('$& and $&');
});

test.each([
  ['/su', 3, 'su'],
  ['/', 1, ''],
  ['hello /su', 9, null],
  ['a\n/su', 5, 'su'],
  ['/su mm', 6, null],
  ['/su mm', 3, 'su'],
])('slash query %j', (t, c, q) => expect(slashQuery(t, c)).toBe(q));

test('matches by trigger prefix first, then by title', () => {
  const all = [snip('email', 'Write a summary'), snip('sum', 'Summarise'), snip('x', 'Other')];
  expect(matchSnippets(all, 'su').map((s) => s.trigger)).toEqual(['sum', 'email']);
  expect(matchSnippets(all, '').map((s) => s.trigger)).toEqual(['email', 'sum', 'x']);
  expect(matchSnippets(all, 'zzz')).toEqual([]);
});

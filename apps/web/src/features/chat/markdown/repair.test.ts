import { expect, test } from 'vitest';
import { repairStreaming } from './repair';

test.each([
  ['**bold', '**bold**'],
  ['a `code', 'a `code`'],
  ['~~gone', '~~gone~~'],
  ['__under', '__under__'],
  ['**ok**', '**ok**'],
  ['```\nfence', '```\nfence'],
  ['text\n\n```\n**not closed', 'text\n\n```\n**not closed'],
  ['**bold ', '**bold**'],
  ['**a ~~b', '**a ~~b~~**'],
  ['**a `b', '**a `b`**'],
  ['`**` and ok', '`**` and ok'],
  ['```\n**x\n```\nafter **y', '```\n**x\n```\nafter **y**'],
  [String.raw`\**escaped`, String.raw`\**escaped`],
  ['plain text', 'plain text'],
])('repair %j', (input, expected) => {
  expect(repairStreaming(input)).toBe(expected);
});

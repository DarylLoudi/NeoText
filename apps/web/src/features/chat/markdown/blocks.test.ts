import { describe, expect, test } from 'vitest';
import { splitBlocks, updateBlocks } from './blocks';

describe('splitBlocks', () => {
  test('fence with blank lines is one block', () => {
    expect(splitBlocks('a\n\n```\nx\n\ny\n```\n\nb')).toHaveLength(3);
  });

  test('joining the blocks reproduces the document', () => {
    const doc =
      '# Title\n\nPara one\nstill one\n\n- a\n- b\n\n\n```ts\nlet x;\n\nlet y;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> quote\n';
    const blocks = splitBlocks(doc);
    expect(blocks.length).toBeGreaterThan(4);
    expect(blocks.join('')).toBe(doc);
  });

  test('a loose list stays one block', () => {
    expect(splitBlocks('- a\n\n- b\n\n- c')).toHaveLength(1);
  });

  test('an unclosed fence swallows the rest as one block', () => {
    expect(splitBlocks('intro\n\n```py\nprint(1)\n\nprint(2)')).toHaveLength(2);
  });

  test('empty text gives no blocks and CRLF is normalized', () => {
    expect(splitBlocks('')).toEqual([]);
    expect(splitBlocks('a\r\n\r\nb')).toEqual(['a\n\n', 'b']);
  });
});

describe('updateBlocks', () => {
  test('keeps earlier blocks and only re-splits the tail', () => {
    const first = splitBlocks('one\n\ntwo');
    const next = updateBlocks(first, 'one\n\ntwo more\n\nthree');
    expect(next).toEqual(['one\n\n', 'two more\n\n', 'three']);
    expect(next[0]).toBe(first[0]);
  });

  test('falls back to a full split when the text was rewritten', () => {
    const first = splitBlocks('one\n\ntwo');
    expect(updateBlocks(first, 'zero\n\ntwo')).toEqual(['zero\n\n', 'two']);
  });
});

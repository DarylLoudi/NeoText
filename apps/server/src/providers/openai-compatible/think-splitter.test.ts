import { describe, expect, test } from 'vitest';
import { createThinkSplitter } from './think-splitter';

function run(pieces: string[]) {
  const s = createThinkSplitter();
  let text = '';
  let reasoning = '';
  for (const piece of pieces) {
    const out = s.push(piece);
    text += out.text;
    reasoning += out.reasoning;
  }
  const tail = s.flush();
  return { text: text + tail.text, reasoning: reasoning + tail.reasoning };
}

describe('think splitter', () => {
  test('tags split at every position', () => {
    const input = '<think>ab</think>cd';
    for (let cut = 0; cut <= input.length; cut++) {
      expect(run([input.slice(0, cut), input.slice(cut)])).toEqual({
        text: 'cd',
        reasoning: 'ab',
      });
    }
  });

  test('one character at a time', () => {
    expect(run([...'x<think>ab</think>cd'])).toEqual({ text: 'xcd', reasoning: 'ab' });
  });

  test('text that merely starts with "<" is kept', () => {
    expect(run(['<b>x</b>'])).toEqual({ text: '<b>x</b>', reasoning: '' });
    expect(run(['<', 'b>x</b>'])).toEqual({ text: '<b>x</b>', reasoning: '' });
  });

  test('a dangling partial tag is flushed as text', () => {
    expect(run(['hi <thi'])).toEqual({ text: 'hi <thi', reasoning: '' });
  });

  test('an unclosed think block stays reasoning', () => {
    expect(run(['<think>still thinking'])).toEqual({ text: '', reasoning: 'still thinking' });
  });
});

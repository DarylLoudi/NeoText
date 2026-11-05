import MarkdownIt from 'markdown-it';
import { applyMath } from './math';

/**
 * A parser that only finds block boundaries: inline parsing, linkify and typography are switched
 * off because splitting never reads them, which keeps the pass cheap on very long messages.
 */
const splitter = new MarkdownIt('default', { html: false });
splitter.core.ruler.disable(['inline', 'linkify', 'replacements', 'smartquotes', 'text_join']);
let mathApplied = false;

function normalize(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\0/g, '�');
}

/**
 * Splits a document into top-level markdown blocks along markdown-it's token line maps. Blank
 * lines belong to the block before them, so `splitBlocks(t).join('') === t` (after newline
 * normalization) and a fence containing blank lines stays one block.
 */
export function splitBlocks(text: string): string[] {
  const src = normalize(text);
  if (src === '') return [];
  if (!mathApplied) mathApplied = applyMath(splitter);

  const tokens = splitter.parse(src, {});
  const startLines: number[] = [];
  for (const token of tokens) {
    if (token.level === 0 && token.map) startLines.push(token.map[0]);
  }
  if (startLines.length === 0) return [src];
  startLines[0] = 0; // leading blank lines travel with the first block

  const lineOffsets = [0];
  for (let i = src.indexOf('\n'); i !== -1; i = src.indexOf('\n', i + 1)) lineOffsets.push(i + 1);

  const blocks: string[] = [];
  for (let i = 0; i < startLines.length; i++) {
    const from = lineOffsets[startLines[i] ?? 0] ?? src.length;
    const next = startLines[i + 1];
    const to = next === undefined ? src.length : (lineOffsets[next] ?? src.length);
    if (to > from) blocks.push(src.slice(from, to));
  }
  return blocks;
}

/**
 * Incremental version for streaming: blocks before the last one cannot change when text is
 * appended, so only the last block's text is parsed again. Falls back to a full split if the
 * text was not simply extended.
 */
export function updateBlocks(previous: readonly string[], text: string): string[] {
  const src = normalize(text);
  if (previous.length === 0) return splitBlocks(src);
  const stable = previous.slice(0, -1);
  const prefix = stable.join('');
  if (!src.startsWith(prefix)) return splitBlocks(src);
  return [...stable, ...splitBlocks(src.slice(prefix.length))];
}

import type { ChatMessage } from '../providers/types';

const MESSAGE_OVERHEAD_TOKENS = 4;
const MEDIA_PART_TOKENS = 1_000;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(m: ChatMessage): number {
  let total = MESSAGE_OVERHEAD_TOKENS;
  if (typeof m.content === 'string') return total + estimateTokens(m.content);
  if (m.content === null) return total;
  for (const part of m.content) {
    total += part.type === 'text' ? estimateTokens(part.text) : MEDIA_PART_TOKENS;
  }
  return total;
}

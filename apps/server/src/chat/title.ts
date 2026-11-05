import type { ProviderAdapter, ProviderUsage, ResolvedProvider } from '../providers/types';

export const TITLE_TIMEOUT_MS = 8_000;
export const TITLE_PROMPT =
  'Write a short title (3 to 6 words) for this conversation, in the same language the user wrote in. Reply with the title only.';

const MAX_TITLE = 80;
const FALLBACK_LENGTH = 48;

/** Cuts `text` to at most `max` characters, at a word boundary when it can. */
function cutAtWord(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  const head = text.slice(0, max);
  const next = text[max] ?? '';
  const space = head.lastIndexOf(' ');
  const kept = /\s/.test(next) || space <= 0 ? head : head.slice(0, space);
  return { text: kept.trimEnd(), cut: true };
}

export function sanitizeTitle(raw: string): string | null {
  let s = raw.replace(/\s+/g, ' ').trim();
  s = s.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '').trim();
  s = s.replace(/^[#*\s]+/, '').replace(/[*`]/g, '');
  s = s.replace(/\.$/, '').replace(/\s+/g, ' ').trim();
  if (s === '') return null;
  return cutAtWord(s, MAX_TITLE).text;
}

export function fallbackTitle(userText: string): string {
  const flat = userText.replace(/\s+/g, ' ').trim();
  const { text, cut } = cutAtWord(flat, FALLBACK_LENGTH);
  return cut ? `${text}…` : text;
}

export interface TitleInput {
  adapter: ProviderAdapter;
  provider: ResolvedProvider;
  model: string;
  reasoningSupported: boolean;
  userText: string;
  assistantText: string;
  signal: AbortSignal;
}

export async function generateTitle(
  input: TitleInput,
): Promise<{ title: string | null; usage: ProviderUsage | null }> {
  let text = '';
  let usage: ProviderUsage | null = null;
  const events = input.adapter.streamChat(
    input.provider,
    {
      model: input.model,
      messages: [
        { role: 'system', content: TITLE_PROMPT },
        {
          role: 'user',
          content: `User: ${input.userText.slice(0, 1000)}\n\nAssistant: ${input.assistantText.slice(0, 500)}`,
        },
      ],
      maxTokens: 256,
      ...(input.reasoningSupported ? { reasoning: { effort: 'low', exclude: true } } : {}),
    },
    input.signal,
  );
  for await (const e of events) {
    if (e.type === 'text') text += e.text;
    else if (e.type === 'usage') usage = e.usage;
    else if (e.type === 'error') return { title: null, usage };
  }
  return { title: sanitizeTitle(text), usage };
}

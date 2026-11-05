import { childrenOf, type MessagePublic } from '@neotext/shared';

/**
 * Whether redoing the answer to `userMessageId` (retry, regenerate, edit and resend) searches
 * the web: yes when the latest answer cited web sources, so a web answer is redone as one;
 * otherwise, since an answer without sources does not say what was chosen, the user's default.
 */
export function webChoiceFor(
  messages: MessagePublic[],
  userMessageId: string,
  defaultOn: boolean,
): boolean {
  const latest = childrenOf(messages, userMessageId)
    .filter((m) => m.role === 'assistant')
    .at(-1);
  return latest?.parts.some((p) => p.type === 'sources') === true || defaultOn;
}

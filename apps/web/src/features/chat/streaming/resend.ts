import {
  type AgentPublic,
  ATTACHMENT_UNAVAILABLE_ID,
  childrenOf,
  type MessagePublic,
  type ModelRef,
} from '@neotext/shared';

// What a regenerate or an edit-and-resend reuses from the answer it replaces.

export const attachmentIdsOf = (m: MessagePublic) =>
  m.parts.flatMap((p) =>
    p.type === 'attachment' && p.attachmentId !== ATTACHMENT_UNAVAILABLE_ID ? [p.attachmentId] : [],
  );

/** The answer that follows a user message in the active branch, else its newest answer. */
export function modelFor(messages: MessagePublic[], userMessageId: string): ModelRef | null {
  const answers = childrenOf(messages, userMessageId).filter((m) => m.role === 'assistant');
  return answers.at(-1)?.model ?? null;
}

/** The agent that wrote the latest answer to a user message, so a new answer asks it again, while it still exists and is enabled. */
export function agentFor(
  messages: MessagePublic[],
  userMessageId: string,
  agents: readonly AgentPublic[] | undefined,
): string | null {
  const answers = childrenOf(messages, userMessageId).filter((m) => m.role === 'assistant');
  const first = answers.at(-1)?.parts[0];
  if (first?.type !== 'agent') return null;
  // A deleted, disabled or imported agent would make the server refuse the whole send.
  return agents?.some((a) => a.id === first.agentId && a.data.enabled) ? first.agentId : null;
}

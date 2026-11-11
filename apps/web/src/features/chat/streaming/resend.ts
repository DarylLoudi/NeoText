import {
  type AgentPublic,
  ATTACHMENT_UNAVAILABLE_ID,
  childrenOf,
  type MessagePublic,
  type ModelRef,
  pathToLeaf,
} from '@neotext/shared';
import { visibleLeaf } from '../thread';

// What a regenerate or an edit-and-resend reuses from the answer it replaces.

export const attachmentIdsOf = (m: MessagePublic) =>
  m.parts.flatMap((p) =>
    p.type === 'attachment' && p.attachmentId !== ATTACHMENT_UNAVAILABLE_ID ? [p.attachmentId] : [],
  );

/** The answer that follows a user message on the branch shown, else its newest answer. */
function answerTo(
  messages: MessagePublic[],
  userMessageId: string,
  activeLeafId: string | null,
): MessagePublic | undefined {
  const answers = childrenOf(messages, userMessageId).filter((m) => m.role === 'assistant');
  const shown = new Set(pathToLeaf(messages, visibleLeaf(messages, activeLeafId)).map((m) => m.id));
  return answers.find((m) => shown.has(m.id)) ?? answers.at(-1);
}

/** The model of the answer on screen for a user message (see `answerTo`). */
export function modelFor(
  messages: MessagePublic[],
  userMessageId: string,
  activeLeafId: string | null,
): ModelRef | null {
  return answerTo(messages, userMessageId, activeLeafId)?.model ?? null;
}

/** The agent that wrote the answer on screen for a user message, so a new answer asks it again, while it still exists and is enabled. */
export function agentFor(
  messages: MessagePublic[],
  userMessageId: string,
  agents: readonly AgentPublic[] | undefined,
  activeLeafId: string | null = null,
): string | null {
  const first = answerTo(messages, userMessageId, activeLeafId)?.parts[0];
  if (first?.type !== 'agent') return null;
  // A deleted, disabled or imported agent would make the server refuse the whole send.
  return agents?.some((a) => a.id === first.agentId && a.data.enabled) ? first.agentId : null;
}

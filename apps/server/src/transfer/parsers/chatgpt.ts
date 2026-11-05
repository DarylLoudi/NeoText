import {
  BadConversation,
  conversationsArray,
  type ImportedConversation,
  type ImportedMessage,
  isObject,
  type Json,
  okOnly,
  type ParsedItem,
  readEach,
  str,
  titleOf,
  treeOrder,
} from './types';

/** ChatGPT times are seconds, sometimes fractional, sometimes null. */
const seconds = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 1000) : null;

const TEXT_TYPES = new Set(['text', 'multimodal_text']);

/** The node's message as a kept message, or null when it is hidden, a tool call or empty. */
function keptMessage(
  node: Json,
): { role: 'user' | 'assistant'; text: string; at: number | null; model: string | null } | null {
  const message = node.message;
  if (!isObject(message)) return null;
  const role = isObject(message.author) ? message.author.role : null;
  if (role !== 'user' && role !== 'assistant') return null;
  const metadata = isObject(message.metadata) ? message.metadata : {};
  if (metadata.is_visually_hidden_from_conversation === true) return null;
  // An assistant message addressed to a tool (a browser call, code) is not part of the chat.
  const recipient = str(message.recipient);
  if (role === 'assistant' && recipient !== null && recipient !== 'all') return null;
  const content = isObject(message.content) ? message.content : null;
  if (!content || !TEXT_TYPES.has(str(content.content_type) ?? '')) return null;
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const text = parts
    .filter((p): p is string => typeof p === 'string')
    .join('\n')
    .trim();
  if (text === '') return null;
  return {
    role,
    text,
    at: seconds(message.create_time),
    model: role === 'assistant' ? str(metadata.model_slug) : null,
  };
}

/** Parents first: a message never reads as older than the one it answers. */
function clampToParents(ordered: ImportedMessage[]): void {
  const at = new Map<string, number>();
  for (const m of ordered) {
    const floor = m.parentSourceId === null ? 0 : (at.get(m.parentSourceId) ?? 0);
    m.createdAt = Math.max(m.createdAt, floor);
    at.set(m.sourceId, m.createdAt);
  }
}

function parseConversation(item: unknown): ImportedConversation {
  if (!isObject(item))
    throw new BadConversation('not_a_conversation', 'This entry is not a conversation.');
  const sourceId = str(item.conversation_id) ?? str(item.id);
  if (!sourceId) throw new BadConversation('missing_id', 'This conversation has no id.');
  const mapping = item.mapping;
  if (!isObject(mapping))
    throw new BadConversation('missing_messages', 'This conversation has no message tree.');
  const created = seconds(item.create_time);
  const updated = seconds(item.update_time);

  const nodes = new Map<string, Json>();
  for (const [key, node] of Object.entries(mapping)) if (isObject(node)) nodes.set(key, node);
  const kept = new Map<string, NonNullable<ReturnType<typeof keptMessage>>>();
  for (const [key, node] of nodes) {
    const m = keptMessage(node);
    if (m) kept.set(key, m);
  }

  /** Skipped node id → its nearest kept ancestor, filled in as walks pass through. */
  const resolved = new Map<string, string | null>();
  /**
   * The nearest kept node at or above `id`; a parent cycle ends the walk. Every skipped node
   * on the way remembers the answer, so long runs of hidden nodes are walked once in total.
   */
  const nearestKept = (id: string | null): string | null => {
    const path: string[] = [];
    const seen = new Set<string>();
    let cur = id;
    let found: string | null = null;
    while (cur !== null && !seen.has(cur)) {
      if (kept.has(cur)) {
        found = cur;
        break;
      }
      const known = resolved.get(cur);
      if (known !== undefined) {
        found = known;
        break;
      }
      seen.add(cur);
      path.push(cur);
      cur = str(nodes.get(cur)?.parent);
    }
    for (const p of path) resolved.set(p, found);
    return found;
  };
  const parentOf = new Map<string, string | null>();
  for (const key of kept.keys()) parentOf.set(key, nearestKept(str(nodes.get(key)?.parent)));

  const fallback = created ?? 0;
  const ordered = treeOrder(
    [...kept].map(([key, m]) => ({
      sourceId: key,
      parentSourceId: parentOf.get(key) ?? null,
      role: m.role,
      text: m.text,
      createdAt: m.at ?? fallback,
      model: m.model,
    })),
  );
  clampToParents(ordered);
  const first = ordered.reduce((min, m) => Math.min(min, m.createdAt), Number.POSITIVE_INFINITY);
  const last = ordered.reduce((max, m) => Math.max(max, m.createdAt), 0);
  const createdAt = created ?? (Number.isFinite(first) ? first : 0);
  return {
    sourceId,
    title: titleOf(item.title),
    createdAt,
    updatedAt: Math.max(updated ?? last, createdAt),
    messages: ordered,
    activeLeafSourceId: nearestKept(str(item.current_node)),
  };
}

/** Every conversation in a ChatGPT `conversations.json`, each usable or with its reason. */
export function readChatGPT(data: unknown): ParsedItem[] {
  return readEach(conversationsArray(data, 'ChatGPT'), parseConversation, 'title');
}

export function parseChatGPT(data: unknown): ImportedConversation[] {
  return okOnly(readChatGPT(data));
}

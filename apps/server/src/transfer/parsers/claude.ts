import {
  BadConversation,
  conversationsArray,
  type ImportedConversation,
  type ImportedMessage,
  isObject,
  okOnly,
  type ParsedItem,
  readEach,
  str,
  titleOf,
} from './types';

/** Claude dates are ISO strings; anything unparseable is null. */
const iso = (v: unknown): number | null => {
  const s = str(v);
  if (s === null) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
};

const ROLES: Record<string, 'user' | 'assistant'> = { human: 'user', assistant: 'assistant' };

/** `text`, or when that is empty the message's text blocks joined. */
function textOf(m: Record<string, unknown>): string {
  const text = str(m.text)?.trim() ?? '';
  if (text !== '') return text;
  if (!Array.isArray(m.content)) return '';
  return m.content
    .filter((b) => isObject(b) && b.type === 'text' && typeof b.text === 'string')
    .map((b) => (b as { text: string }).text.trim())
    .filter((t) => t !== '')
    .join('\n\n');
}

function parseConversation(item: unknown): ImportedConversation {
  if (!isObject(item))
    throw new BadConversation('not_a_conversation', 'This entry is not a conversation.');
  const sourceId = str(item.uuid);
  if (!sourceId) throw new BadConversation('missing_id', 'This conversation has no id.');
  if (!Array.isArray(item.chat_messages)) {
    throw new BadConversation('missing_messages', 'This conversation has no message list.');
  }
  const created = iso(item.created_at);
  const fallback = created ?? 0;
  const messages: ImportedMessage[] = [];
  const seen = new Set<string>();
  let previous: ImportedMessage | null = null;
  item.chat_messages.forEach((m, i) => {
    if (!isObject(m)) return;
    const role = ROLES[str(m.sender) ?? ''];
    const text = textOf(m);
    if (!role || text === '') return;
    let id = str(m.uuid) ?? `#${i}`;
    if (seen.has(id)) id = `${id}#${i}`;
    seen.add(id);
    const message: ImportedMessage = {
      sourceId: id,
      parentSourceId: previous?.sourceId ?? null,
      role,
      text,
      // Never older than the message before it, so the chain reads in order.
      createdAt: Math.max(iso(m.created_at) ?? fallback, previous?.createdAt ?? 0),
      model: null,
    };
    messages.push(message);
    previous = message;
  });
  const last = messages.at(-1);
  const createdAt = created ?? messages[0]?.createdAt ?? 0;
  return {
    sourceId,
    title: titleOf(item.name),
    createdAt,
    updatedAt: Math.max(iso(item.updated_at) ?? last?.createdAt ?? createdAt, createdAt),
    messages,
    activeLeafSourceId: last?.sourceId ?? null,
  };
}

/** Every conversation in a Claude `conversations.json`, each usable or with its reason. */
export function readClaude(data: unknown): ParsedItem[] {
  return readEach(conversationsArray(data, 'Claude'), parseConversation, 'name');
}

export function parseClaude(data: unknown): ImportedConversation[] {
  return okOnly(readClaude(data));
}

import type {
  ConversationSummary,
  MessagePart,
  MessagePublic,
  MessageStatus,
  ModelRef,
} from '@neotext/shared';
import type { ImportedConversation } from './parsers/types';

/** One conversation ready to write: rows in tree order, parents before children. */
export interface Plan {
  importRef: string;
  originalId?: string;
  conversation: Omit<ConversationSummary, 'id' | 'activeLeafId' | 'messageCount' | 'deletedAt'>;
  messages: {
    sourceId: string;
    parentSourceId: string | null;
    role: 'user' | 'assistant';
    status: MessageStatus;
    parts: MessagePart[];
    model: ModelRef | null;
    modelId: string | null;
    usage: MessagePublic['usage'];
    finishReason: MessagePublic['finishReason'];
    createdAt: number;
    updatedAt: number;
  }[];
  activeLeafSourceId: string | null;
  /** Attached files that became a short note in the text; counted once the plan is written. */
  attachmentNotes?: number;
}

export function planFromExport(source: 'chatgpt' | 'claude', c: ImportedConversation): Plan {
  return {
    importRef: `${source}:${c.sourceId}`,
    conversation: {
      title: c.title,
      titleSource: c.title ? 'user' : 'none',
      folderId: null,
      pinned: false,
      pinPosition: null,
      archived: false,
      presetId: null,
      modelRef: null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      lastActivityAt: c.updatedAt,
    },
    // Parsers already return parents first, siblings by time then source id.
    messages: c.messages.map((m) => ({
      sourceId: m.sourceId,
      parentSourceId: m.parentSourceId,
      role: m.role,
      status: 'complete',
      parts: [{ type: 'text', text: m.text }],
      model: null,
      modelId: m.model,
      usage: null,
      finishReason: null,
      createdAt: m.createdAt,
      updatedAt: m.createdAt,
    })),
    activeLeafSourceId: c.activeLeafSourceId,
  };
}

/** Parents first, siblings by `createdAt` then id, as the app's own lists order them. */
function treeOrder(messages: MessagePublic[]): MessagePublic[] {
  const kids = new Map<string | null, MessagePublic[]>();
  for (const m of messages) {
    const list = kids.get(m.parentId);
    if (list) list.push(m);
    else kids.set(m.parentId, [m]);
  }
  const byTime = (a: MessagePublic, b: MessagePublic) =>
    a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const out = [...(kids.get(null) ?? [])].sort(byTime);
  for (let i = 0; i < out.length; i++) {
    for (const k of [...(kids.get((out[i] as MessagePublic).id) ?? [])].sort(byTime)) out.push(k);
  }
  return out;
}

export function planFromBundle(
  c: ConversationSummary,
  messages: MessagePublic[],
  folderIds: Map<string, string>,
  presetIds: Map<string, string>,
): Plan {
  return {
    importRef: `neotext:${c.id}`,
    originalId: c.id,
    conversation: {
      title: c.title,
      titleSource: c.titleSource,
      folderId: c.folderId ? (folderIds.get(c.folderId) ?? null) : null,
      pinned: c.pinned,
      pinPosition: c.pinned ? c.pinPosition : null,
      archived: c.archived,
      presetId: c.presetId ? (presetIds.get(c.presetId) ?? null) : null,
      modelRef: c.modelRef,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      lastActivityAt: c.lastActivityAt,
    },
    messages: treeOrder(messages).map((m) => ({
      sourceId: m.id,
      parentSourceId: m.parentId,
      role: m.role,
      // No generation is running here, so an answer still streaming in the file was cut off.
      status: m.status === 'streaming' ? 'interrupted' : m.status,
      parts: m.parts,
      model: m.model,
      modelId: m.model?.modelId ?? null,
      usage: m.usage,
      finishReason: m.finishReason,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    })),
    activeLeafSourceId: c.activeLeafId,
  };
}

import {
  type AgentCreate,
  AgentCreateSchema,
  type ConversationSummary,
  ConversationSummarySchema,
  type CreatePresetBody,
  CreatePresetBodySchema,
  type CreateProviderBody,
  CreateProviderBodySchema,
  type Folder,
  FolderSchema,
  type ImportFailure,
  type ImportFailureCode,
  type MessagePart,
  type MessagePublic,
  MessagePublicSchema,
} from '@neotext/shared';
import { z } from 'zod';
import type { BundleV1 } from '../bundle';
import { cleanName, type Failure, failure, isObject, str, TITLE_MAX } from './types';

/** A bundle's rows after validation; ids are still the exporter's. */
export interface NeoTextImport {
  folders: Folder[];
  presets: (CreatePresetBody & { id: string })[];
  /** Agents that validated; names already made one line by the schema. */
  agents: AgentCreate[];
  /** In file order, so failures read in the order the user sees their providers. */
  providers: ({ ok: true; name: string; body: CreateProviderBody } | Failure)[];
  settings: unknown;
  /** The schema version the settings were written at; files that do not say are version 1. */
  settingsSchemaVersion: number;
  conversations: (
    | {
        ok: true;
        conversation: ConversationSummary;
        messages: MessagePublic[];
        /** Attachment parts turned into a short note, as the files are not in the bundle. */
        attachmentNotes: number;
      }
    | Failure
  )[];
  /** Folders and presets that did not validate. */
  failed: ImportFailure[];
}

const FOLDER_NAME_MAX = 80;
const PRESET_NAME_MAX = 60;
const COLOR = /^#[0-9a-fA-F]{6}$/;

const BundleProviderSchema = z.object({
  kind: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  apiKey: z.string().nullable(),
  headers: z.record(z.string(), z.string()).nullable(),
  manualModels: z.array(z.string()),
});

const isWebUrl = (url: string): boolean => {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Parts as they may be shown here. Bundles carry no attachment files yet, so an attachment
 * part becomes a short note instead of a pointer to a file that does not exist; the note has
 * no words in it, so it reads the same in every language. Sources that
 * are not plain web links (`javascript:`, `data:`, ...) are dropped.
 */
const safeParts = (parts: MessagePart[]): MessagePart[] =>
  parts.flatMap((p): MessagePart[] => {
    if (p.type === 'attachment') {
      const name = cleanName(p.name, TITLE_MAX);
      return [{ type: 'text', text: `[📎 ${name}]` }];
    }
    if (p.type === 'sources') {
      const sources = p.sources.filter((source) => isWebUrl(source.url));
      return sources.length > 0 ? [{ ...p, sources }] : [];
    }
    return [p];
  });

const nameOf = (row: unknown, key: string): string | null => {
  const v = isObject(row) ? str(row[key]) : null;
  return v === null ? null : cleanName(v, TITLE_MAX) || null;
};

const skipped = (row: unknown, code: ImportFailureCode, what: string): ImportFailure => ({
  title: nameOf(row, 'name'),
  code,
  reason: `A ${what} in the file is not valid, so it was skipped.`,
});

/** True when every message hangs off a root of this conversation, without cycles. */
function isTree(messages: MessagePublic[]): boolean {
  const ids = new Set(messages.map((m) => m.id));
  if (ids.size !== messages.length) return false;
  const kids = new Map<string | null, MessagePublic[]>();
  for (const m of messages) {
    if (m.parentId !== null && !ids.has(m.parentId)) return false;
    const list = kids.get(m.parentId);
    if (list) list.push(m);
    else kids.set(m.parentId, [m]);
  }
  const reached = [...(kids.get(null) ?? [])];
  // One push at a time: spreading a very wide level into push() can overflow the stack.
  for (let i = 0; i < reached.length; i++) {
    for (const k of kids.get((reached[i] as MessagePublic).id) ?? []) reached.push(k);
  }
  return reached.length === messages.length;
}

/** Validates every row of an opened bundle; nothing from the file is trusted as typed. */
export function readNeoText(bundle: BundleV1): NeoTextImport {
  const failed: ImportFailure[] = [];

  const folders: Folder[] = [];
  for (const row of bundle.folders as unknown[]) {
    const parsed = FolderSchema.safeParse(row);
    const name = parsed.success ? cleanName(parsed.data.name, FOLDER_NAME_MAX) : '';
    if (!parsed.success || name === '') {
      failed.push(skipped(row, 'invalid_folder', 'folder'));
      continue;
    }
    folders.push({
      ...parsed.data,
      name,
      color: parsed.data.color !== null && COLOR.test(parsed.data.color) ? parsed.data.color : null,
    });
  }

  const presets: NeoTextImport['presets'] = [];
  for (const row of bundle.presets as unknown[]) {
    const id = isObject(row) ? str(row.id) : null;
    const parsed = CreatePresetBodySchema.safeParse(row);
    const name = parsed.success ? cleanName(parsed.data.name, PRESET_NAME_MAX) : '';
    if (!parsed.success || !id || name === '') {
      failed.push(skipped(row, 'invalid_preset', 'preset'));
      continue;
    }
    presets.push({ ...parsed.data, name, id });
  }

  const agents: AgentCreate[] = [];
  for (const row of (bundle.agents ?? []) as unknown[]) {
    const parsed = AgentCreateSchema.safeParse(row);
    if (!parsed.success) {
      failed.push({
        title: nameOf(row, 'name'),
        reason: 'An agent in the file is not valid, so it was skipped.',
      });
      continue;
    }
    agents.push(parsed.data);
  }

  const providers: NeoTextImport['providers'] = [];
  for (const row of (bundle.providers ?? []) as unknown[]) {
    const raw = BundleProviderSchema.safeParse(row);
    const body = raw.success
      ? CreateProviderBodySchema.safeParse({
          kind: raw.data.kind,
          name: raw.data.name,
          baseUrl: raw.data.baseUrl,
          ...(raw.data.apiKey ? { apiKey: raw.data.apiKey } : {}),
          ...(raw.data.headers ? { headers: raw.data.headers } : {}),
          ...(raw.data.manualModels.length > 0 ? { manualModels: raw.data.manualModels } : {}),
        })
      : null;
    if (!body?.success) {
      providers.push({ ok: false, ...skipped(row, 'invalid_provider', 'provider') });
      continue;
    }
    providers.push({ ok: true, name: body.data.name, body: body.data });
  }

  // Messages grouped by conversation; a broken message spoils only its own conversation.
  const byConversation = new Map<string, MessagePublic[]>();
  const spoiled = new Set<string>();
  const notes = new Map<string, number>();
  for (const row of bundle.messages as unknown[]) {
    const parsed = MessagePublicSchema.safeParse(row);
    if (!parsed.success) {
      const owner = isObject(row) ? str(row.conversationId) : null;
      if (owner) spoiled.add(owner);
      continue;
    }
    const m = { ...parsed.data, parts: safeParts(parsed.data.parts) };
    const attached = parsed.data.parts.filter((p) => p.type === 'attachment').length;
    if (attached > 0) notes.set(m.conversationId, (notes.get(m.conversationId) ?? 0) + attached);
    const list = byConversation.get(m.conversationId);
    if (list) list.push(m);
    else byConversation.set(m.conversationId, [m]);
  }

  const seen = new Set<string>();
  const conversations: NeoTextImport['conversations'] = [];
  for (const row of bundle.conversations as unknown[]) {
    const parsed = ConversationSummarySchema.safeParse(row);
    if (!parsed.success) {
      conversations.push(
        failure(
          nameOf(row, 'title'),
          'invalid_conversation',
          'This conversation in the file is not valid.',
        ),
      );
      continue;
    }
    const c = parsed.data;
    const title = c.title === null ? null : cleanName(c.title, TITLE_MAX) || null;
    const messages = byConversation.get(c.id) ?? [];
    let bad: Failure | null = null;
    if (seen.has(c.id)) {
      bad = failure(
        title,
        'duplicate_conversation',
        'This conversation appears twice in the file.',
      );
    } else if (spoiled.has(c.id)) {
      bad = failure(title, 'invalid_message', 'A message in this conversation is not valid.');
    } else if (messages.length === 0) {
      bad = failure(title, 'no_messages', 'This conversation has no messages to import.');
    } else if (!isTree(messages)) {
      bad = failure(
        title,
        'broken_thread',
        'The messages in this conversation do not form a valid thread.',
      );
    }
    seen.add(c.id);
    conversations.push(
      bad ?? {
        ok: true,
        conversation: { ...c, title },
        messages,
        attachmentNotes: notes.get(c.id) ?? 0,
      },
    );
  }

  // Read only: an export may name the version; files that do not were written at version 1.
  const declared = (bundle as unknown as Record<string, unknown>).settingsSchemaVersion;
  const settingsSchemaVersion =
    typeof declared === 'number' && Number.isInteger(declared) && declared >= 1 ? declared : 1;
  return {
    folders,
    presets,
    agents,
    providers,
    settings: bundle.settings,
    settingsSchemaVersion,
    conversations,
    failed,
  };
}

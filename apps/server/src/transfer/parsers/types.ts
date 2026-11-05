import type { ImportFailure, ImportFailureCode } from '@neotext/shared';
import { AppError } from '../../http/errors';

export interface ImportedMessage {
  sourceId: string;
  parentSourceId: string | null;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  model: string | null;
}

export interface ImportedConversation {
  sourceId: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  messages: ImportedMessage[];
  activeLeafSourceId: string | null;
}

/** Something left out of an import, with a code the web words and an English fallback. */
export type Failure = ImportFailure & { ok: false };

export const failure = (
  title: string | null,
  code: ImportFailureCode,
  reason: string,
): Failure => ({ ok: false, title, code, reason });

/** One conversation read from a file: either usable, or the reason it is not. */
export type ParsedItem = { ok: true; conversation: ImportedConversation } | Failure;

/** Thrown inside a parser for one conversation; the reason is shown to the user. */
export class BadConversation extends Error {
  readonly code: ImportFailureCode;
  constructor(code: ImportFailureCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type Json = Record<string, unknown>;

export const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

// C0 controls and DEL become spaces; bidi embeddings, overrides and isolates are removed, so
// a crafted name cannot reorder the text around it.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
const CONTROL = /[\u0000-\u001f\u007f]/g;
const BIDI = /[\u202a-\u202e\u2066-\u2069]/g;

/** A title or folder name from a file: no control or bidi characters, one line, at most `max`. */
export function cleanName(v: string, max: number): string {
  return v.replace(BIDI, '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Titles longer than this are cut; the app's own limit is 200. */
export const TITLE_MAX = 200;
export const titleOf = (v: unknown): string | null => {
  const s = str(v);
  return s === null ? null : cleanName(s, TITLE_MAX) || null;
};

export const notExport = (product: string) =>
  new AppError(
    'bad_request',
    `This is not a ${product} export. Choose the conversations.json file, or the .zip it came in, from your ${product} data export.`,
    400,
    { reason: 'not_export' },
  );

/** The top-level value of an export must be an array of conversations. */
export function conversationsArray(data: unknown, product: string): unknown[] {
  if (!Array.isArray(data)) throw notExport(product);
  return data;
}

/** Runs `parse` on each item; a conversation that throws is reported with a plain reason. */
export function readEach(
  items: unknown[],
  parse: (item: unknown) => ImportedConversation,
  titleKey: string,
): ParsedItem[] {
  return items.map((item) => {
    try {
      const conversation = parse(item);
      if (conversation.messages.length === 0) {
        return failure(
          conversation.title,
          'no_messages',
          'This conversation has no messages to import.',
        );
      }
      return { ok: true, conversation };
    } catch (err) {
      const title = isObject(item) ? titleOf(item[titleKey]) : null;
      return err instanceof BadConversation
        ? failure(title, err.code, err.message)
        : failure(title, 'unreadable', 'This conversation could not be read.');
    }
  });
}

export const okOnly = (items: ParsedItem[]): ImportedConversation[] =>
  items.flatMap((i) => (i.ok ? [i.conversation] : []));

/** Messages ordered parents first, siblings by `createdAt` then `sourceId`. */
export function treeOrder(messages: ImportedMessage[]): ImportedMessage[] {
  const kids = new Map<string | null, ImportedMessage[]>();
  for (const m of messages) {
    const list = kids.get(m.parentSourceId);
    if (list) list.push(m);
    else kids.set(m.parentSourceId, [m]);
  }
  const byTime = (a: ImportedMessage, b: ImportedMessage) =>
    a.createdAt - b.createdAt || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0);
  const out = [...(kids.get(null) ?? [])].sort(byTime);
  for (let i = 0; i < out.length; i++) {
    const m = out[i] as ImportedMessage;
    for (const k of [...(kids.get(m.sourceId) ?? [])].sort(byTime)) out.push(k);
  }
  return out;
}

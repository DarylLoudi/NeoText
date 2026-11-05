import type { ConversationSummary, SearchResponse, SearchResult } from '@neotext/shared';
import type { ConversationsRepo } from '../chat/conversations-repo';
import type { MessagesRepo } from '../chat/messages-repo';
import type { AuthContext } from '../http/env';
import { AppError } from '../http/errors';

/** How long one call may scan before it hands back what it has and a cursor. */
export const SEARCH_BUDGET_MS = 400;
const DEFAULT_LIMIT = 20;
const PAGE = 50;
const SNIPPET_LENGTH = 160;
/**
 * Only the first 100,000 characters of one message's text are searched, so folding a huge
 * paste cannot spend the whole budget in a single step.
 */
const MAX_HAYSTACK = 100_000;

export interface SearchDeps {
  conversations: ConversationsRepo;
  messages: MessagesRepo;
  now: () => number;
}

interface Folded {
  text: string;
  /** For each folded UTF-16 unit, where its source character starts and ends in the original. */
  starts: number[];
  ends: number[];
}

const MARKS = /\p{M}/gu;
const fold = (s: string) => s.normalize('NFKD').replace(MARKS, '').toLowerCase();

/** Folds one character at a time so every folded unit maps back to its original character. */
function foldWithMap(s: string): Folded {
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  for (const ch of s) {
    const folded = fold(ch);
    for (let k = 0; k < folded.length; k++) {
      starts.push(i);
      ends.push(i + ch.length);
    }
    text += folded;
    i += ch.length;
  }
  return { text, starts, ends };
}

/** NFKD, combining marks removed, lowercase: "CAFÉ" and "cafe" compare equal. */
export function foldText(s: string): string {
  return foldWithMap(s).text;
}

/** About 160 characters of plain text around a match, on one line, with ellipses at cut ends. */
export function makeSnippet(text: string, index: number, length: number): string {
  const room = Math.max(0, SNIPPET_LENGTH - length);
  let start = Math.max(0, index - Math.floor(room / 2));
  const end = Math.min(text.length, start + SNIPPET_LENGTH);
  start = Math.max(0, Math.min(start, end - SNIPPET_LENGTH));
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`;
}

/**
 * Known limit: the cursor holds a message position, not a message id. A message deleted or
 * added in a chat between two pages can make the next page repeat or skip one message.
 */
interface Cursor {
  /** The conversation to resume at (inclusive), as its `lastActivityAt` and id. */
  at: number;
  id: string;
  /** Index of the next message to check in it; null when the conversation is not started. */
  m: number | null;
}

const badCursor = () =>
  new AppError('bad_request', 'That page cursor is not valid. Search again.', 400);

const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');

function decodeCursor(raw: string): Cursor {
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (
      typeof v.at === 'number' &&
      Number.isFinite(v.at) &&
      typeof v.id === 'string' &&
      (v.m === null || (typeof v.m === 'number' && Number.isInteger(v.m) && v.m >= 0))
    ) {
      return { at: v.at, id: v.id, m: v.m };
    }
  } catch {
    // fall through
  }
  throw badCursor();
}

function textOf(parts: { type: string; text?: string }[]): string {
  return parts
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('\n');
}

function matchIn(haystack: string, needle: string): { index: number; length: number } | null {
  const h = foldWithMap(haystack);
  const at = h.text.indexOf(needle);
  if (at < 0) return null;
  const start = h.starts[at] ?? 0;
  const end = h.ends[at + needle.length - 1] ?? haystack.length;
  return { index: start, length: end - start };
}

/**
 * Walks the user's chats, newest activity first: the title, then each message's text parts.
 * Matching is `indexOf` on folded text, so nothing in the query is ever a pattern. It stops at
 * `limit` results or when the time budget is spent, and the cursor resumes at the exact message.
 */
export function searchConversations(
  deps: SearchDeps,
  auth: AuthContext,
  q: string,
  opts: { cursor?: string; limit?: number },
): SearchResponse {
  const query = q.trim();
  if (query.length < 2) {
    throw new AppError('validation_failed', 'Type at least 2 characters to search.', 400);
  }
  const needle = foldText(query);
  if (needle.length < 2) {
    throw new AppError('validation_failed', 'Type at least 2 characters to search.', 400);
  }
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const resume = opts.cursor ? decodeCursor(opts.cursor) : null;
  const started = deps.now();
  const results: SearchResult[] = [];
  let work = 0;

  // Stops are only taken after at least one unit of work, so every call makes progress.
  const spent = () => work > 0 && deps.now() - started >= SEARCH_BUDGET_MS;
  const stop = (cursor: Cursor, partial: boolean): SearchResponse => ({
    results,
    nextCursor: encodeCursor(cursor),
    partial,
  });

  function scan(
    conv: ConversationSummary,
    fromMessage: number | null,
  ): { at: number; m: number; partial: boolean } | null {
    if (fromMessage === null) {
      work++;
      const title = conv.title;
      const hit = title ? matchIn(title, needle) : null;
      if (title && hit) {
        results.push({
          conversationId: conv.id,
          messageId: null,
          title,
          snippet: makeSnippet(title, hit.index, hit.length),
          matchedIn: 'title',
          at: conv.lastActivityAt,
        });
      }
    }
    // Rows are decrypted one at a time, and the limit and budget are checked after each, so a
    // very long chat cannot run past the budget.
    let i = fromMessage ?? 0;
    for (const msg of deps.messages.iterateForConversation(conv.id, auth.dek, i)) {
      work++;
      i++;
      const text = textOf(msg.parts).slice(0, MAX_HAYSTACK);
      const hit = text ? matchIn(text, needle) : null;
      if (hit) {
        results.push({
          conversationId: conv.id,
          messageId: msg.id,
          title: conv.title,
          snippet: makeSnippet(text, hit.index, hit.length),
          matchedIn: 'message',
          at: msg.createdAt,
        });
      }
      if (results.length >= limit) return { at: conv.lastActivityAt, m: i, partial: false };
      if (spent()) return { at: conv.lastActivityAt, m: i, partial: true };
    }
    return null;
  }

  // Pick up the conversation the previous call stopped at; one deleted since is skipped.
  let after: string | undefined;
  if (resume) {
    const conv = deps.conversations.get(auth.userId, resume.id, auth.dek);
    if (conv) {
      const stopped = scan(conv, resume.m);
      if (stopped) return stop({ at: stopped.at, id: conv.id, m: stopped.m }, stopped.partial);
    }
    after = encodeListCursor(resume.at, resume.id);
  }

  let pageCursor = after;
  for (;;) {
    const page = deps.conversations.list(auth.userId, auth.dek, {
      scope: 'all',
      limit: PAGE,
      cursor: pageCursor,
    });
    for (const conv of page.items) {
      if (results.length >= limit)
        return stop({ at: conv.lastActivityAt, id: conv.id, m: null }, false);
      if (spent()) return stop({ at: conv.lastActivityAt, id: conv.id, m: null }, true);
      const stopped = scan(conv, null);
      if (stopped) return stop({ at: stopped.at, id: conv.id, m: stopped.m }, stopped.partial);
    }
    if (!page.nextCursor) return { results, nextCursor: null, partial: false };
    pageCursor = page.nextCursor;
  }
}

/** The conversations list cursor, which resumes strictly after the given row. */
function encodeListCursor(lastActivityAt: number, id: string): string {
  return Buffer.from(JSON.stringify([lastActivityAt, id])).toString('base64url');
}

export interface ConversationSearch {
  search(auth: AuthContext, q: string, opts: { cursor?: string; limit?: number }): SearchResponse;
}

export function createConversationSearch(deps: {
  conversations: ConversationsRepo;
  messages: MessagesRepo;
}): ConversationSearch {
  // The budget is wall time, so it reads the real clock rather than the app's test clock.
  const wall = () => performance.now();
  return {
    search: (auth, q, opts) =>
      searchConversations(
        { conversations: deps.conversations, messages: deps.messages, now: wall },
        auth,
        q,
        opts,
      ),
  };
}

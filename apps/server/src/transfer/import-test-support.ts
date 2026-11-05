import { readFileSync } from 'node:fs';
import { type ConversationSummary, type MessagePublic, newId } from '@neotext/shared';
import { afterEach, beforeEach } from 'vitest';
import {
  authContextFor,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';
import type { AuthContext } from '../http/env';
import { type BundleV1, sealBundle } from './bundle';

export const PW = 'kata sandi yang panjang';
export const KEY = 'sk-or-test-import-0123456789';
const fixture = (name: string) =>
  readFileSync(new URL(`../../test-support/fixtures/${name}`, import.meta.url));
export const chatgpt = fixture('chatgpt-export.json');
export const claude = fixture('claude-export.json');

// Live bindings: `useImportApp` reassigns them before each test, so test files read them as
// plain variables.
export let t: TestApp;
export let auth: AuthContext;
export let cookie: string;

/** Registers the per-test app and owner session that the import test files share. */
export function useImportApp(): void {
  beforeEach(async () => {
    t = await createTestApp();
    ({ cookie } = await setupOwner(t));
    auth = authContextFor(t, cookie);
  });
  afterEach(() => t.close());
}

export const all = (a: AuthContext): ConversationSummary[] =>
  t.c.repos.conversations.list(a.userId, a.dek, { scope: 'all', limit: 100 }).items;
export const detail = (a: AuthContext, id: string) => t.c.conversations.detail(a, id);
export const importer = () => t.c.importer;

/** A chat with a regenerated answer; returns its id. */
export function seed(
  a: AuthContext,
  title: string,
  opts: { folderId?: string | null } = {},
): string {
  const id = newId('cnv');
  const at = t.c.clock.now();
  t.c.repos.conversations.insert(
    { id, userId: a.userId, folderId: opts.folderId ?? null, title, createdAt: at },
    a.dek,
  );
  const u = newId('msg');
  const m1 = newId('msg');
  const m2 = newId('msg');
  const base = { conversationId: id, userId: a.userId, createdAt: at };
  t.c.repos.messages.insert(
    {
      ...base,
      id: u,
      parentId: null,
      role: 'user',
      status: 'complete',
      parts: [{ type: 'text', text: `Tanya ${title}` }],
      providerId: null,
      modelId: null,
    },
    a.dek,
  );
  t.c.repos.messages.insert(
    {
      ...base,
      id: m1,
      parentId: u,
      role: 'assistant',
      status: 'error',
      parts: [{ type: 'error', code: 'upstream', message: 'Gagal' }],
      providerId: 'prv_x',
      modelId: 'test/model',
      createdAt: at + 1,
    },
    a.dek,
  );
  t.c.repos.messages.insert(
    {
      ...base,
      id: m2,
      parentId: u,
      role: 'assistant',
      status: 'complete',
      parts: [{ type: 'text', text: `Jawab ${title}` }],
      providerId: 'prv_x',
      modelId: 'test/model',
      createdAt: at + 2,
    },
    a.dek,
  );
  t.c.repos.messages.update(
    m2,
    {
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        reasoningTokens: 0,
        cachedTokens: 0,
        costUsd: 0.001,
        webSearchRequests: 0,
        ttftMs: 100,
        durationMs: 400,
        upstreamProvider: null,
        contextTokens: null,
      },
      finishReason: 'stop',
    },
    at + 2,
    a.dek,
  );
  t.c.repos.conversations.update(a.userId, id, { activeLeafId: m2, messageCount: 3 }, at, a.dek);
  return id;
}

/** A sealed bundle built from `edit(base)`, for tests of hand-made or broken files. */
export async function bundleFile(edit: (b: BundleV1) => void = () => {}): Promise<Buffer> {
  const b: BundleV1 = {
    version: 1,
    exportedAt: t.c.clock.now(),
    app: 'NeoText test',
    settings: {},
    folders: [],
    conversations: [],
    messages: [],
    presets: [],
  };
  edit(b);
  return sealBundle(b, PW);
}

export const summary = (
  over: Partial<ConversationSummary> & { id: string },
): ConversationSummary => ({
  title: 'Judul',
  titleSource: 'user',
  folderId: null,
  pinned: false,
  pinPosition: null,
  archived: false,
  presetId: null,
  modelRef: null,
  activeLeafId: null,
  messageCount: 0,
  createdAt: 1000,
  updatedAt: 2000,
  lastActivityAt: 2000,
  deletedAt: null,
  ...over,
});

export const message = (over: Partial<MessagePublic> & { id: string; conversationId: string }) =>
  ({
    parentId: null,
    role: 'user',
    status: 'complete',
    parts: [{ type: 'text', text: 'Halo' }],
    model: null,
    usage: null,
    finishReason: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  }) as MessagePublic;

import {
  type ConversationSummary,
  type ExportBody,
  type MessagePublic,
  pathToLeaf,
  SETTINGS_SCHEMA_VERSION,
} from '@neotext/shared';
import { strToU8 } from 'fflate';
import type { AuditLog } from '../audit/audit';
import type { ConversationsRepo } from '../chat/conversations-repo';
import type { FoldersRepo } from '../chat/folders-repo';
import type { MessagesRepo } from '../chat/messages-repo';
import type { AuthContext } from '../http/env';
import { AppError } from '../http/errors';
import type { Clock } from '../lib/clock';
import type { PresetsService } from '../presets/service';
import type { ProviderService } from '../providers/service';
import type { SettingsService } from '../settings/service';
import { type BundleProvider, MAX_UNPACKED_BYTES, sealBundleJson } from './bundle';
import { jsonObjectWriter } from './json-pieces';
import { conversationToMarkdown, safeFileName, uniqueFileNames } from './markdown';
import { createPace, type Pace, WORK_BUDGET_MS } from './pace';
import { zipFiles } from './zip-writer';

export interface ExportFile {
  filename: string;
  contentType: string;
  data: Buffer;
  /** Attached files the export could not carry; their messages keep only their text. */
  skippedAttachments: number;
}

export interface ExportService {
  exportData(auth: AuthContext, body: ExportBody): Promise<ExportFile>;
}

export interface ExportServiceDeps {
  conversations: ConversationsRepo;
  messages: MessagesRepo;
  folders: FoldersRepo;
  presets: PresetsService;
  settings: SettingsService;
  providers: ProviderService;
  audit: AuditLog;
  clock: Clock;
  appVersion: string;
  /** A NeoText file whose bundle JSON would pass this is refused; it could not be imported. */
  maxBundleBytes?: number;
  /** Synchronous work between yields to the event loop. */
  workBudgetMs?: number;
}

const PAGE = 100;

// `details.reason` lets the web word this in the user's language (ExportErrorReason).
const tooLarge = () =>
  new AppError(
    'bad_request',
    'Your chats are too large for one NeoText file. Export them as Markdown instead, or delete chats you no longer need and try again.',
    400,
    { reason: 'export_too_large' },
  );

const attachmentsIn = (list: MessagePublic[]) =>
  list.reduce((n, m) => n + m.parts.filter((p) => p.type === 'attachment').length, 0);

/** `YYYYMMDD` in UTC. */
const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 10).replaceAll('-', '');

export function createExportService(deps: ExportServiceDeps): ExportService {
  const { conversations, messages, folders, presets, settings, providers, audit, clock } = deps;
  const maxBundleBytes = deps.maxBundleBytes ?? MAX_UNPACKED_BYTES;
  const newPace = () => createPace(deps.workBudgetMs ?? WORK_BUDGET_MS);

  /** Every chat the user has outside the trash, newest activity first. */
  async function allConversations(auth: AuthContext, pace: Pace): Promise<ConversationSummary[]> {
    const out: ConversationSummary[] = [];
    let cursor: string | undefined;
    do {
      const page = conversations.list(auth.userId, auth.dek, { scope: 'all', limit: PAGE, cursor });
      out.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      await pace();
    } while (cursor);
    return out;
  }

  /** The user's own providers with their keys opened; shared providers belong to the instance. */
  function ownProviders(auth: AuthContext): BundleProvider[] {
    return providers
      .list(auth)
      .filter((p) => !p.shared)
      .map((p) => {
        let secrets: Pick<BundleProvider, 'apiKey' | 'headers'>;
        try {
          const r = providers.resolve(auth, p.id);
          secrets = {
            apiKey: r.apiKey,
            headers: Object.keys(r.headers).length > 0 ? r.headers : null,
          };
        } catch {
          // A key that no longer opens is left out; the rest of the export still goes ahead.
          secrets = { apiKey: null, headers: null };
        }
        return {
          kind: p.kind,
          name: p.name,
          baseUrl: p.baseUrl,
          ...secrets,
          manualModels: p.manualModels,
          category: p.category,
        };
      });
  }

  /**
   * The bundle as JSON text (the `BundleV1` shape), written one conversation at a time so the
   * decrypting and the stringifying both stop for other requests on the way. It stops as soon
   * as the text grows past `maxBytes`.
   */
  async function bundleJson(auth: AuthContext, withKeys: boolean, indent: 0 | 2, maxBytes: number) {
    const pace = newPace();
    const convos = await allConversations(auth, pace);
    const w = jsonObjectWriter(indent);
    w.value('version', 1);
    w.value('exportedAt', clock.now());
    w.value('app', `NeoText ${deps.appVersion}`);
    w.value('settings', settings.get(auth.userId, auth.dek).settings);
    // `settings.get` migrates to the app's schema, so that is the version these were written at.
    w.value('settingsSchemaVersion', SETTINGS_SCHEMA_VERSION);
    w.value('folders', folders.list(auth.userId, auth.dek));
    w.beginArray('conversations');
    for (let i = 0; i < convos.length; i += PAGE) w.items(convos.slice(i, i + PAGE));
    w.endArray();
    let skippedAttachments = 0;
    w.beginArray('messages');
    for (const c of convos) {
      const list = messages.listForConversation(c.id, auth.dek);
      skippedAttachments += attachmentsIn(list);
      w.items(list);
      if (w.bytes > maxBytes) throw tooLarge();
      await pace();
    }
    w.endArray();
    w.value('presets', presets.list(auth));
    if (withKeys) w.value('providers', ownProviders(auth));
    const json = w.end();
    if (json.length > maxBytes) throw tooLarge();
    return { json, skippedAttachments };
  }

  const activePath = (c: ConversationSummary, auth: AuthContext): MessagePublic[] =>
    pathToLeaf(messages.listForConversation(c.id, auth.dek), c.activeLeafId);

  async function markdown(
    auth: AuthContext,
    conversationId: string | undefined,
  ): Promise<ExportFile> {
    if (conversationId !== undefined) {
      const c = conversations.get(auth.userId, conversationId, auth.dek);
      if (!c) throw new AppError('not_found', 'That conversation does not exist.', 404);
      const path = activePath(c, auth);
      return {
        filename: `${safeFileName(c.title)}.md`,
        contentType: 'text/markdown; charset=utf-8',
        data: Buffer.from(conversationToMarkdown(c, path), 'utf8'),
        skippedAttachments: attachmentsIn(path),
      };
    }
    const pace = newPace();
    const convos = await allConversations(auth, pace);
    const names = uniqueFileNames(
      convos.map((c) => safeFileName(c.title)),
      '.md',
    );
    let skippedAttachments = 0;
    async function* files() {
      for (const [i, c] of convos.entries()) {
        const path = activePath(c, auth);
        skippedAttachments += attachmentsIn(path);
        yield [names[i] as string, strToU8(conversationToMarkdown(c, path))] as const;
      }
    }
    const data = await zipFiles(files(), pace);
    return {
      filename: `neotext-chats-${stamp(clock.now())}.zip`,
      contentType: 'application/zip',
      data,
      skippedAttachments,
    };
  }

  return {
    async exportData(auth, body) {
      let file: ExportFile;
      switch (body.format) {
        case 'neotext': {
          if (!body.passphrase) {
            throw new AppError('bad_request', 'A NeoText export needs a passphrase.', 400);
          }
          const withKeys = body.includeProviderKeys === true;
          const { json, skippedAttachments } = await bundleJson(auth, withKeys, 0, maxBundleBytes);
          file = {
            filename: `neotext-export-${stamp(clock.now())}.ntxb`,
            contentType: 'application/octet-stream',
            data: await sealBundleJson(json, body.passphrase),
            skippedAttachments,
          };
          break;
        }
        case 'json':
          if (body.confirmPlaintext !== true) {
            throw new AppError(
              'bad_request',
              'Confirm that a plain JSON export is not encrypted.',
              400,
            );
          }
          {
            // Plain JSON never carries provider keys; NeoText does not import it, so no cap.
            const { json, skippedAttachments } = await bundleJson(auth, false, 2, Infinity);
            file = {
              filename: `neotext-export-${stamp(clock.now())}.json`,
              contentType: 'application/json; charset=utf-8',
              data: json,
              skippedAttachments,
            };
          }
          break;
        case 'markdown':
          file = await markdown(auth, body.conversationId);
          break;
      }
      audit.record('data.exported', auth.userId, { format: body.format });
      return file;
    },
  };
}

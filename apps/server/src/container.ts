import fs from 'node:fs';
import path from 'node:path';
import { type AdminService, createAdminService } from './admin/service';
import { createAttachmentsRepo } from './attachments/repo';
import { type AttachmentsService, createAttachmentsService } from './attachments/service';
import { createAttachmentStore } from './attachments/store';
import type { AuditLog } from './audit/audit';
import { createAuditLog } from './audit/audit';
import { createInvitesRepo, type InvitesRepo } from './auth/invites';
import type { AuthService } from './auth/service';
import { createAuthService } from './auth/service';
import type { SessionStore } from './auth/sessions';
import { createSessionStore } from './auth/sessions';
import type { UsersRepo } from './auth/users-repo';
import { createUsersRepo } from './auth/users-repo';
import { type ChatService, createChatService } from './chat/chat-service';
import { type ConversationsRepo, createConversationsRepo } from './chat/conversations-repo';
import {
  type ConversationsService,
  createConversationsService,
} from './chat/conversations-service';
import { createFoldersRepo, type FoldersRepo } from './chat/folders-repo';
import { createGenerationManager, type GenerationManager } from './chat/generation/manager';
import { createMessagesRepo, type MessagesRepo } from './chat/messages-repo';
import type { AppConfig } from './config/env';
import { loadOrCreateInstanceKey } from './crypto/instance-key';
import { startBackupSchedule } from './db/backup';
import { type DbHandle, openDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { createFaviconService, type FaviconService } from './favicon/service';
import { createRateLimiter, type RateLimiter } from './http/rate-limit';
import { createInstanceMetaRepo, type InstanceMetaRepo } from './instance/meta';
import { startPurgeJob } from './jobs/purge-trash';
import { type Clock, systemClock } from './lib/clock';
import { createLogger, type Logger } from './lib/logger';
import { createMcpManager, type McpManager } from './mcp/manager';
import { createMcpRepo } from './mcp/repo';
import { createHttpClient, type HttpClient } from './net/http-client';
import { createPresetsRepo } from './presets/repo';
import { createPresetsService, type PresetsService } from './presets/service';
import { createProviderService, type ProviderService } from './providers/service';
import { createQuotaService, type QuotaService } from './quotas/service';
import { type ConversationSearch, createConversationSearch } from './search-conversations/service';
import { createSettingsRepo } from './settings/repo';
import { createSettingsService, type SettingsService } from './settings/service';
import { fetchUrlSource } from './tools/builtin/fetch-url';
import { createWebSearchSource } from './tools/builtin/web-search';
import { createToolCatalog, type ToolCatalog } from './tools/registry';
import { createExportService, type ExportService } from './transfer/export-service';
import { createImportService, type ImportService } from './transfer/import-service';
import { createUsageRepo, type UsageRepo } from './usage/repo';

export interface Container {
  config: AppConfig;
  log: Logger;
  clock: Clock;
  db: DbHandle;
  instanceKey: Buffer;
  instance: InstanceMetaRepo;
  audit: AuditLog;
  users: UsersRepo;
  /** Sign-up invites; only the hash of a code is stored. */
  invites: InvitesRepo;
  sessions: SessionStore;
  auth: AuthService;
  /** User roles and status, password resets and instance policy. */
  admin: AdminService;
  settings: SettingsService;
  providers: ProviderService;
  /** Admin limits on spend through shared providers. */
  quotas: QuotaService;
  repos: {
    conversations: ConversationsRepo;
    messages: MessagesRepo;
    folders: FoldersRepo;
    usage: UsageRepo;
  };
  conversations: ConversationsService;
  /** Full-text search over the user's own chats. */
  search: ConversationSearch;
  presets: PresetsService;
  /** Downloads of the user's own data. */
  exporter: ExportService;
  /** Uploaded files, sealed on disk; cleaned up with their chats. */
  attachments: AttachmentsService;
  importer: ImportService;
  generations: GenerationManager;
  chat: ChatService;
  /** Where turns get their app and MCP tools; later tasks add sources. */
  tools: ToolCatalog;
  favicon: FaviconService;
  /** User-configured MCP servers; their tools reach turns through `tools`. */
  mcp: McpManager;
  limiters: {
    login: RateLimiter;
    loginUser: RateLimiter;
    sensitive: RateLimiter;
    api: RateLimiter;
    chat: RateLimiter;
    /** Per user, below the general API limit: each of these is costly to serve. */
    search: RateLimiter;
    export: RateLimiter;
    import: RateLimiter;
    upload: RateLimiter;
  };
  http: { endpoints: HttpClient; endpointsPrivate: HttpClient; tools: HttpClient };
  close(): Promise<void>;
}

export async function createContainer(
  config: AppConfig,
  opts: { clock?: Clock; log?: Logger } = {},
): Promise<Container> {
  const log = opts.log ?? createLogger(config);
  const clock = opts.clock ?? systemClock;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const instanceKey = await loadOrCreateInstanceKey(config.dataDir, config.instanceKeyB64);
  const backupDir = path.join(config.dataDir, 'backups');
  const db = openDatabase(path.join(config.dataDir, 'neotext.db'));
  try {
    const migrated = await runMigrations(db, {
      backupDir,
      clock,
      keepPreMigration: config.backup.keepPreMigration,
    });
    if (migrated.applied > 0) {
      log.info({ applied: migrated.applied, backup: migrated.backupFile }, 'database migrated');
    }
  } catch (err) {
    db.close();
    throw err;
  }
  const instance = createInstanceMetaRepo(db, clock);
  const audit = createAuditLog(db, clock);
  const users = createUsersRepo(db, clock);
  const invites = createInvitesRepo(db);
  const sessions = createSessionStore(db, clock);
  const auth = createAuthService({
    db,
    users,
    sessions,
    instance,
    audit,
    config,
    clock,
    instanceKey,
  });
  const settings = createSettingsService({
    repo: createSettingsRepo(db),
    clock,
    audit,
    log,
  });
  const limiter = (max: number) => createRateLimiter({ windowMs: 60_000, max, clock });
  const limiters = {
    login: limiter(10),
    loginUser: limiter(5),
    sensitive: limiter(5),
    api: limiter(300),
    chat: limiter(30),
    search: limiter(60),
    export: limiter(5),
    import: limiter(5),
    upload: limiter(60),
  };
  const http = {
    endpoints: createHttpClient({ allowPrivate: false }),
    endpointsPrivate: createHttpClient({ allowPrivate: true }),
    tools: createHttpClient({ allowPrivate: false }),
  };
  const providers = createProviderService({
    db,
    clock,
    log,
    config,
    instanceKey,
    http,
  });
  const quotas = createQuotaService({ db, instance, clock });
  const repos = {
    conversations: createConversationsRepo(db),
    messages: createMessagesRepo(db),
    folders: createFoldersRepo(db),
    usage: createUsageRepo(db, quotas.recordSpend),
  };
  const interrupted = repos.messages.markInterrupted(clock.now());
  if (interrupted > 0) log.warn({ interrupted }, 'marked unfinished answers as interrupted');
  const generations = createGenerationManager({ clock, log });
  const admin = createAdminService({
    db,
    users,
    sessions,
    instance,
    generations,
    audit,
    config,
    clock,
    instanceKey,
  });
  const attachments = createAttachmentsService({
    repo: createAttachmentsRepo(db),
    store: createAttachmentStore(config.dataDir),
    clock,
    log,
    quotaBytes: config.attachmentQuotaBytes,
  });
  // One hook for manual deletes and the scheduled purge. Must not throw: the manual path
  // does not catch, and `purgeForConversations` logs its own failures.
  const onPurged = (ids: string[]): void => attachments.purgeForConversations(ids);
  const conversations = createConversationsService({
    db,
    conversations: repos.conversations,
    messages: repos.messages,
    folders: repos.folders,
    attachments,
    clock,
    onPurged,
  });
  const search = createConversationSearch({
    conversations: repos.conversations,
    messages: repos.messages,
  });
  const presets = createPresetsService({ repo: createPresetsRepo(db, log), clock });
  const exporter = createExportService({
    conversations: repos.conversations,
    messages: repos.messages,
    folders: repos.folders,
    presets,
    settings,
    providers,
    audit,
    clock,
    appVersion: config.version,
  });
  const importer = createImportService({
    db,
    conversations: repos.conversations,
    messages: repos.messages,
    folders: repos.folders,
    presets,
    settings,
    providers,
    audit,
    clock,
    log,
  });
  const favicon = createFaviconService({ db, http: http.tools, clock });
  const schedule = startBackupSchedule(db, {
    dir: backupDir,
    intervalHours: config.backup.intervalHours,
    keepScheduled: config.backup.keepScheduled,
    keepPreMigration: config.backup.keepPreMigration,
    clock,
    log,
    // Expired icons stay out of the backup copies.
    beforeBackup: () => {
      favicon.prune();
    },
  });
  const purgeJob = startPurgeJob({
    conversations: repos.conversations,
    clock,
    log,
    onPurged,
    purgeOrphans: (olderThan) => attachments.purgeOrphans(olderThan),
  });
  const tools = createToolCatalog({ log });
  tools.add(fetchUrlSource);
  tools.add(createWebSearchSource({ settings, providers }));
  const mcp = createMcpManager({ repo: createMcpRepo(db, clock), http, clock, log });
  tools.add((auth) => mcp.toolsFor(auth));
  const chat = createChatService({
    db,
    settings,
    providers,
    quotas,
    conversations: repos.conversations,
    messages: repos.messages,
    usage: repos.usage,
    presets,
    attachments,
    generations,
    tools,
    toolsHttp: http.tools,
    limiter: limiters.chat,
    clock,
    log,
  });
  return {
    config,
    log,
    clock,
    db,
    instanceKey,
    instance,
    audit,
    users,
    invites,
    sessions,
    auth,
    admin,
    settings,
    providers,
    quotas,
    repos,
    conversations,
    search,
    presets,
    exporter,
    attachments,
    importer,
    generations,
    chat,
    tools,
    favicon,
    mcp,
    limiters,
    http,
    close: async () => {
      schedule.stop();
      purgeJob.stop();
      try {
        await generations.shutdown();
      } finally {
        await mcp.closeAll();
        const closed = await Promise.allSettled(Object.values(http).map((c) => c.close()));
        for (const r of closed) {
          if (r.status === 'rejected') log.error({ err: r.reason }, 'http client close failed');
        }
        db.close();
      }
    },
  };
}

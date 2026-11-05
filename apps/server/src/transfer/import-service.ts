import type { ImportResult, ImportSource } from '@neotext/shared';
import type { AuditLog } from '../audit/audit';
import type { ConversationsRepo } from '../chat/conversations-repo';
import type { FoldersRepo } from '../chat/folders-repo';
import type { MessagesRepo } from '../chat/messages-repo';
import type { DbHandle } from '../db/client';
import type { AuthContext } from '../http/env';
import type { Clock } from '../lib/clock';
import type { Logger } from '../lib/logger';
import type { PresetsService } from '../presets/service';
import type { ProviderService } from '../providers/service';
import type { SettingsService } from '../settings/service';
import { importBundle } from './import-neotext';
import { planFromExport } from './import-plan';
import { writeAll } from './import-write';
import { readChatGPT } from './parsers/chatgpt';
import { readClaude } from './parsers/claude';
import type { ParsedItem } from './parsers/types';
import { parseUpload } from './upload';

export { parseUpload };

export interface ImportInput {
  source: ImportSource;
  file: Buffer;
  passphrase?: string;
  restoreSettings?: boolean;
}

export interface ImportService {
  importData(auth: AuthContext, input: ImportInput): Promise<ImportResult>;
}

export interface ImportServiceDeps {
  db: DbHandle;
  conversations: ConversationsRepo;
  messages: MessagesRepo;
  folders: FoldersRepo;
  presets: PresetsService;
  settings: SettingsService;
  providers: ProviderService;
  audit: AuditLog;
  clock: Clock;
  log: Logger;
}

export function createImportService(deps: ImportServiceDeps): ImportService {
  const { audit } = deps;

  return {
    async importData(auth, input) {
      const result: ImportResult = { imported: 0, skipped: 0, failed: [] };
      let error = false;
      try {
        if (input.source === 'neotext') {
          await importBundle(deps, auth, input, result);
        } else {
          const source = input.source;
          const data = await parseUpload(source, input.file);
          const items: ParsedItem[] = source === 'chatgpt' ? readChatGPT(data) : readClaude(data);
          await writeAll(
            deps,
            auth,
            items.map((i) =>
              i.ok ? { ok: true as const, plan: planFromExport(source, i.conversation) } : i,
            ),
            result,
          );
        }
        return result;
      } catch (err) {
        error = true;
        throw err;
      } finally {
        // Recorded even when the import stopped partway, so writes never go unaudited.
        audit.record('data.imported', auth.userId, {
          source: input.source,
          imported: result.imported,
          skipped: result.skipped,
          failed: result.failed.length,
          error,
        });
      }
    },
  };
}

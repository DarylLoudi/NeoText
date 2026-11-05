import { type Folder, type ImportFailure, type ImportResult, newId } from '@neotext/shared';
import { MAX_FOLDER_DEPTH } from '../chat/conversations-service';
import type { FoldersRepo } from '../chat/folders-repo';
import type { AuthContext } from '../http/env';
import { AppError } from '../http/errors';
import type { PresetsService } from '../presets/service';
import { OPENROUTER_BASE_URL } from '../providers/openrouter/adapter';
import type { ProviderService } from '../providers/service';
import { BRAVE_BASE_URL, TAVILY_BASE_URL } from '../search/backends/urls';
import type { SettingsService } from '../settings/service';
import { openBundle } from './bundle';
import { planFromBundle } from './import-plan';
import type { ImportInput } from './import-service';
import { type ImportWriteDeps, toFailure, writeAll } from './import-write';
import { type NeoTextImport, readNeoText } from './parsers/neotext';

export interface ImportNeoTextDeps extends ImportWriteDeps {
  folders: FoldersRepo;
  presets: PresetsService;
  settings: SettingsService;
  providers: ProviderService;
}

/** Settings larger than a normal settings request are not something the app wrote. */
const MAX_SETTINGS_BYTES = 1024 * 1024;

const DEFAULT_BASE_URLS: Record<string, string> = {
  openrouter: OPENROUTER_BASE_URL,
  brave: BRAVE_BASE_URL,
  tavily: TAVILY_BASE_URL,
};

/** Folders with new ids, parents first; a folder already there by name and parent is reused. */
function importFolders(
  deps: ImportNeoTextDeps,
  auth: AuthContext,
  rows: Folder[],
): Map<string, string> {
  const map = new Map<string, string>();
  const known = new Set(rows.map((f) => f.id));
  const existing = deps.folders.list(auth.userId, auth.dek);
  const depthOf = new Map<string, number>();
  const pending = rows.map((f) => ({
    ...f,
    parentId:
      f.parentId !== null && known.has(f.parentId) && f.parentId !== f.id ? f.parentId : null,
  }));
  while (pending.length > 0) {
    let i = pending.findIndex((f) => f.parentId === null || map.has(f.parentId));
    // Whatever is left is a parent cycle; break it by making the first one a root.
    if (i < 0) {
      i = 0;
      (pending[0] as Folder).parentId = null;
    }
    const [f] = pending.splice(i, 1) as [Folder];
    let parentId = f.parentId === null ? null : (map.get(f.parentId) ?? null);
    // Too deep for the app's folder rules: hang it at the deepest allowed level instead.
    while (parentId !== null && (depthOf.get(parentId) ?? 1) + 1 > MAX_FOLDER_DEPTH) {
      parentId = existing.find((e) => e.id === parentId)?.parentId ?? null;
    }
    const same = existing.find((e) => e.name === f.name && e.parentId === parentId);
    if (same) {
      map.set(f.id, same.id);
      depthOf.set(same.id, parentId === null ? 1 : (depthOf.get(parentId) ?? 1) + 1);
      continue;
    }
    const id = newId('fld');
    const row = { ...f, id, parentId };
    deps.folders.insert({ ...row, userId: auth.userId }, auth.dek);
    existing.push(row);
    map.set(f.id, id);
    depthOf.set(id, parentId === null ? 1 : (depthOf.get(parentId) ?? 1) + 1);
  }
  return map;
}

/** Presets with new ids; one already there with the same name and data is reused. */
function importPresets(
  deps: ImportNeoTextDeps,
  auth: AuthContext,
  rows: NeoTextImport['presets'],
): Map<string, string> {
  const map = new Map<string, string>();
  const existing = deps.presets.list(auth);
  for (const p of rows) {
    const same = existing.find(
      (e) => e.name === p.name && JSON.stringify(e.data) === JSON.stringify(p.data),
    );
    const created =
      same ?? deps.presets.create(auth, { name: p.name, data: p.data, position: p.position });
    if (!same) existing.push(created);
    map.set(p.id, created.id);
  }
  return map;
}

/** Each provider goes through the providers service, which checks the endpoint address. */
async function importProviders(
  deps: ImportNeoTextDeps,
  auth: AuthContext,
  rows: NeoTextImport['providers'],
  failed: ImportFailure[],
): Promise<void> {
  const own = deps.providers.list(auth).filter((p) => !p.shared);
  for (const row of rows) {
    if (!row.ok) {
      failed.push(toFailure(row));
      continue;
    }
    const body = { ...row.body };
    if (body.baseUrl !== undefined && DEFAULT_BASE_URLS[body.kind] === body.baseUrl) {
      delete body.baseUrl;
    }
    const baseUrl = body.baseUrl ?? DEFAULT_BASE_URLS[body.kind];
    if (
      own.some((p) => p.kind === body.kind && p.name === body.name.trim() && p.baseUrl === baseUrl)
    ) {
      continue;
    }
    try {
      own.push(await deps.providers.create(auth, body));
    } catch (err) {
      // The service words endpoint refusals itself; that text is the reason shown.
      failed.push({
        title: row.name,
        code: 'provider_rejected',
        reason: err instanceof AppError ? err.message : 'This provider could not be saved.',
      });
    }
  }
}

export async function importBundle(
  deps: ImportNeoTextDeps,
  auth: AuthContext,
  input: ImportInput,
  result: ImportResult,
) {
  if (!input.passphrase) {
    throw new AppError(
      'bad_request',
      'Enter the passphrase this NeoText file was made with.',
      400,
      { reason: 'passphrase_required' },
    );
  }
  const bundle = readNeoText(await openBundle(input.file, input.passphrase));
  for (const f of bundle.failed) result.failed.push(toFailure(f));
  if (input.restoreSettings) {
    const size = Buffer.byteLength(JSON.stringify(bundle.settings ?? null) ?? '', 'utf8');
    if (
      typeof bundle.settings !== 'object' ||
      bundle.settings === null ||
      size > MAX_SETTINGS_BYTES
    ) {
      result.failed.push({
        title: null,
        code: 'invalid_settings',
        reason: 'The settings in this file are not valid, so they were not restored.',
      });
    } else {
      deps.settings.replace(auth.userId, auth.dek, bundle.settings, bundle.settingsSchemaVersion);
    }
  }
  const folderIds = importFolders(deps, auth, bundle.folders);
  const presetIds = importPresets(deps, auth, bundle.presets);
  await importProviders(deps, auth, bundle.providers, result.failed);
  await writeAll(
    deps,
    auth,
    bundle.conversations.map((c) =>
      c.ok
        ? {
            ok: true as const,
            plan: {
              ...planFromBundle(c.conversation, c.messages, folderIds, presetIds),
              attachmentNotes: c.attachmentNotes,
            },
          }
        : c,
    ),
    result,
  );
}

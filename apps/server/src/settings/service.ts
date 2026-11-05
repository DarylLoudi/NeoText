import {
  applyMergePatch,
  isJsonObject,
  type JsonObject,
  migrateSettings,
  parseSettings,
  SETTINGS_SCHEMA_VERSION,
  type SettingsHistoryItem,
  type SettingsMigration,
  type SettingsResponse,
} from '@neotext/shared';
import type { AuditLog } from '../audit/audit';
import { aad } from '../crypto/aad';
import { openJson, sealJson } from '../crypto/aead';
import { AppError } from '../http/errors';
import type { Clock } from '../lib/clock';
import type { Logger } from '../lib/logger';
import type { SettingsRepo, SettingsRow } from './repo';

export const HISTORY_KEEP = 50;
export const HISTORY_COALESCE_MS = 300_000;

export interface SettingsService {
  get(userId: string, dek: Buffer): SettingsResponse;
  patch(userId: string, dek: Buffer, patch: Record<string, unknown>): SettingsResponse;
  history(userId: string): SettingsHistoryItem[];
  restore(userId: string, dek: Buffer, version: number): SettingsResponse;
  /**
   * Replaces the settings with ones from an import, written at `fromVersion` of the schema:
   * migrated the same way stored settings are, then validated. The settings replaced are kept
   * as a `restore` snapshot, so the import can be undone from the history.
   */
  replace(userId: string, dek: Buffer, raw: unknown, fromVersion: number): SettingsResponse;
}

export interface SettingsServiceDeps {
  repo: SettingsRepo;
  clock: Clock;
  audit: AuditLog;
  log: Logger;
  /** Test seams: override the migration table and target schema version. */
  migrations?: Record<number, SettingsMigration>;
  targetVersion?: number;
}

/** A stored schema_version that is not an integer >= 1 is treated as version 1. */
const normalizeSchemaVersion = (v: unknown): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : 1;

export function createSettingsService(deps: SettingsServiceDeps): SettingsService {
  const { repo, clock, audit, log } = deps;
  const target = deps.targetVersion ?? SETTINGS_SCHEMA_VERSION;
  const migrate = (raw: unknown, from: number) =>
    deps.migrations
      ? migrateSettings(raw, from, deps.migrations, target)
      : migrateSettings(raw, from, undefined, target);
  const rowAad = (userId: string) => aad('user_settings', 'data', userId);

  /** The stored raw object (unknown keys kept), or null when it cannot be opened or is not an object. */
  function openRaw(userId: string, dek: Buffer, row: SettingsRow): JsonObject | null {
    try {
      const value = openJson<unknown>(dek, row.data, rowAad(userId));
      return isJsonObject(value) ? value : null;
    } catch {
      return null;
    }
  }

  /** Copies the untouched blob to history once per version. Call inside a transaction. */
  function quarantine(userId: string, row: SettingsRow): void {
    const last = repo.lastHistory(userId);
    if (last && last.reason === 'quarantine' && last.version === row.version) return;
    repo.insertHistory({
      userId,
      version: row.version,
      schemaVersion: row.schemaVersion,
      data: row.data,
      reason: 'quarantine',
      createdAt: clock.now(),
    });
    repo.pruneHistory(userId, HISTORY_KEEP);
    audit.record('settings.quarantined', userId, { version: row.version });
    log.warn({ userId, version: row.version }, 'settings could not be read and were quarantined');
  }

  const shape = (version: number, raw: unknown, recovered: boolean): SettingsResponse => {
    const { settings, resetPaths } = parseSettings(raw);
    return { version, settings, resetPaths, recovered };
  };

  return {
    get(userId, dek) {
      return repo.transaction(() => {
        const row = repo.get(userId);
        if (!row) return shape(0, {}, false);
        const raw = openRaw(userId, dek, row);
        if (raw === null) {
          quarantine(userId, row);
          return shape(row.version, {}, true);
        }
        const migrated = migrate(raw, normalizeSchemaVersion(row.schemaVersion));
        return shape(row.version, migrated.data, false);
      });
    },

    patch(userId, dek, patch) {
      return repo.transaction(() => {
        const now = clock.now();
        const row = repo.get(userId);
        let base: unknown = {};
        let schemaVersion = target;
        let migrating = false;
        let corrupt = false;
        if (row) {
          const raw = openRaw(userId, dek, row);
          if (raw === null) {
            corrupt = true;
            quarantine(userId, row);
          } else {
            const stored = normalizeSchemaVersion(row.schemaVersion);
            base = migrate(raw, stored).data;
            schemaVersion = Math.max(stored, target);
            migrating = stored < target;
          }
        }
        // The merged RAW object is stored; parseSettings only shapes the response.
        const merged = applyMergePatch(base, patch);
        if (row && !corrupt) {
          const last = repo.lastHistory(userId);
          // A migration always snapshots the untouched previous blob (spec 8.3); autosaves coalesce.
          if (migrating || !last || now - last.createdAt > HISTORY_COALESCE_MS) {
            repo.insertHistory({
              userId,
              version: row.version,
              schemaVersion: row.schemaVersion,
              data: row.data,
              reason: migrating ? 'migration' : 'autosave',
              createdAt: now,
            });
          }
        }
        const version = (row?.version ?? 0) + 1;
        repo.upsert({
          userId,
          version,
          schemaVersion,
          data: sealJson(dek, merged, rowAad(userId)),
          updatedAt: now,
        });
        repo.pruneHistory(userId, HISTORY_KEEP);
        return shape(version, merged, false);
      });
    },

    history: (userId) => repo.listHistory(userId, HISTORY_KEEP),

    restore(userId, dek, version) {
      return repo.transaction(() => {
        const snap = repo.getHistory(userId, version);
        if (!snap) throw new AppError('not_found', 'That settings version no longer exists.', 404);
        const raw = openRaw(userId, dek, {
          userId,
          version,
          schemaVersion: snap.schemaVersion,
          data: snap.data,
          updatedAt: 0,
        });
        if (raw === null) {
          throw new AppError(
            'conflict',
            'That settings version cannot be read, so it was not restored. Pick another version.',
            409,
          );
        }
        const now = clock.now();
        const row = repo.get(userId);
        if (row) {
          if (openRaw(userId, dek, row) === null) {
            quarantine(userId, row);
          } else {
            repo.insertHistory({
              userId,
              version: row.version,
              schemaVersion: row.schemaVersion,
              data: row.data,
              reason: 'restore',
              createdAt: now,
            });
          }
        }
        const newVersion = (row?.version ?? 0) + 1;
        repo.upsert({
          userId,
          version: newVersion,
          schemaVersion: snap.schemaVersion,
          data: snap.data,
          updatedAt: now,
        });
        repo.pruneHistory(userId, HISTORY_KEEP);
        audit.record('settings.restored', userId, { from: version, to: newVersion });
        const migrated = migrate(raw, normalizeSchemaVersion(snap.schemaVersion));
        return shape(newVersion, migrated.data, false);
      });
    },

    replace(userId, dek, raw, fromVersion) {
      // Older settings are upgraded first, so they are not reset by today's schema; then only
      // what passes the schema is stored and invalid values fall back to their defaults.
      const { settings } = parseSettings(migrate(raw, normalizeSchemaVersion(fromVersion)).data);
      return repo.transaction(() => {
        const now = clock.now();
        const row = repo.get(userId);
        if (row) {
          if (openRaw(userId, dek, row) === null) {
            quarantine(userId, row);
          } else {
            repo.insertHistory({
              userId,
              version: row.version,
              schemaVersion: row.schemaVersion,
              data: row.data,
              reason: 'restore',
              createdAt: now,
            });
          }
        }
        const version = (row?.version ?? 0) + 1;
        repo.upsert({
          userId,
          version,
          schemaVersion: target,
          data: sealJson(dek, settings, rowAad(userId)),
          updatedAt: now,
        });
        repo.pruneHistory(userId, HISTORY_KEEP);
        audit.record('settings.restored', userId, { from: 'import', to: version });
        return shape(version, settings, false);
      });
    },
  };
}

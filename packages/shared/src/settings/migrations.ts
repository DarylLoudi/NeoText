import { isJsonObject, type JsonObject } from './merge-patch';
import { SETTINGS_SCHEMA_VERSION } from './schema';

export type { JsonObject };

/** Pure function upgrading stored settings from version N to N + 1. */
export type SettingsMigration = (raw: JsonObject) => JsonObject;

/** Keyed by the version being migrated FROM. Empty: version 1 is the first release. */
export const SETTINGS_MIGRATIONS: Record<number, SettingsMigration> = {};

export function migrateSettings(
  raw: unknown,
  fromVersion: number,
  migrations: Record<number, SettingsMigration> = SETTINGS_MIGRATIONS,
  target: number = SETTINGS_SCHEMA_VERSION,
): { data: unknown; version: number; migrated: boolean } {
  // A newer stored version (or unmigratable data) is never touched or migrated down.
  if (fromVersion >= target || !isJsonObject(raw)) {
    return { data: raw, version: fromVersion, migrated: false };
  }
  let data: JsonObject = raw;
  for (let v = fromVersion; v < target; v++) {
    const step = migrations[v];
    if (step) data = step(data);
  }
  return { data, version: target, migrated: true };
}

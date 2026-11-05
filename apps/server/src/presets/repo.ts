import { type Preset, type PresetData, PresetDataSchema } from '@neotext/shared';
import { and, asc, eq } from 'drizzle-orm';
import { aad } from '../crypto/aad';
import { openJson, openText, sealJson, sealText } from '../crypto/aead';
import type { DbHandle } from '../db/client';
import { presets } from '../db/schema';
import type { Logger } from '../lib/logger';

/** Every method is scoped to one user: other users' rows look like they do not exist. */
export interface PresetsRepo {
  list(userId: string, dek: Buffer): Preset[];
  get(userId: string, id: string, dek: Buffer): Preset | null;
  insert(row: Preset & { userId: string }, dek: Buffer): void;
  update(
    userId: string,
    id: string,
    patch: { name?: string; data?: PresetData; position?: string },
    at: number,
    dek: Buffer,
  ): void;
  remove(userId: string, id: string): boolean;
}

type Row = typeof presets.$inferSelect;

/** The preset, or null when its name or data cannot be opened or no longer fits the schema. */
function toPreset(row: Row, dek: Buffer): Preset | null {
  try {
    const data = PresetDataSchema.safeParse(
      openJson<unknown>(dek, row.data, aad('presets', 'data', row.id)),
    );
    if (!data.success) return null;
    return {
      id: row.id,
      name: openText(dek, row.name, aad('presets', 'name', row.id)),
      data: data.data,
      position: row.position,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  } catch {
    return null;
  }
}

export function createPresetsRepo(db: DbHandle, log?: Logger): PresetsRepo {
  const { orm } = db;
  /** Opens a row; a broken one is skipped and logged by id only. */
  const open = (row: Row, dek: Buffer): Preset | null => {
    const preset = toPreset(row, dek);
    if (!preset) log?.warn({ presetId: row.id }, 'preset could not be read and was skipped');
    return preset;
  };
  const owned = (userId: string, id: string) => and(eq(presets.userId, userId), eq(presets.id, id));
  return {
    list: (userId, dek) =>
      orm
        .select()
        .from(presets)
        .where(eq(presets.userId, userId))
        .orderBy(asc(presets.position), asc(presets.id))
        .all()
        .flatMap((r) => open(r, dek) ?? []),
    get: (userId, id, dek) => {
      const row = orm.select().from(presets).where(owned(userId, id)).get();
      return row ? open(row, dek) : null;
    },
    insert: (row, dek) => {
      orm
        .insert(presets)
        .values({
          id: row.id,
          userId: row.userId,
          name: sealText(dek, row.name, aad('presets', 'name', row.id)),
          data: sealJson(dek, row.data, aad('presets', 'data', row.id)),
          position: row.position,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })
        .run();
    },
    update: (userId, id, patch, at, dek) => {
      const set: Partial<typeof presets.$inferInsert> = { updatedAt: at };
      if (patch.name !== undefined) {
        set.name = sealText(dek, patch.name, aad('presets', 'name', id));
      }
      if (patch.data !== undefined) {
        set.data = sealJson(dek, patch.data, aad('presets', 'data', id));
      }
      if (patch.position !== undefined) set.position = patch.position;
      orm.update(presets).set(set).where(owned(userId, id)).run();
    },
    remove: (userId, id) => orm.delete(presets).where(owned(userId, id)).run().changes > 0,
  };
}

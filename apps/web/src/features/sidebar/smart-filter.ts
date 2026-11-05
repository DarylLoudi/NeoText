import type { ListQuery, SmartFilter } from '@neotext/shared';
import { useMemo } from 'react';

/** A filter with any of its fields left out (the schema type lists every key). */
export type SmartFilterInput = Partial<SmartFilter>;

const DAY_MS = 86_400_000;

/**
 * The list request for a smart section. The server filters on one model and one folder, so only
 * the first entry of `modelIds` and `folderIds` is used (the editor offers one of each). Every
 * field has a server parameter, so nothing is filtered in the browser.
 */
export function smartFilterToQuery(filter: SmartFilterInput, now: number): Partial<ListQuery> {
  const folderId = filter.folderIds?.[0];
  const modelId = filter.modelIds?.[0];
  const title = filter.titleContains?.trim();
  const query: Partial<ListQuery> = folderId ? { scope: 'folder', folderId } : { scope: 'all' };
  if (modelId) query.modelId = modelId;
  if (title) query.titleContains = title;
  if (filter.updatedWithinDays !== undefined && filter.updatedWithinDays > 0) {
    query.updatedSince = now - filter.updatedWithinDays * DAY_MS;
  }
  return query;
}

const HOUR_MS = 3_600_000;

/**
 * The list query for a filter, stable between renders: "within N days" is counted from the
 * start of the current hour, so the query key (and its cache) does not change on every render.
 */
export function useSmartQuery(filter: SmartFilterInput | undefined): Partial<ListQuery> {
  const key = JSON.stringify(filter ?? {});
  const hour = Math.floor(Date.now() / HOUR_MS);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `filter`'s contents
  return useMemo(() => smartFilterToQuery(filter ?? {}, hour * HOUR_MS), [key, hour]);
}

import type {
  ConversationDetail,
  ConversationSummary,
  Folder,
  ListConversationsResponse,
  ListQuery,
  UpdateConversationBody,
  UpdateFolderBody,
} from '@neotext/shared';
import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { generateKeyBetween } from 'fractional-indexing';
import { useMemo } from 'react';
import { chatApi } from '../../lib/api/chat';
import { ApiError } from '../../lib/api/client';
import { conversationsApi } from '../../lib/api/conversations';
import { foldersApi } from '../../lib/api/folders';
import { translate } from '../../lib/i18n';
import { qk } from '../../lib/query';
import { toast } from '../../ui';

export const PAGE_SIZE = 50;

type Page = ListConversationsResponse;
type ListData = InfiniteData<Page, string | undefined>;
type ListQueryKey = ReturnType<typeof qk.conversations>;

/* ----------------------------------------------------------------------------------------------
 * Ordering keys (fractional-indexing). Old rows may carry a server default (a timestamp string);
 * those are not valid keys and always sort before letter-led keys, so they are skipped.
 * --------------------------------------------------------------------------------------------*/

function isKey(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    generateKeyBetween(value, null);
    return true;
  } catch {
    return false;
  }
}

/** A key after every valid key in `positions`. */
export function positionAfter(positions: (string | null | undefined)[]): string {
  const keys = positions.filter(isKey).sort();
  return generateKeyBetween(keys.at(-1) ?? null, null);
}

/** A key between two neighbours (either may be missing or not a valid key). */
export function positionBetween(before: string | null, after: string | null): string {
  const a = isKey(before) ? before : null;
  const b = isKey(after) ? after : null;
  if (a !== null && b !== null && a >= b) return positionAfter([a]);
  return generateKeyBetween(a, b);
}

/* ----------------------------------------------------------------------------------------------
 * Which list a chat belongs to, mirroring the server's scopes, so optimistic edits move rows.
 * --------------------------------------------------------------------------------------------*/

export function belongsTo(query: Partial<ListQuery>, c: ConversationSummary): boolean {
  const live = c.deletedAt === null;
  let inScope: boolean;
  switch (query.scope ?? 'recent') {
    case 'recent':
      inScope = live && !c.archived && !c.pinned && (query.includeFoldered === true || !c.folderId);
      break;
    case 'pinned':
      inScope = live && !c.archived && c.pinned;
      break;
    case 'archived':
      inScope = live && c.archived;
      break;
    case 'folder':
      inScope = live && c.folderId === (query.folderId ?? '');
      break;
    case 'trash':
      inScope = !live;
      break;
    default:
      inScope = live;
  }
  if (!inScope) return false;
  if (query.modelId && c.modelRef?.modelId !== query.modelId) return false;
  if (query.updatedSince !== undefined && c.updatedAt < query.updatedSince) return false;
  const needle = query.titleContains?.toLowerCase();
  return !needle || (c.title ?? '').toLowerCase().includes(needle);
}

function before(query: Partial<ListQuery>, a: ConversationSummary, b: ConversationSummary) {
  if (query.scope === 'pinned') {
    const pa = a.pinPosition ?? '';
    const pb = b.pinPosition ?? '';
    return pa === pb ? a.id < b.id : pa < pb;
  }
  return a.lastActivityAt === b.lastActivityAt ? a.id > b.id : a.lastActivityAt > b.lastActivityAt;
}

/** Puts `c` where the server would list it; past the loaded end of a longer list it is left out. */
function insertSorted(query: Partial<ListQuery>, data: ListData, c: ConversationSummary): ListData {
  const pages = data.pages.map((p) => ({ ...p, items: [...p.items] }));
  for (const page of pages) {
    const at = page.items.findIndex((x) => before(query, c, x));
    if (at >= 0) {
      page.items.splice(at, 0, c);
      return { ...data, pages };
    }
  }
  const last = pages.at(-1);
  if (last && last.nextCursor === null) last.items.push(c);
  return { ...data, pages };
}

function isListData(value: unknown): value is ListData {
  return typeof value === 'object' && value !== null && Array.isArray((value as ListData).pages);
}

function updateLists(
  qc: QueryClient,
  fn: (query: Partial<ListQuery>, data: ListData) => ListData,
): void {
  for (const [key, data] of qc.getQueriesData<ListData>({ queryKey: ['conversations'] })) {
    if (!isListData(data)) continue;
    const query = ((key as ListQueryKey)[1] ?? {}) as Partial<ListQuery>;
    qc.setQueryData(key, fn(query, data));
  }
}

function without(data: ListData, id: string): ListData {
  return {
    ...data,
    pages: data.pages.map((p) => ({ ...p, items: p.items.filter((x) => x.id !== id) })),
  };
}

/** Writes the chat's new state into every cached list (moving it between lists) and its detail. */
export function upsertConversation(qc: QueryClient, c: ConversationSummary): void {
  updateLists(qc, (query, data) => {
    const rest = without(data, c.id);
    return belongsTo(query, c) ? insertSorted(query, rest, c) : rest;
  });
  qc.setQueryData<ConversationDetail>(qk.conversation(c.id), (d) =>
    d ? { ...d, conversation: c } : d,
  );
}

export function findConversation(qc: QueryClient, id: string): ConversationSummary | undefined {
  const detail = qc.getQueryData<ConversationDetail>(qk.conversation(id));
  if (detail) return detail.conversation;
  for (const [, data] of qc.getQueriesData<ListData>({ queryKey: ['conversations'] })) {
    if (!isListData(data)) continue;
    for (const page of data.pages) {
      const hit = page.items.find((x) => x.id === id);
      if (hit) return hit;
    }
  }
  return undefined;
}

type Snapshot = [readonly unknown[], unknown][];

async function snapshot(qc: QueryClient, id: string): Promise<Snapshot> {
  await qc.cancelQueries({ queryKey: ['conversations'] });
  await qc.cancelQueries({ queryKey: qk.conversation(id) });
  return [
    ...qc.getQueriesData({ queryKey: ['conversations'] }),
    [qk.conversation(id), qc.getQueryData(qk.conversation(id))],
  ];
}

function rollback(qc: QueryClient, snap: Snapshot): void {
  for (const [key, data] of snap) qc.setQueryData(key, data);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.code === 'network' ? translate('common.offline') : err.message;
  }
  return translate('common.genericError');
}

/* ----------------------------------------------------------------------------------------------
 * Hooks
 * --------------------------------------------------------------------------------------------*/

function listOptions(query: Partial<ListQuery>) {
  return infiniteQueryOptions({
    queryKey: qk.conversations(query),
    queryFn: ({ pageParam }) =>
      conversationsApi.list({
        ...query,
        limit: PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: Page) => last.nextCursor ?? undefined,
  });
}

export const PINNED_QUERY: Partial<ListQuery> = { scope: 'pinned' };

/** A pin position after the last pinned chat (loads the pinned list if it is not cached). */
export async function nextPinPosition(qc: QueryClient): Promise<string> {
  const data = await qc.ensureInfiniteQueryData(listOptions(PINNED_QUERY));
  return positionAfter(data.pages.flatMap((p) => p.items.map((c) => c.pinPosition)));
}

export function useConversationList(query: Partial<ListQuery>, opts: { enabled?: boolean } = {}) {
  const result = useInfiniteQuery({ ...listOptions(query), enabled: opts.enabled ?? true });
  const items = useMemo(() => result.data?.pages.flatMap((p) => p.items) ?? [], [result.data]);
  return { ...result, items };
}

/** Ids of chats with a reply being written right now. */
export function useActiveConversationIds(): ReadonlySet<string> {
  const { data } = useQuery({
    queryKey: qk.active,
    queryFn: chatApi.active,
    refetchInterval: (q) => (q.state.data?.length ? 4000 : false),
  });
  return useMemo(() => new Set((data ?? []).map((g) => g.conversationId)), [data]);
}

export interface ConversationMutations {
  rename(id: string, title: string): Promise<void>;
  setPinned(id: string, pinned: boolean, pinPosition: string | null): Promise<void>;
  setArchived(id: string, archived: boolean): Promise<void>;
  moveToFolder(id: string, folderId: string | null): Promise<void>;
  /** Moves the chat to the trash at once and offers Undo. Resolves false when it failed. */
  remove(id: string): Promise<boolean>;
  restore(id: string): Promise<void>;
}

export function useConversationMutations(): ConversationMutations {
  const qc = useQueryClient();
  return useMemo(() => {
    const settle = () => qc.invalidateQueries({ queryKey: ['conversations'] });

    async function update(id: string, body: UpdateConversationBody): Promise<void> {
      const snap = await snapshot(qc, id);
      const known = findConversation(qc, id);
      if (known) {
        const next = { ...known, ...body };
        if (body.title !== undefined) next.titleSource = 'user';
        upsertConversation(qc, next);
      }
      try {
        upsertConversation(qc, await conversationsApi.update(id, body));
      } catch (err) {
        rollback(qc, snap);
        toast({ message: errorMessage(err), tone: 'danger' });
      } finally {
        void settle();
      }
    }

    async function restore(id: string): Promise<void> {
      try {
        upsertConversation(qc, await conversationsApi.restore(id));
      } catch (err) {
        toast({ message: errorMessage(err), tone: 'danger' });
      } finally {
        void settle();
      }
    }

    async function remove(id: string): Promise<boolean> {
      const snap = await snapshot(qc, id);
      updateLists(qc, (_q, data) => without(data, id));
      try {
        await conversationsApi.remove(id);
      } catch (err) {
        rollback(qc, snap);
        toast({ message: errorMessage(err), tone: 'danger' });
        return false;
      } finally {
        void settle();
      }
      qc.removeQueries({ queryKey: qk.conversation(id) });
      toast({
        message: translate('sidebar.movedToTrash'),
        action: { label: translate('sidebar.undo'), onClick: () => void restore(id) },
      });
      return true;
    }

    return {
      rename: (id, title) => update(id, { title }),
      setPinned: (id, pinned, pinPosition) => update(id, { pinned, pinPosition }),
      setArchived: (id, archived) => update(id, { archived }),
      moveToFolder: (id, folderId) => update(id, { folderId }),
      remove,
      restore,
    };
  }, [qc]);
}

/* ----------------------------------------------------------------------------------------------
 * Folders
 * --------------------------------------------------------------------------------------------*/

export function useFolders() {
  return useQuery({ queryKey: qk.folders, queryFn: foldersApi.list });
}

export interface FolderMutations {
  create(name: string, parentId: string | null): Promise<Folder | null>;
  update(id: string, patch: UpdateFolderBody): Promise<void>;
  /** Chats and subfolders inside move up one level (the server does the same). */
  remove(id: string): Promise<void>;
}

export function useFolderMutations(): FolderMutations {
  const qc = useQueryClient();
  return useMemo(() => {
    const current = () => qc.getQueryData<Folder[]>(qk.folders) ?? [];
    const settle = () => qc.invalidateQueries({ queryKey: qk.folders });

    async function optimistic(next: Folder[], run: () => Promise<unknown>): Promise<boolean> {
      await qc.cancelQueries({ queryKey: qk.folders });
      const before = qc.getQueryData<Folder[]>(qk.folders);
      qc.setQueryData(qk.folders, next);
      try {
        await run();
        return true;
      } catch (err) {
        qc.setQueryData(qk.folders, before);
        toast({ message: errorMessage(err), tone: 'danger' });
        return false;
      } finally {
        void settle();
      }
    }

    return {
      async create(name, parentId) {
        const siblings = current().filter((f) => f.parentId === parentId);
        try {
          const made = await foldersApi.create({
            name,
            parentId,
            position: positionAfter(siblings.map((f) => f.position)),
          });
          qc.setQueryData<Folder[]>(qk.folders, (list) => [...(list ?? []), made]);
          return made;
        } catch (err) {
          toast({ message: errorMessage(err), tone: 'danger' });
          return null;
        } finally {
          void settle();
        }
      },
      async update(id, patch) {
        const next = current().map((f) => (f.id === id ? { ...f, ...patch } : f));
        await optimistic(next, () => foldersApi.update(id, patch));
      },
      async remove(id) {
        const gone = current().find((f) => f.id === id);
        const parentId = gone?.parentId ?? null;
        const next = current()
          .filter((f) => f.id !== id)
          .map((f) => (f.parentId === id ? { ...f, parentId } : f));
        if (await optimistic(next, () => foldersApi.remove(id))) {
          void qc.invalidateQueries({ queryKey: ['conversations'] });
        }
      },
    };
  }, [qc]);
}

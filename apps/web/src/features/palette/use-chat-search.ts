import type { ConversationSummary } from '@neotext/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { conversationsApi } from '../../lib/api/conversations';
import { matchesQuery } from './commands';

/** Wait for a pause in typing before asking the server: each call scans up to 2,000 titles. */
export const SEARCH_DELAY_MS = 250;
/** One character matches most titles; start searching the server at two. */
export const MIN_SEARCH_LENGTH = 2;
const SERVER_LIMIT = 20;
const LOADED_SHOWN = 8;
const EMPTY_QUERY_SHOWN = 5;

export interface ChatSearch {
  /** Matches among the chats already loaded, newest first. */
  loaded: ConversationSummary[];
  /** Matches only the server's search found. */
  older: ConversationSummary[];
  /** Waiting to ask, or waiting for the answer. */
  searching: boolean;
  /** The server stopped at one page: more titles may match. */
  mayHaveMore: boolean;
}

function useDebounced(value: string, ms: number): string {
  const [settled, setSettled] = useState('');
  useEffect(() => {
    if (value === '') {
      setSettled('');
      return;
    }
    const handle = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(handle);
  }, [value, ms]);
  return settled;
}

/**
 * Chats whose title contains the query: first those already loaded in the sidebar's lists,
 * then one server search by title (scope "all": archived and foldered chats included) for the
 * rest. A failed search leaves the loaded matches in place.
 */
export function useChatSearch(query: string, cached: ConversationSummary[]): ChatSearch {
  const term = query.trim();
  const settled = useDebounced(term, SEARCH_DELAY_MS);
  const asking = settled.length >= MIN_SEARCH_LENGTH && settled === term;

  const server = useQuery({
    queryKey: ['conversation-search', settled],
    queryFn: () =>
      conversationsApi.list({ scope: 'all', titleContains: settled, limit: SERVER_LIMIT }),
    enabled: settled.length >= MIN_SEARCH_LENGTH,
    staleTime: 15_000,
    retry: false,
  });

  const loaded = useMemo(() => {
    const hits = cached.filter((c) => matchesQuery(term, c.title));
    return hits.slice(0, term === '' ? EMPTY_QUERY_SHOWN : LOADED_SHOWN);
  }, [cached, term]);

  const older = useMemo(() => {
    // An answer for an earlier word says nothing about this one.
    if (!asking || !server.data) return [];
    const shown = new Set(loaded.map((c) => c.id));
    return server.data.items.filter((c) => c.deletedAt === null && !shown.has(c.id));
  }, [asking, server.data, loaded]);

  const waiting = term.length >= MIN_SEARCH_LENGTH && (settled !== term || server.isFetching);
  return {
    loaded,
    older,
    searching: waiting,
    mayHaveMore: asking && (server.data?.nextCursor ?? null) !== null,
  };
}

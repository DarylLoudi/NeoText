import { z } from 'zod';

export const SearchResultSchema = z.object({
  conversationId: z.string(),
  messageId: z.string().nullable(),
  title: z.string().nullable(),
  snippet: z.string(),
  matchedIn: z.enum(['title', 'message']),
  at: z.number(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const SearchResponseSchema = z.object({
  results: z.array(SearchResultSchema),
  nextCursor: z.string().nullable(),
  /** True when the time budget ended the scan before the end of the history. */
  partial: z.boolean(),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const SEARCH_QUERY_MIN = 2;
export const SEARCH_QUERY_MAX = 200;

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(SEARCH_QUERY_MIN).max(SEARCH_QUERY_MAX),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

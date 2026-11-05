import type { SearchBackend } from '../types';
import { asRecord, joinUrl, mapResults, requestJson } from './shared';

export const searxngBackend: SearchBackend = {
  kind: 'searxng',
  async search(p, query, { count, signal }) {
    const params = new URLSearchParams({ q: query, format: 'json' });
    const headers: Record<string, string> = { ...p.headers };
    if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;
    const body = asRecord(
      await requestJson(p, `${joinUrl(p.baseUrl, '/search')}?${params}`, { headers }, signal),
    );
    return mapResults(body.results, 'content', count);
  },
};

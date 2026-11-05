import type { SearchBackend } from '../types';
import { asRecord, joinUrl, mapResults, requestJson } from './shared';
import { TAVILY_BASE_URL } from './urls';

export const tavilyBackend: SearchBackend = {
  kind: 'tavily',
  async search(p, query, { count, signal }) {
    const base = p.baseUrl.trim() || TAVILY_BASE_URL;
    const headers: Record<string, string> = { ...p.headers, 'content-type': 'application/json' };
    if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;
    const init = { method: 'POST', headers, body: JSON.stringify({ query, max_results: count }) };
    const body = asRecord(await requestJson(p, joinUrl(base, '/search'), init, signal));
    return mapResults(body.results, 'content', count);
  },
};

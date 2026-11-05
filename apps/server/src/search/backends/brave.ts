import type { SearchBackend } from '../types';
import { asRecord, joinUrl, mapResults, requestJson } from './shared';
import { BRAVE_BASE_URL } from './urls';

export const braveBackend: SearchBackend = {
  kind: 'brave',
  async search(p, query, { count, signal }) {
    const base = p.baseUrl.trim() || BRAVE_BASE_URL;
    const params = new URLSearchParams({ q: query, count: String(count) });
    const headers: Record<string, string> = { ...p.headers };
    if (p.apiKey) headers['x-subscription-token'] = p.apiKey;
    const url = `${joinUrl(base, '/res/v1/web/search')}?${params}`;
    const body = asRecord(await requestJson(p, url, { headers }, signal));
    return mapResults(asRecord(body.web).results, 'description', count);
  },
};

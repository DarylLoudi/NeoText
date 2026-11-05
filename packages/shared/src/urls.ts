const DROPPED_PARAMS = new Set(['fbclid', 'gclid', 'ref', 'ref_src']);

function parseWeb(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

export function normalizeSourceUrl(url: string): string | null {
  const u = parseWeb(url);
  if (!u) return null;
  const host = u.host.toLowerCase().replace(/^www\./, '');
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !k.toLowerCase().startsWith('utm_') && !DROPPED_PARAMS.has(k.toLowerCase()))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname;
  const query = new URLSearchParams(params).toString();
  return `https://${host}${path || '/'}${query ? `?${query}` : ''}`;
}

export function domainOf(url: string): string {
  const u = parseWeb(url);
  return u ? u.hostname.toLowerCase().replace(/^www\./, '') : '';
}

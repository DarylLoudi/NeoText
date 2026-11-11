const EXTENSIONS = new Set(['html', 'htm', 'css', 'js', 'mjs', 'json', 'svg', 'txt', 'md']);
const SEGMENT = /^[A-Za-z0-9._-]+$/;
const MAX_SEGMENTS = 4;

/**
 * A project path in its one stored form (`css/style.css`), or null when it is not allowed:
 * relative only, no `.` or `..` segments, at most four segments of letters, digits and `._-`, and
 * a text extension the preview understands.
 */
export function normalizeProjectPath(raw: string): string | null {
  const path = raw
    .trim()
    .replaceAll('\\', '/')
    .replace(/^(\.\/)+/, '');
  if (path === '' || path.startsWith('/')) return null;
  const segments = path.split('/');
  if (segments.length > MAX_SEGMENTS) return null;
  for (const s of segments) {
    if (s === '' || s === '.' || s === '..' || !SEGMENT.test(s)) return null;
  }
  const name = segments[segments.length - 1] ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return EXTENSIONS.has(name.slice(dot + 1).toLowerCase()) ? path : null;
}

/** The size of a text in UTF-8 bytes, which is what the limits count. */
export function byteSize(text: string): number {
  return new TextEncoder().encode(text).length;
}

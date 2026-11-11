/** What the preview page may tell the app. Anything else from the frame is dropped. */
export type FrameMessage =
  /** `path`: the page path the shell was opened at; another one means the page moved itself. */
  | { type: 'nt-preview-ready'; path?: string }
  /** Escape the page did not use itself. */
  | { type: 'nt-escape' }
  | { type: 'nt-loaded' }
  | { type: 'nt-console'; level: 'log' | 'info' | 'warn' | 'error'; text: string }
  | { type: 'nt-blocked'; url: string }
  | { type: 'nt-navigate'; path: string }
  | { type: 'nt-storage'; items: Record<string, string> };

const LEVELS = new Set(['log', 'info', 'warn', 'error']);
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;

/** What the prelude lets a page keep: keys and values together, as it counts them. */
export const STORAGE_LIMIT = 1048576;

function isItems(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  let size = 0;
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'string') return false;
    size += k.length + v.length;
  }
  return size <= STORAGE_LIMIT;
}

/**
 * Checks a message from the frame against the known shapes. Written by hand rather than with a
 * schema library, so the panel's chunk shares nothing with the first page's.
 */
export function isFrameMessage(data: unknown): data is FrameMessage {
  if (typeof data !== 'object' || data === null) return false;
  const m = data as Record<string, unknown>;
  switch (m.type) {
    case 'nt-preview-ready':
      return m.path === undefined || text(m.path, 500);
    case 'nt-loaded':
    case 'nt-escape':
      return true;
    case 'nt-console':
      return typeof m.level === 'string' && LEVELS.has(m.level) && text(m.text, 2000);
    case 'nt-blocked':
      return text(m.url, 2000);
    case 'nt-navigate':
      return text(m.path, 500);
    case 'nt-storage':
      return isItems(m.items);
    default:
      return false;
  }
}

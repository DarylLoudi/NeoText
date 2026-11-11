const KEY = 'neotext:draft-agents';
/** Only the newest picks are kept, so the stored map stays small. */
const KEPT = 100;

/** Agent ids by draft key (a chat id or `new`); ids only, no content. */
function read(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((e): e is [string, string] => typeof e[1] === 'string'),
    );
  } catch {
    return {};
  }
}

/** The agent picked for the unsent message of `draftKey`, kept over a reload like its text. */
export function loadDraftAgent(draftKey: string): string | null {
  return read()[draftKey] ?? null;
}

export function saveDraftAgent(draftKey: string, agentId: string | null): void {
  const all = read();
  delete all[draftKey];
  if (agentId !== null) all[draftKey] = agentId;
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(Object.entries(all).slice(-KEPT))));
  } catch {
    // Storage unavailable: the pick still holds until the page reloads.
  }
}

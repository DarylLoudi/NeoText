export const CHUNK_SIZE = 1200;
export const CHUNK_OVERLAP = 200;

/** A cut is moved back to a space when one lies in the last part of the window. */
const SOFT_BREAK_SHARE = 0.25;

/** Runs of spaces and tabs become one space and blank-line runs one blank line. */
function tidy(text: string): string {
  return text
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Where a window starting at `start` ends: at a break near `start + size` when there is one. */
function cutAt(text: string, start: number, size: number): number {
  const hard = start + size;
  if (hard >= text.length) return text.length;
  const floor = hard - Math.floor(size * SOFT_BREAK_SHARE);
  for (let i = hard; i > floor; i--) {
    if (/\s/.test(text[i] ?? '')) return i;
  }
  return hard;
}

/**
 * Splits each page's text into windows of at most `size` characters, each starting `overlap`
 * characters before the previous one ended, so a passage cut at a border is whole in one of
 * them. Windows never cross pages, and each carries its page number.
 */
export function chunkPages(
  pages: { n: number | null; text: string }[],
  size: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP,
): { page: number | null; text: string }[] {
  const out: { page: number | null; text: string }[] = [];
  for (const page of pages) {
    const text = tidy(page.text);
    let start = 0;
    while (start < text.length) {
      const end = cutAt(text, start, size);
      const piece = text.slice(start, end).trim();
      if (piece !== '') out.push({ page: page.n, text: piece });
      if (end >= text.length) break;
      start = Math.max(end - overlap, start + 1);
    }
  }
  return out;
}

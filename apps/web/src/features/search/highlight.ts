export interface HighlightPart {
  text: string;
  match: boolean;
}

const MARKS = /\p{M}/gu;
const MARK = /^\p{M}/u;
const fold = (s: string) => s.normalize('NFKD').replace(MARKS, '').toLowerCase();
/** Character by character, as the server folds, so context rules such as final sigma agree. */
const foldChars = (s: string) => [...s].map(fold).join('');

/**
 * Cuts `text` into runs, marking where `query` occurs. Matching ignores case and accents (the
 * same folding the server uses), and every run is a slice of the original text, so "café"
 * stays "café" when "cafe" matches it. The query is never a pattern.
 */
export function splitHighlight(text: string, query: string): HighlightPart[] {
  const needle = foldChars(query.trim());
  if (!text) return [];
  if (!needle) return [{ text, match: false }];
  let folded = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) {
      starts.push(i);
      ends.push(i + ch.length);
    }
    folded += f;
    i += ch.length;
  }
  const parts: HighlightPart[] = [];
  let cursor = 0;
  let from = 0;
  for (;;) {
    const at = folded.indexOf(needle, from);
    if (at < 0) break;
    const start = starts[at] ?? 0;
    let end = ends[at + needle.length - 1] ?? text.length;
    // Marks that follow belong to the matched letter (decomposed accents).
    while (end < text.length && MARK.test(text.slice(end)))
      end += (text.codePointAt(end) ?? 0) > 0xffff ? 2 : 1;
    if (start >= cursor) {
      if (start > cursor) parts.push({ text: text.slice(cursor, start), match: false });
      parts.push({ text: text.slice(start, end), match: true });
      cursor = end;
    }
    from = at + needle.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts.length ? parts : [{ text, match: false }];
}

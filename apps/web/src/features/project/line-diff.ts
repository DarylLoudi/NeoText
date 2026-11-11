export interface DiffLine {
  kind: 'same' | 'add' | 'del';
  text: string;
}

/** Above this many comparisons (lines × lines, after the shared ends) the diff gives up. */
const MAX_CELLS = 4_000_000;

const lines = (text: string) => (text === '' ? [] : text.split('\n'));

/**
 * A line diff of two versions of a file: the longest common subsequence of the lines between
 * the shared start and end. Very large changes come back as "all removed, then all added".
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = lines(before);
  const b = lines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head = a.slice(0, start).map((text): DiffLine => ({ kind: 'same', text }));
  const tail = a.slice(endA).map((text): DiffLine => ({ kind: 'same', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  return [...head, ...middle(midA, midB), ...tail];
}

function middle(a: string[], b: string[]): DiffLine[] {
  const del = (text: string): DiffLine => ({ kind: 'del', text });
  const add = (text: string): DiffLine => ({ kind: 'add', text });
  if (a.length * b.length > MAX_CELLS || a.length === 0 || b.length === 0) {
    return [...a.map(del), ...b.map(add)];
  }
  // lcs[i][j]: the common length of a[i..] and b[j..], in one flat table.
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? (lcs[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(lcs[(i + 1) * width + j] ?? 0, lcs[i * width + j + 1] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] ?? '' });
      i++;
      j++;
    } else if ((lcs[(i + 1) * width + j] ?? 0) >= (lcs[i * width + j + 1] ?? 0)) {
      out.push(del(a[i++] ?? ''));
    } else {
      out.push(add(b[j++] ?? ''));
    }
  }
  return [...out, ...a.slice(i).map(del), ...b.slice(j).map(add)];
}

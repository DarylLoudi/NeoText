const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const MARKERS = ['**', '__', '~~'] as const;

/**
 * Temporarily closes an odd `**`, `__`, `~~` or inline backtick so a half-streamed block does not
 * flash raw markers. Code fences are never touched: an unclosed one is left as it is, and
 * markers inside closed fences or inline code are ignored.
 */
export function repairStreaming(block: string): string {
  const open: string[] = [];
  let codeRun = '';
  let inFence: string | null = null;

  for (const line of block.split('\n')) {
    const fence = FENCE_OPEN.exec(line)?.[1];
    if (inFence !== null) {
      if (fence && fence[0] === inFence[0] && fence.length >= inFence.length) inFence = null;
      continue;
    }
    if (fence) {
      inFence = fence;
      continue;
    }
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '`') {
        let end = i;
        while (line[end + 1] === '`') end++;
        const run = line.slice(i, end + 1);
        if (codeRun === '') codeRun = run;
        else if (codeRun === run) codeRun = '';
        i = end;
        continue;
      }
      if (codeRun !== '') continue;
      const pair = line.slice(i, i + 2);
      if ((MARKERS as readonly string[]).includes(pair)) {
        const at = open.lastIndexOf(pair);
        if (at === -1) open.push(pair);
        else open.splice(at, 1);
        i++;
      }
    }
    // An inline code span cannot cross a blank line, but a block never contains one, so the
    // span legitimately stays open across lines here.
  }

  if (inFence !== null || (codeRun === '' && open.length === 0)) return block;
  return `${block.trimEnd()}${codeRun}${[...open].reverse().join('')}`;
}

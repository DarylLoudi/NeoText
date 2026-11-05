const OPEN = '<think>';
const CLOSE = '</think>';

interface Split {
  text: string;
  reasoning: string;
}

/** Length of the longest suffix of `s` that is a proper prefix of `tag`. */
function partialTagLength(s: string, tag: string): number {
  for (let n = Math.min(s.length, tag.length - 1); n > 0; n--) {
    if (tag.startsWith(s.slice(s.length - n))) return n;
  }
  return 0;
}

/** Streaming splitter for `<think>…</think>` blocks, tolerant of tags cut across chunks. */
export function createThinkSplitter(): {
  push(text: string): Split;
  flush(): Split;
} {
  let inside = false;
  let buffer = '';

  const emit = (out: Split, s: string) => {
    if (inside) out.reasoning += s;
    else out.text += s;
  };

  return {
    push(text) {
      const out: Split = { text: '', reasoning: '' };
      buffer += text;
      while (buffer !== '') {
        const tag = inside ? CLOSE : OPEN;
        const at = buffer.indexOf(tag);
        if (at !== -1) {
          emit(out, buffer.slice(0, at));
          buffer = buffer.slice(at + tag.length);
          inside = !inside;
          continue;
        }
        const keep = partialTagLength(buffer, tag);
        emit(out, buffer.slice(0, buffer.length - keep));
        buffer = buffer.slice(buffer.length - keep);
        break;
      }
      return out;
    },
    flush() {
      const out: Split = { text: '', reasoning: '' };
      emit(out, buffer);
      buffer = '';
      return out;
    },
  };
}

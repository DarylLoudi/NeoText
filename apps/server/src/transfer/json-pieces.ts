/**
 * Writes one JSON object's text a field, or a batch of array items, at a time, so no single
 * `JSON.stringify` call sees a whole export. The text is byte for byte what
 * `JSON.stringify(object, null, indent)` gives for the same fields in the same order.
 */
export interface JsonObjectWriter {
  /** A field whose value is written whole; `undefined` is left out, as JSON.stringify does. */
  value(key: string, value: unknown): void;
  /** Starts an array field; its items follow through `items`, then `endArray`. */
  beginArray(key: string): void;
  items(values: readonly unknown[]): void;
  endArray(): void;
  /** Closes the object and returns its UTF-8 text. */
  end(): Buffer;
  /** UTF-8 bytes written so far. */
  readonly bytes: number;
}

export function jsonObjectWriter(indent: 0 | 2): JsonObjectWriter {
  const pieces: Buffer[] = [];
  let bytes = 0;
  let fields = 0;
  let count = 0;
  const nl = indent ? '\n' : '';
  const pad = (depth: number) => ' '.repeat(indent * depth);
  const push = (text: string) => {
    const b = Buffer.from(text, 'utf8');
    pieces.push(b);
    bytes += b.length;
  };
  // A nested value's own line breaks move in by the depth it sits at.
  const at = (value: unknown, depth: number) => {
    const text = JSON.stringify(value, null, indent) ?? 'null';
    return indent ? text.replaceAll('\n', `\n${pad(depth)}`) : text;
  };
  const key = (k: string) => {
    push(`${fields++ === 0 ? '{' : ','}${nl}${pad(1)}${JSON.stringify(k)}:${indent ? ' ' : ''}`);
  };
  return {
    value(k, value) {
      if (value === undefined) return;
      key(k);
      push(at(value, 1));
    },
    beginArray(k) {
      key(k);
      push('[');
      count = 0;
    },
    items(values) {
      let text = '';
      for (const v of values) text += `${count++ === 0 ? '' : ','}${nl}${pad(2)}${at(v, 2)}`;
      if (text !== '') push(text);
    },
    endArray() {
      push(count === 0 ? ']' : `${nl}${pad(1)}]`);
    },
    end() {
      push(fields === 0 ? '{}' : `${nl}}`);
      return Buffer.concat(pieces, bytes);
    },
    get bytes() {
      return bytes;
    },
  };
}

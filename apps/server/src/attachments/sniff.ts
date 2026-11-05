export type SniffedType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif'
  | 'application/pdf'
  | 'text';

const TEXT_SCAN_BYTES = 64 * 1024;

const startsWith = (b: Buffer, sig: number[] | string, at = 0) => {
  const bytes = typeof sig === 'string' ? Buffer.from(sig, 'latin1') : Buffer.from(sig);
  return b.length >= at + bytes.length && b.subarray(at, at + bytes.length).equals(bytes);
};

/** True when `b` is valid UTF-8 with no NUL; a character cut off by the end of `b` is allowed. */
function looksLikeText(b: Buffer, cut: boolean): boolean {
  if (b.includes(0)) return false;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  // A cut multi-byte character is at most 3 bytes; `stream` leaves it pending instead of failing.
  try {
    decoder.decode(b, { stream: cut });
    return true;
  } catch {
    return false;
  }
}

/** What the bytes are, from their magic numbers; `text` is UTF-8 with no NUL in the first 64 KiB. */
export function sniffContent(bytes: Buffer): SniffedType | null {
  if (bytes.length === 0) return null;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, 'GIF87a') || startsWith(bytes, 'GIF89a')) return 'image/gif';
  if (startsWith(bytes, 'RIFF') && startsWith(bytes, 'WEBP', 8)) return 'image/webp';
  if (startsWith(bytes, '%PDF-')) return 'application/pdf';
  return looksLikeText(bytes.subarray(0, TEXT_SCAN_BYTES), bytes.length > TEXT_SCAN_BYTES)
    ? 'text'
    : null;
}

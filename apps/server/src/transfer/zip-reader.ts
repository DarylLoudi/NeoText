import { Inflate } from 'fflate';

/** One central directory record: what the zip says about an entry, before anything is read. */
export interface ZipEntryInfo {
  name: string;
  compression: number;
  compressedSize: number;
  originalSize: number;
  localOffset: number;
}

/** A central directory record is at least 46 bytes; real exports hold far fewer entries. */
const CD_RECORD_MIN = 46;
const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CD_RECORD = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const U32_MAX = 0xffffffff;

/** Thrown for any structural problem; the caller turns it into its own refusal. */
export class ZipFormatError extends Error {}

const bad = (why: string) => new ZipFormatError(why);

const u64 = (data: Buffer, at: number): number => {
  const v = data.readBigUInt64LE(at);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw bad('zip64 value out of range');
  return Number(v);
};

/**
 * The central directory, read by hand so the reader knows where each entry's data starts.
 * The entry count comes from the (zip64) end record, which a 98-byte file can set to billions;
 * no real zip can hold more entries than its size allows, so a count past `maxEntries` (at
 * most size / 46) is refused before a single record is read. Every read is bounds checked:
 * Buffer's own range errors also end up as a `ZipFormatError`.
 */
export function readCentralDirectory(data: Buffer, maxEntries: number): ZipEntryInfo[] {
  try {
    const limit = Math.min(Math.floor(data.length / CD_RECORD_MIN), maxEntries);
    let eocd = -1;
    for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
      if (data.readUInt32LE(i) === EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw bad('no end of central directory');
    let count = data.readUInt16LE(eocd + 10);
    let offset = data.readUInt32LE(eocd + 16);
    if (count === 0xffff || offset === U32_MAX) {
      const locator = eocd - 20;
      if (locator < 0 || data.readUInt32LE(locator) !== ZIP64_LOCATOR) throw bad('no locator');
      const record = u64(data, locator + 8);
      if (data.readUInt32LE(record) !== ZIP64_EOCD) throw bad('no zip64 end record');
      count = u64(data, record + 32);
      offset = u64(data, record + 48);
    }
    if (count > limit) throw bad('zip claims more entries than it can hold');
    const entries: ZipEntryInfo[] = [];
    let at = offset;
    for (let n = 0; n < count; n++) {
      if (data.readUInt32LE(at) !== CD_RECORD) throw bad('broken central directory');
      const utf8 = (data.readUInt16LE(at + 8) & 0x800) !== 0;
      const nameLength = data.readUInt16LE(at + 28);
      const extraLength = data.readUInt16LE(at + 30);
      const commentLength = data.readUInt16LE(at + 32);
      const nameEnd = at + 46 + nameLength;
      if (nameEnd + extraLength > data.length) throw bad('record past the end');
      let originalSize = data.readUInt32LE(at + 24);
      let compressedSize = data.readUInt32LE(at + 20);
      let localOffset = data.readUInt32LE(at + 42);
      // A zip64 extra field holds, in this order, only the values the record set to 0xFFFFFFFF.
      for (let e = nameEnd; e + 4 <= nameEnd + extraLength; ) {
        const id = data.readUInt16LE(e);
        const size = data.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let p = e + 4;
          const next = () => {
            const v = u64(data, p);
            p += 8;
            return v;
          };
          if (originalSize === U32_MAX) originalSize = next();
          if (compressedSize === U32_MAX) compressedSize = next();
          if (localOffset === U32_MAX) localOffset = next();
        }
        e += 4 + size;
      }
      entries.push({
        name: data.toString(utf8 ? 'utf8' : 'latin1', at + 46, nameEnd),
        compression: data.readUInt16LE(at + 10),
        compressedSize,
        originalSize,
        localOffset,
      });
      at = nameEnd + extraLength + commentLength;
    }
    return entries;
  } catch (err) {
    if (err instanceof ZipFormatError) throw err;
    throw bad('unreadable zip');
  }
}

/** The compressed bytes of one entry, found through its local header. */
function entryData(data: Buffer, entry: ZipEntryInfo): Buffer {
  try {
    const at = entry.localOffset;
    if (data.readUInt32LE(at) !== LOCAL_HEADER) throw bad('no local header');
    const start = at + 30 + data.readUInt16LE(at + 26) + data.readUInt16LE(at + 28);
    const end = start + entry.compressedSize;
    if (end > data.length) throw bad('entry past the end');
    return data.subarray(start, end);
  } catch (err) {
    if (err instanceof ZipFormatError) throw err;
    throw bad('unreadable entry');
  }
}

/** Compressed bytes handed to the inflater per step; each step is followed by a yield. */
const INPUT_STEP = 16 * 1024;
/**
 * Output per byte of input past which an entry is refused. Real JSON exports deflate about
 * 5-20 to 1; deflate itself tops out near 1032 to 1, which only a crafted file reaches. The
 * ratio is judged once the output passes `RATIO_GRACE_BYTES`, so small, very repetitive
 * files still open.
 */
export const MAX_INFLATE_RATIO = 200;
const RATIO_GRACE_BYTES = 16 * 1024 * 1024;

export type InflateRefusal = 'too_large' | 'ratio' | 'size_mismatch' | 'corrupt';
export class InflateRefused extends Error {
  readonly reason: InflateRefusal;
  constructor(reason: InflateRefusal) {
    super(reason);
    this.reason = reason;
  }
}

/**
 * Inflates one entry in small steps, yielding to the event loop between them, and stops as
 * soon as the output passes `max`, passes the size the directory declared (a lying header),
 * or grows absurdly faster than its input. Nothing past those bounds is ever kept.
 */
export async function inflateEntry(
  data: Buffer,
  entry: ZipEntryInfo,
  max: number,
): Promise<Uint8Array> {
  const input = entryData(data, entry);
  if (entry.compression === 0) {
    if (input.length > max) throw new InflateRefused('too_large');
    if (input.length !== entry.originalSize) throw new InflateRefused('size_mismatch');
    return new Uint8Array(input);
  }
  if (entry.compression !== 8) throw new InflateRefused('corrupt');
  if (input.length === 0) throw new InflateRefused('corrupt');
  const chunks: Uint8Array[] = [];
  let total = 0;
  let refused: InflateRefusal | null = null;
  const inflater = new Inflate((chunk) => {
    if (refused) return;
    total += chunk.length;
    if (total > max) refused = 'too_large';
    else if (total > entry.originalSize) refused = 'size_mismatch';
    else chunks.push(chunk);
  });
  for (let at = 0; at < input.length; at += INPUT_STEP) {
    const end = Math.min(at + INPUT_STEP, input.length);
    try {
      inflater.push(input.subarray(at, end), end === input.length);
    } catch {
      refused ??= 'corrupt';
    }
    if (!refused && total > RATIO_GRACE_BYTES && total > end * MAX_INFLATE_RATIO) {
      refused = 'ratio';
    }
    if (refused) throw new InflateRefused(refused);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return Buffer.concat(chunks, total);
}

import { type FlateStreamHandler, strToU8, zipSync } from 'fflate';
import { describe, expect, test, vi } from 'vitest';
import { parseUpload } from './upload';
import { MAX_INFLATE_RATIO } from './zip-reader';

/** Every inflate stream the reader opened, with the bytes it put out so far. */
const inflated: { output: number }[] = [];
vi.mock('fflate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fflate')>();
  class TrackedInflate extends actual.Inflate {
    constructor(cb: FlateStreamHandler) {
      const seen = { output: 0 };
      super((chunk, final) => {
        seen.output += chunk.length;
        cb(chunk, final);
      });
      inflated.push(seen);
    }
  }
  return { ...actual, Inflate: TrackedInflate };
});

describe('upload parsing', () => {
  test('a zip entry larger than the bound is refused before it is fully inflated', async () => {
    const big = Buffer.from(JSON.stringify([{ pad: 'x'.repeat(10_000) }]));
    const zip = Buffer.from(zipSync({ 'conversations.json': new Uint8Array(big) }));
    await expect(parseUpload('chatgpt', zip, { maxUnpackedBytes: 1000 })).rejects.toThrow(
      expect.objectContaining({ code: 'payload_too_large', status: 413 }),
    );
    expect(await parseUpload('chatgpt', zip, { maxUnpackedBytes: 20_000 })).toEqual([
      { pad: 'x'.repeat(10_000) },
    ]);
  });

  test('a zip with two entries of the chosen name is refused without inflating either', async () => {
    // Same trick as a crafted file: zip a small entry and a big one, then rename the big one.
    const small = strToU8('[]');
    const big = new Uint8Array(5 * 1024 * 1024);
    const zip = Buffer.from(
      Buffer.from(zipSync({ 'conversations.json': small, conversationsXjson: big }))
        .toString('latin1')
        .replaceAll('conversationsXjson', 'conversations.json'),
      'latin1',
    );
    inflated.length = 0;
    await expect(parseUpload('chatgpt', zip, { maxUnpackedBytes: 1024 * 1024 })).rejects.toThrow(
      expect.objectContaining({
        code: 'bad_request',
        status: 400,
        details: { reason: 'zip_duplicate_entry' },
        message: expect.stringMatching(/more than one conversations\.json/),
      }),
    );
    // No entry was ever handed to fflate to inflate, least of all the 5 MiB one.
    expect(inflated).toEqual([]);
  });

  test('a tiny zip that claims millions of entries is refused at once', async () => {
    // A local header signature, a zip64 end record claiming 10 million entries, its locator
    // and the classic end record: 102 bytes in all.
    const zip = Buffer.alloc(102);
    zip.writeUInt32LE(0x04034b50, 0);
    zip.writeUInt32LE(0x06064b50, 4); // zip64 end of central directory
    zip.writeUInt32LE(10_000_000, 4 + 32); // entry count
    zip.writeUInt32LE(0, 4 + 48); // central directory offset
    zip.writeUInt32LE(0x07064b50, 60); // zip64 locator
    zip.writeUInt32LE(4, 60 + 8); // where the zip64 record is
    zip.writeUInt32LE(0x06054b50, 80); // end of central directory
    zip.writeUInt16LE(0xffff, 80 + 8);
    zip.writeUInt32LE(0xffffffff, 80 + 16);
    const started = performance.now();
    await expect(parseUpload('chatgpt', zip)).rejects.toThrow(
      expect.objectContaining({ code: 'bad_request', details: { reason: 'not_export' } }),
    );
    expect(performance.now() - started).toBeLessThan(500);
  });

  test('exactly one entry is inflated, and only after its own size is checked', async () => {
    inflated.length = 0;
    const zip = Buffer.from(
      zipSync({ 'a/conversations.json': strToU8('[1]'), 'conversations.json': strToU8('[2]') }),
    );
    expect(await parseUpload('claude', zip)).toEqual([2]);
    expect(inflated).toEqual([{ output: 3 }]);
  });

  test('only a conversations.json entry is read; paths are not trusted', async () => {
    const zip = Buffer.from(
      zipSync({
        '../../conversations.json': strToU8('[1]'),
        'nested/conversations.json': strToU8('[2]'),
        'conversations.json': strToU8('[3]'),
      }),
    );
    expect(await parseUpload('claude', zip)).toEqual([3]);
    const nested = Buffer.from(zipSync({ 'export-2026/conversations.json': strToU8('[4]') }));
    expect(await parseUpload('claude', nested)).toEqual([4]);
  });

  test('a large entry unpacks off the main thread, still bounded by its declared size', async () => {
    const rows = Array.from({ length: 20_000 }, (_, i) => ({
      id: i,
      text: 'Halo dunia '.repeat(8),
    }));
    const json = Buffer.from(JSON.stringify(rows));
    expect(json.length).toBeGreaterThan(2 * 1024 * 1024);
    const zip = Buffer.from(zipSync({ 'conversations.json': new Uint8Array(json) }));
    let turns = 0;
    let running = true;
    const tick = () => {
      if (!running) return;
      turns++;
      setImmediate(tick);
    };
    setImmediate(tick);
    expect(await parseUpload('chatgpt', zip)).toEqual(rows);
    running = false;
    // The event loop kept turning while the entry was inflated.
    expect(turns).toBeGreaterThan(0);

    // A central directory that understates the size: the inflate stops at the stated size.
    const lying = Buffer.from(zip);
    const cd = lying.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    lying.writeUInt32LE(600_000, cd + 24);
    await expect(parseUpload('chatgpt', lying, { maxUnpackedBytes: 1024 * 1024 })).rejects.toThrow(
      expect.objectContaining({ details: { reason: 'not_export' } }),
    );
  });

  test('a deflate entry that inflates absurdly is stopped early', async () => {
    // 64 MiB of zeros deflates to about 64 KiB: far past any real export's ratio.
    const zeros = new Uint8Array(64 * 1024 * 1024);
    const zip = Buffer.from(zipSync({ 'conversations.json': zeros }));
    expect(zeros.length / zip.length).toBeGreaterThan(MAX_INFLATE_RATIO);
    inflated.length = 0;
    await expect(parseUpload('chatgpt', zip)).rejects.toThrow(
      expect.objectContaining({ code: 'payload_too_large', details: { reason: 'too_large' } }),
    );
    // It stopped soon after the ratio was judged, long before all 64 MiB came out.
    expect(inflated).toHaveLength(1);
    expect(inflated[0]?.output).toBeLessThan(40 * 1024 * 1024);
  });
});

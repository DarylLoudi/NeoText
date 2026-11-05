import type { ImportSource } from '@neotext/shared';
import { AppError } from '../http/errors';
import { MAX_UNPACKED_BYTES } from './bundle';
import { notExport } from './parsers/types';
import {
  InflateRefused,
  inflateEntry,
  readCentralDirectory,
  type ZipEntryInfo,
} from './zip-reader';

const PRODUCT: Record<Exclude<ImportSource, 'neotext'>, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
};
const ENTRY = 'conversations.json';
const MAX_ZIP_ENTRIES = 100_000;

const tooLarge = () =>
  new AppError('payload_too_large', 'This export file is too large to open.', 413, {
    reason: 'too_large',
  });

const isZip = (file: Buffer) =>
  file.length >= 4 && file[0] === 0x50 && file[1] === 0x4b && (file[2] === 3 || file[2] === 5);

/**
 * The `conversations.json` entry of a zip, by its name only: names are untrusted, so one with
 * `..` or an absolute path is never picked, and the shallowest match wins. A zip with two
 * entries of the chosen name is refused rather than guessed at. Nothing is written to disk and
 * exactly one entry is inflated, after its own declared size is checked against `max`. The
 * inflate is streamed in small steps with a yield between them, and stops once the output
 * passes `max`, the declared size, or `MAX_INFLATE_RATIO` times its input, so a lying deflate
 * entry can neither grow past the bound nor hold the event loop.
 */
async function zipEntry(file: Buffer, product: string, max: number): Promise<Uint8Array> {
  let entries: ZipEntryInfo[];
  try {
    entries = readCentralDirectory(file, MAX_ZIP_ENTRIES);
  } catch {
    throw notExport(product);
  }
  const segments = (name: string) => name.replaceAll('\\', '/').split('/');
  const counts = new Map<string, number>();
  let chosen: { entry: ZipEntryInfo; depth: number } | null = null;
  for (const entry of entries) {
    counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
    const parts = segments(entry.name);
    const safe = !entry.name.startsWith('/') && !/^[a-zA-Z]:/.test(entry.name);
    if (safe && parts.at(-1) === ENTRY && !parts.includes('..')) {
      if (!chosen || parts.length < chosen.depth) chosen = { entry, depth: parts.length };
    }
  }
  if (!chosen) {
    throw new AppError(
      'bad_request',
      `This zip has no ${ENTRY}. Choose the export zip from ${product}, or the ${ENTRY} file inside it.`,
      400,
      { reason: 'zip_without_entry' },
    );
  }
  if ((counts.get(chosen.entry.name) ?? 0) > 1) {
    throw new AppError(
      'bad_request',
      `This zip has more than one ${ENTRY}, so it is not a ${product} export. Choose the zip exactly as ${product} sent it.`,
      400,
      { reason: 'zip_duplicate_entry' },
    );
  }
  if (chosen.entry.originalSize > max) throw tooLarge();
  try {
    return await inflateEntry(file, chosen.entry, max);
  } catch (err) {
    if (err instanceof InflateRefused && (err.reason === 'too_large' || err.reason === 'ratio')) {
      throw tooLarge();
    }
    throw notExport(product);
  }
}

/**
 * Raw JSON or a zip holding `conversations.json`, as a parsed value. The closing `JSON.parse`
 * of up to 256 MiB stays one synchronous step, as it cannot be split cheaply; at most two
 * imports run at a time on the server, one per user.
 */
export async function parseUpload(
  source: Exclude<ImportSource, 'neotext'>,
  file: Buffer,
  opts: { maxUnpackedBytes?: number } = {},
): Promise<unknown> {
  const product = PRODUCT[source];
  const max = opts.maxUnpackedBytes ?? MAX_UNPACKED_BYTES;
  const bytes = isZip(file) ? await zipEntry(file, product, max) : file;
  if (bytes.length > max) throw tooLarge();
  try {
    return JSON.parse(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString('utf8'));
  } catch {
    throw notExport(product);
  }
}

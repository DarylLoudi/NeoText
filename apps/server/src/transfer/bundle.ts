import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import type {
  ConversationSummary,
  Folder,
  MessagePublic,
  Preset,
  ProviderCategory,
  ProviderKind,
} from '@neotext/shared';
import { DecryptError, open, seal } from '../crypto/aead';
import { type Argon2Params, deriveIkm, randomSalt } from '../crypto/kdf';
import { AppError } from '../http/errors';

/** A provider as it travels in a bundle; only present when the user asked for their keys. */
export interface BundleProvider {
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  apiKey: string | null;
  headers: Record<string, string> | null;
  manualModels: string[];
  category: ProviderCategory;
}

/** Everything one user owns, as plain values. Rows keep their original ids. */
export interface BundleV1 {
  version: 1;
  exportedAt: number;
  app: string;
  settings: unknown;
  /** The settings schema `settings` was written at; files without it were written at 1. */
  settingsSchemaVersion?: number;
  folders: Folder[];
  conversations: ConversationSummary[];
  messages: MessagePublic[];
  presets: Preset[];
  providers?: BundleProvider[];
}

const MAGIC = Buffer.from('NTXB1\n', 'ascii');
const AAD = 'neotext/v1/bundle';
const KDF = { memoryKiB: 65536, passes: 2 } as const;
/** Bounds on what a file's header may ask for, so opening one cannot exhaust the server. */
const MAX_MEMORY_KIB = 262_144;
const MAX_PASSES = 10;
const MAX_HEADER_BYTES = 1024;
/** Unpacked JSON larger than this is refused rather than inflated; below V8's string limit. */
export const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;
/** version byte + nonce + tag: anything shorter cannot be an envelope. */
const MIN_ENVELOPE_BYTES = 1 + 12 + 16;
const ENVELOPE_VERSION = 1;

// zlib's async calls run on the threadpool, so packing a large bundle does not hold up requests.
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

interface Header {
  kdf: 'argon2id';
  salt: string;
  memoryKiB: number;
  passes: number;
}

// `details.reason` lets the web word these in the user's language (ImportErrorReason).
const notOurs = () =>
  new AppError('bad_request', 'This is not a NeoText export file.', 400, { reason: 'not_neotext' });
const tooLarge = () =>
  new AppError('payload_too_large', 'This export file is too large to open.', 413, {
    reason: 'too_large',
  });
const wrongPassphrase = () =>
  new AppError('bad_request', 'That passphrase does not open this file.', 400, {
    reason: 'wrong_passphrase',
  });

const params = (h: { memoryKiB: number; passes: number }): Argon2Params => ({
  alg: 'argon2id',
  memoryKiB: h.memoryKiB,
  passes: h.passes,
  parallelism: 1,
  v: 1,
});

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

function parseHeader(line: Buffer): Header & { saltBytes: Buffer } {
  let h: unknown;
  try {
    h = JSON.parse(line.toString('utf8'));
  } catch {
    throw notOurs();
  }
  if (typeof h !== 'object' || h === null) throw notOurs();
  const { kdf, salt, memoryKiB, passes } = h as Record<string, unknown>;
  if (kdf !== 'argon2id' || typeof salt !== 'string') throw notOurs();
  if (!isInt(memoryKiB, 8, MAX_MEMORY_KIB) || !isInt(passes, 1, MAX_PASSES)) throw notOurs();
  const saltBytes = Buffer.from(salt, 'base64');
  if (saltBytes.length !== 16 || saltBytes.toString('base64') !== salt) throw notOurs();
  return { kdf, salt, memoryKiB, passes, saltBytes };
}

/** A light shape check; the importer validates each row. */
function isBundleV1(v: unknown): v is BundleV1 {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    b.version === 1 &&
    typeof b.exportedAt === 'number' &&
    typeof b.app === 'string' &&
    ['folders', 'conversations', 'messages', 'presets'].every((k) => Array.isArray(b[k])) &&
    (b.providers === undefined || Array.isArray(b.providers))
  );
}

/**
 * `NTXB1\n` + a JSON header line naming the KDF and its salt + an AES-256-GCM envelope of the
 * gzipped bundle JSON, keyed by argon2id of the passphrase.
 */
export async function sealBundle(bundle: BundleV1, passphrase: string): Promise<Buffer> {
  return sealBundleJson(Buffer.from(JSON.stringify(bundle), 'utf8'), passphrase);
}

/**
 * As `sealBundle`, for bundle JSON already written out (the exporter writes it in pieces).
 * Key derivation and gzip run off the main thread; the AES-GCM pass over the packed bytes
 * stays synchronous, but it is native and runs at well over 1 GB/s.
 */
export async function sealBundleJson(json: Buffer, passphrase: string): Promise<Buffer> {
  const salt = randomSalt();
  const header: Header = { kdf: 'argon2id', salt: salt.toString('base64'), ...KDF };
  const key = await deriveIkm(passphrase, salt, params(KDF));
  const packed = await gzipAsync(json);
  return Buffer.concat([
    MAGIC,
    Buffer.from(`${JSON.stringify(header)}\n`, 'utf8'),
    seal(key, packed, AAD),
  ]);
}

/**
 * Opens a bundle file. Key derivation and gunzip run off the main thread. Two steps stay
 * synchronous: the native AES-GCM pass (bounded by the 200 MiB upload) and the final
 * `JSON.parse` of at most 256 MiB, which cannot be split cheaply; on a very large file that
 * parse holds the event loop for about a second per 100 MiB. One import runs at a time.
 */
export async function openBundle(file: Buffer, passphrase: string): Promise<BundleV1> {
  if (file.length < MAGIC.length || !file.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw notOurs();
  }
  const end = file.indexOf(0x0a, MAGIC.length);
  if (end < 0 || end - MAGIC.length > MAX_HEADER_BYTES) throw notOurs();
  const header = parseHeader(file.subarray(MAGIC.length, end));
  const envelope = file.subarray(end + 1);
  // Refuse a truncated body before paying for the key derivation.
  if (envelope.length < MIN_ENVELOPE_BYTES || envelope[0] !== ENVELOPE_VERSION) throw notOurs();
  const key = await deriveIkm(passphrase, header.saltBytes, params(header));
  let packed: Buffer;
  try {
    packed = open(key, envelope, AAD);
  } catch (err) {
    if (err instanceof DecryptError) throw wrongPassphrase();
    throw err;
  }
  let json: string;
  try {
    json = (await gunzipAsync(packed, { maxOutputLength: MAX_UNPACKED_BYTES })).toString('utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw tooLarge();
    throw notOurs();
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw notOurs();
  }
  if (!isBundleV1(value)) throw notOurs();
  return value;
}

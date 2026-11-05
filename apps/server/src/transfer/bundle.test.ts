import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { seal } from '../crypto/aead';
import { deriveIkm } from '../crypto/kdf';
import { type BundleV1, MAX_UNPACKED_BYTES, openBundle, sealBundle } from './bundle';

// Counts key derivations, so a test can show a broken file is refused before argon2 runs.
vi.mock('../crypto/kdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../crypto/kdf')>();
  return {
    ...actual,
    deriveIkm: vi.fn((...args: Parameters<typeof actual.deriveIkm>) => actual.deriveIkm(...args)),
  };
});
beforeEach(() => {
  vi.mocked(deriveIkm).mockClear();
});

const PW = 'kata sandi yang panjang';

const sample = (): BundleV1 => ({
  version: 1,
  exportedAt: Date.UTC(2026, 10, 3),
  app: 'NeoText 0.0.0-test',
  settings: { appearance: { theme: 'dark' } },
  folders: [
    {
      id: 'fld_1',
      parentId: null,
      name: 'Kuliah',
      color: null,
      position: 'a0',
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  conversations: [
    {
      id: 'cnv_1',
      title: 'Rencana skripsi',
      titleSource: 'user',
      folderId: 'fld_1',
      pinned: false,
      pinPosition: null,
      archived: false,
      presetId: null,
      modelRef: null,
      activeLeafId: 'msg_1',
      messageCount: 1,
      createdAt: 1,
      updatedAt: 1,
      lastActivityAt: 1,
      deletedAt: null,
    },
  ],
  messages: [
    {
      id: 'msg_1',
      conversationId: 'cnv_1',
      parentId: null,
      role: 'user',
      status: 'complete',
      parts: [{ type: 'text', text: 'Halo, dunia' }],
      model: null,
      usage: null,
      finishReason: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  presets: [],
});

/** Splits a file into its magic line, header line and sealed body. */
function split(file: Buffer): { magic: string; header: string; body: Buffer } {
  const first = file.indexOf(0x0a);
  const second = file.indexOf(0x0a, first + 1);
  return {
    magic: file.subarray(0, first).toString('ascii'),
    header: file.subarray(first + 1, second).toString('utf8'),
    body: file.subarray(second + 1),
  };
}

describe('bundle', () => {
  test('bundle round trip', async () => {
    const b = sample();
    const file = await sealBundle(b, PW);
    const { magic, header, body } = split(file);
    expect(magic).toBe('NTXB1');
    const parsed = JSON.parse(header) as Record<string, unknown>;
    expect(parsed).toMatchObject({ kdf: 'argon2id', memoryKiB: 65536, passes: 2 });
    expect(Buffer.from(parsed.salt as string, 'base64')).toHaveLength(16);
    expect(body[0]).toBe(1);
    expect(file.toString('utf8')).not.toContain('Rencana');
    expect(await openBundle(file, PW)).toEqual(b);
  });

  test('two exports of the same data differ', async () => {
    const b = sample();
    const [x, y] = await Promise.all([sealBundle(b, PW), sealBundle(b, PW)]);
    expect(x.equals(y)).toBe(false);
  });

  test('wrong passphrase and bad files are clear errors', async () => {
    const file = await sealBundle(sample(), PW);
    const wrongPw = 'That passphrase does not open this file.';
    const notOurs = 'This is not a NeoText export file.';
    await expect(openBundle(file, 'kata sandi yang salah')).rejects.toMatchObject({
      code: 'bad_request',
      status: 400,
      message: wrongPw,
    });
    const tampered = Buffer.from(file);
    tampered[tampered.length - 5] = (tampered[tampered.length - 5] ?? 0) ^ 0xff;
    await expect(openBundle(tampered, PW)).rejects.toMatchObject({ message: wrongPw });

    const { header, body } = split(file);
    const withHeader = (h: string) => Buffer.concat([Buffer.from(`NTXB1\n${h}\n`), body]);
    const bad: Buffer[] = [
      Buffer.from('hello'),
      Buffer.alloc(0),
      Buffer.from(`PK\u0003\u0004${'x'.repeat(100)}`),
      Buffer.concat([Buffer.from('NTXB2\n'), file.subarray(6)]),
      withHeader('not json'),
      withHeader(header.replace('argon2id', 'scrypt')),
      // An absurd cost would make opening the file a denial of service.
      withHeader(header.replace('65536', '99999999')),
      withHeader(header.replace('"passes":2', '"passes":1000')),
      withHeader(JSON.stringify({ ...JSON.parse(header), salt: 'AA==' })),
      Buffer.from(`NTXB1\n${header}`),
    ];
    for (const f of bad) {
      await expect(openBundle(f, PW)).rejects.toMatchObject({
        code: 'bad_request',
        message: notOurs,
      });
    }
  });

  test('a sealed body that is not a bundle is refused', async () => {
    const file = await sealBundle({ ...sample(), version: 2 } as unknown as BundleV1, PW);
    await expect(openBundle(file, PW)).rejects.toMatchObject({
      message: 'This is not a NeoText export file.',
    });
  });

  test('an empty, short or wrong-version envelope is refused before the key is derived', async () => {
    const file = await sealBundle(sample(), PW);
    const { header, body } = split(file);
    vi.mocked(deriveIkm).mockClear();
    const head = Buffer.from(`NTXB1\n${header}\n`);
    const wrongVersion = Buffer.from(body);
    wrongVersion[0] = 2;
    for (const b of [Buffer.alloc(0), body.subarray(0, 1 + 12 + 16 - 1), wrongVersion]) {
      await expect(openBundle(Buffer.concat([head, b]), PW)).rejects.toMatchObject({
        message: 'This is not a NeoText export file.',
      });
    }
    expect(deriveIkm).not.toHaveBeenCalled();
    // The smallest well-formed envelope does reach the passphrase check.
    await expect(
      openBundle(Buffer.concat([head, body.subarray(0, 1 + 12 + 16)]), PW),
    ).rejects.toMatchObject({ message: 'That passphrase does not open this file.' });
    expect(deriveIkm).toHaveBeenCalledTimes(1);
  });

  test('a bundle that unpacks past the cap is a clear error, not a crash', async () => {
    expect(MAX_UNPACKED_BYTES).toBe(256 * 1024 * 1024);
    const salt = Buffer.alloc(16, 7);
    const header = { kdf: 'argon2id', salt: salt.toString('base64'), memoryKiB: 8, passes: 1 };
    const key = await deriveIkm(PW, salt, {
      alg: 'argon2id',
      memoryKiB: 8,
      passes: 1,
      parallelism: 1,
      v: 1,
    });
    // Concatenated gzip members inflate as one stream: a few hundred KiB that unpack past the cap.
    const MiB = 1024 * 1024;
    const member = gzipSync(Buffer.alloc(MiB, 0x20), { level: 9 });
    const bomb = Buffer.concat(Array.from({ length: MAX_UNPACKED_BYTES / MiB + 1 }, () => member));
    const file = Buffer.concat([
      Buffer.from(`NTXB1\n${JSON.stringify(header)}\n`),
      seal(key, bomb, 'neotext/v1/bundle'),
    ]);
    await expect(openBundle(file, PW)).rejects.toMatchObject({
      code: 'payload_too_large',
      status: 413,
      message: 'This export file is too large to open.',
    });
  });
});

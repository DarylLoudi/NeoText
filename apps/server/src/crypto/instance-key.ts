import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomKey } from './kdf';

const SEALED_WARNING =
  'Replacing the instance key makes data sealed with it (shared provider keys, escrow) unreadable, so restore the key from a backup first.';

function decode(b64: string, what: string): Buffer {
  const trimmed = b64.trim();
  const key = Buffer.from(trimmed, 'base64');
  // Strict standard-alphabet base64: re-encoding must give back exactly the input.
  if (key.length !== 32 || key.toString('base64') !== trimmed) {
    throw new Error(
      `${what} must be exactly 32 bytes encoded as standard base64. ${SEALED_WARNING}`,
    );
  }
  return key;
}

const readKeyFile = async (file: string): Promise<Buffer> =>
  decode(await fs.readFile(file, 'utf8'), `The instance key file ${file}`);

/** Flush a directory entry to disk where the platform supports it. */
async function fsyncDir(dir: string): Promise<void> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(dir, 'r');
    await handle.sync();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EISDIR' && code !== 'EINVAL' && code !== 'ENOTSUP') throw err;
  } finally {
    await handle?.close();
  }
}

/** The instance key comes from NEOTEXT_INSTANCE_KEY, else <dataDir>/keys/instance.key (created on first run). */
export async function loadOrCreateInstanceKey(
  dataDir: string,
  envB64: string | null,
): Promise<Buffer> {
  if (envB64) return decode(envB64, 'NEOTEXT_INSTANCE_KEY');
  const dir = path.join(dataDir, 'keys');
  const file = path.join(dir, 'instance.key');
  await fs.mkdir(dir, { recursive: true });
  try {
    return await readKeyFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  // Write a complete, fsynced temp file, then hard-link it into place. link() fails with
  // EEXIST if another process won the race, so the key file is never visible half-written.
  const key = randomKey();
  const tmp = path.join(dir, `instance.key.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const handle = await fs.open(tmp, 'wx', 0o600);
    try {
      await handle.writeFile(key.toString('base64'));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.link(tmp, file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      return await readKeyFile(file);
    }
    await fsyncDir(dir);
    return key;
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}

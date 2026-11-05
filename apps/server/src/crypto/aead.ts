import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 1;
const NONCE_LEN = 12;
const TAG_LEN = 16;

export class DecryptError extends Error {
  constructor() {
    super('Could not decrypt this data. The key or the data does not match.');
    this.name = 'DecryptError';
  }
}

/** Envelope: 0x01 || nonce(12) || ciphertext || tag(16), AES-256-GCM. */
export function seal(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_LEN });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), nonce, ciphertext, cipher.getAuthTag()]);
}

export function open(key: Buffer, sealed: Buffer, aad: string): Buffer {
  if (sealed.length < 1 + NONCE_LEN + TAG_LEN || sealed[0] !== VERSION) throw new DecryptError();
  try {
    const nonce = sealed.subarray(1, 1 + NONCE_LEN);
    const tag = sealed.subarray(sealed.length - TAG_LEN);
    const ciphertext = sealed.subarray(1 + NONCE_LEN, sealed.length - TAG_LEN);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_LEN });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new DecryptError();
  }
}

export function sealJson(key: Buffer, value: unknown, aad: string): Buffer {
  return seal(key, Buffer.from(JSON.stringify(value), 'utf8'), aad);
}

export function openJson<T = unknown>(key: Buffer, sealed: Buffer, aad: string): T {
  try {
    return JSON.parse(open(key, sealed, aad).toString('utf8')) as T;
  } catch (err) {
    if (err instanceof DecryptError) throw err;
    throw new DecryptError();
  }
}

export function sealText(key: Buffer, text: string, aad: string): Buffer {
  return seal(key, Buffer.from(text, 'utf8'), aad);
}

export function openText(key: Buffer, sealed: Buffer, aad: string): string {
  return open(key, sealed, aad).toString('utf8');
}

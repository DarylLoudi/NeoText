import fs from 'node:fs';
import path from 'node:path';
import { isId } from '@neotext/shared';
import { aad } from '../crypto/aad';
import { open, seal } from '../crypto/aead';

/** Sealed attachment bytes at `<data>/attachments/<userId>/<id>.bin`. */
export interface AttachmentStore {
  write(userId: string, id: string, bytes: Buffer, dek: Buffer): Promise<void>;
  read(userId: string, id: string, dek: Buffer): Promise<Buffer>;
  /** Removes the file; a file that is already gone is fine. */
  remove(userId: string, id: string): void;
  /** Removes the user's whole folder (account deletion). */
  removeUser(userId: string): Promise<void>;
}

const fileAad = (id: string) => aad('attachments', 'data', id);

export function createAttachmentStore(dataDir: string): AttachmentStore {
  const root = path.join(dataDir, 'attachments');
  // Ids come from our own rows, but a path is built from them: refuse anything else.
  const dirOf = (userId: string) => {
    if (!isId(userId, 'usr')) throw new Error('bad attachment owner id');
    return path.join(root, userId);
  };
  const fileOf = (userId: string, id: string) => {
    if (!isId(id, 'att')) throw new Error('bad attachment id');
    return path.join(dirOf(userId), `${id}.bin`);
  };
  return {
    write: async (userId, id, bytes, dek) => {
      await fs.promises.mkdir(dirOf(userId), { recursive: true });
      await fs.promises.writeFile(fileOf(userId, id), seal(dek, bytes, fileAad(id)), {
        flag: 'wx',
      });
    },
    read: async (userId, id, dek) =>
      open(dek, await fs.promises.readFile(fileOf(userId, id)), fileAad(id)),
    remove: (userId, id) => {
      fs.rmSync(fileOf(userId, id), { force: true });
    },
    removeUser: (userId) => fs.promises.rm(dirOf(userId), { recursive: true, force: true }),
  };
}

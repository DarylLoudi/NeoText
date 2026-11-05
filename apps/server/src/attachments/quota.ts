import type { AuthContext } from '../http/env';
import { AppError } from '../http/errors';
import type { AttachmentsRepo } from './repo';

/** Stored file bytes per user when `NEOTEXT_ATTACHMENT_QUOTA_MB` is not set: 2 GiB. */
export const DEFAULT_ATTACHMENT_QUOTA_BYTES = 2048 * 1024 * 1024;

/**
 * The per-user storage cap: a check that throws a 413 when `bytes` more would take the user
 * past `quotaBytes` of stored files, sent or not. `details` lets the web word it.
 */
export function storageQuota(
  repo: Pick<AttachmentsRepo, 'storedBytes'>,
  quotaBytes: number = DEFAULT_ATTACHMENT_QUOTA_BYTES,
): (auth: AuthContext, bytes: number) => void {
  const limitMb = Math.floor(quotaBytes / (1024 * 1024));
  return (auth, bytes) => {
    if (repo.storedBytes(auth.userId) + bytes <= quotaBytes) return;
    throw new AppError(
      'payload_too_large',
      `Your files have reached the storage limit of ${limitMb} MB. Delete chats with files you no longer need and empty the trash, then try again.`,
      413,
      { reason: 'attachment_quota', limitMb },
    );
  };
}

import { ApiErrorBodySchema, type AttachmentPublic } from '@neotext/shared';
import { ApiError } from './client';

/** Where an attachment's bytes are served; same origin, so the session cookie goes along. */
export const attachmentUrl = (id: string) => `/api/attachments/${encodeURIComponent(id)}`;

function errorFrom(xhr: XMLHttpRequest): ApiError {
  try {
    const parsed = ApiErrorBodySchema.safeParse(JSON.parse(xhr.responseText));
    if (parsed.success) {
      const { code, message, details, requestId } = parsed.data.error;
      return new ApiError(code, message, xhr.status, details, requestId);
    }
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return new ApiError('internal', `The server returned an error (${xhr.status}).`, xhr.status);
}

/**
 * Uploads one file. XHR rather than fetch: only XHR reports upload progress (0 to 1).
 * Rejects with ApiError, or with an AbortError when `signal` aborts.
 */
export function uploadAttachment(
  file: File,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<AttachmentPublic> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/attachments');
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) opts.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as AttachmentPublic);
        } catch {
          reject(new ApiError('internal', 'The server sent an answer we could not read.', 0));
        }
      } else reject(errorFrom(xhr));
    };
    xhr.onerror = () =>
      reject(new ApiError('network', 'Could not reach the server. Check your connection.', 0));
    xhr.onabort = () => reject(new DOMException('The upload was cancelled.', 'AbortError'));
    if (opts.signal) {
      if (opts.signal.aborted) {
        reject(new DOMException('The upload was cancelled.', 'AbortError'));
        return;
      }
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}

import {
  type ExportBody,
  type ImportResult,
  ImportResultSchema,
  type ImportSource,
} from '@neotext/shared';
import { rawFetch } from './client';

export interface DownloadedFile {
  blob: Blob;
  filename: string;
  /** Attached files the export left out, from `X-Skipped-Attachments`; 0 when not sent. */
  skippedAttachments: number;
}

const countFrom = (header: string | null): number => {
  const n = Number(header ?? '0');
  return Number.isInteger(n) && n > 0 ? n : 0;
};

/** The file name from a `Content-Disposition` header, preferring the RFC 5987 UTF-8 form. */
export function filenameFrom(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // fall through to the plain name
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(header) ?? /filename\s*=\s*([^;]+)/i.exec(header);
  return plain?.[1]?.trim() || fallback;
}

/** Saves a blob through a temporary link, as a browser download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.click();
  // Some browsers read the URL after click() returns, so release it a little later.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export interface ImportRequest {
  source: ImportSource;
  file: File;
  passphrase?: string;
  restoreSettings?: boolean;
}

export const transferApi = {
  export: async (body: ExportBody): Promise<DownloadedFile> => {
    const res = await rawFetch('/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return {
      blob: await res.blob(),
      filename: filenameFrom(res.headers.get('content-disposition'), 'neotext-export'),
      skippedAttachments: countFrom(res.headers.get('x-skipped-attachments')),
    };
  },
  import: async (req: ImportRequest): Promise<ImportResult> => {
    const form = new FormData();
    form.append('source', req.source);
    form.append('file', req.file);
    if (req.passphrase) form.append('passphrase', req.passphrase);
    if (req.restoreSettings) form.append('restoreSettings', 'true');
    // The browser sets the multipart boundary itself.
    const res = await rawFetch('/import', { method: 'POST', body: form });
    return ImportResultSchema.parse(await res.json());
  },
};

/** Exports and immediately downloads the file; returns how many attached files it left out. */
export async function downloadExport(body: ExportBody): Promise<{ skippedAttachments: number }> {
  const { blob, filename, skippedAttachments } = await transferApi.export(body);
  saveBlob(blob, filename);
  return { skippedAttachments };
}

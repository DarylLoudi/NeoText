import { z } from 'zod';

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
/** Characters of an attached text file sent to the model; the rest is cut. */
export const ATTACHMENT_TEXT_INLINE_MAX = 100_000;
export const ATTACHMENT_MAX_PER_MESSAGE = 10;
/** The `attachmentId` of a part whose file is gone (a fork of a chat whose file was missing). */
export const ATTACHMENT_UNAVAILABLE_ID = '';
export const ATTACHMENT_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;
export const ATTACHMENT_PDF_TYPE = 'application/pdf';
export const ATTACHMENT_TEXT_TYPES = ['text/plain', 'text/markdown', 'text/csv'] as const;
/** Code and config files by extension; they are stored as `text/plain`. */
export const ATTACHMENT_CODE_EXTENSIONS = [
  'txt',
  'md',
  'csv',
  'json',
  'yaml',
  'yml',
  'toml',
  'xml',
  'ini',
  'log',
  'sql',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'tsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'php',
  'swift',
  'sh',
  'ps1',
  'css',
  'scss',
  'html',
  'vue',
  'svelte',
] as const;

export type AttachmentKind = 'image' | 'pdf' | 'text';

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};

/**
 * The type a file is stored under, from its claimed type and name, or null when attachments do
 * not take it. Code files map to `text/plain`. Content is checked separately on the server.
 */
export function normalizeAttachmentMime(name: string, mime: string): string | null {
  const m = mime.toLowerCase().split(';')[0]?.trim() ?? '';
  if ((ATTACHMENT_IMAGE_TYPES as readonly string[]).includes(m)) return m;
  if (m === ATTACHMENT_PDF_TYPE) return m;
  if (m === 'text/markdown' || m === 'text/csv') return m;
  const ext = extensionOf(name);
  if (ext === 'md') return 'text/markdown';
  if (ext === 'csv') return 'text/csv';
  if (m === 'text/plain' || (ATTACHMENT_CODE_EXTENSIONS as readonly string[]).includes(ext)) {
    return 'text/plain';
  }
  return null;
}

export function attachmentKind(mime: string): AttachmentKind | null {
  if ((ATTACHMENT_IMAGE_TYPES as readonly string[]).includes(mime)) return 'image';
  if (mime === ATTACHMENT_PDF_TYPE) return 'pdf';
  if ((ATTACHMENT_TEXT_TYPES as readonly string[]).includes(mime)) return 'text';
  return null;
}

export const AttachmentPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  mime: z.string(),
  size: z.number().int().min(0),
  createdAt: z.number(),
});
export type AttachmentPublic = z.infer<typeof AttachmentPublicSchema>;

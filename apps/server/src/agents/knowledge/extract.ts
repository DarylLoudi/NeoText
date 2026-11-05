import { parseHtml } from '../../tools/builtin/html-parse';
import { InflateRefused, inflateEntry, readCentralDirectory } from '../../transfer/zip-reader';

/** A refusal with a reason the user can read; it is stored on the failed file. */
export class KnowledgeError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = 'KnowledgeError';
    this.reason = reason;
  }
}

export type KnowledgeKind = 'pdf' | 'docx' | 'text' | 'html';

export interface ExtractedPage {
  /** The PDF page number; null for files without pages. */
  n: number | null;
  text: string;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'csv']);
const TEXT_MIMES = new Set(['text/plain', 'text/markdown', 'text/x-markdown', 'text/csv']);

/** Unpacked size of every DOCX entry together; real documents are far smaller. */
export const DOCX_MAX_UNPACKED = 64 * 1024 * 1024;
const DOCX_MAX_ENTRIES = 2_000;

const NO_TEXT = 'No text found.';
const NO_TEXT_PDF = 'No text found (scanned PDF?).';
const TIMED_OUT = 'Reading this file took too long. Try a smaller file.';

/**
 * What a file is, by its extension first and its declared type second; browsers send `.md`
 * and `.csv` with many types or none. Null when it is not a type the knowledge base takes.
 */
export function knowledgeKind(name: string, mime: string): KnowledgeKind | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const type = mime.toLowerCase().split(';')[0]?.trim() ?? '';
  if (ext === 'pdf' || type === 'application/pdf') return 'pdf';
  if (ext === 'docx' || type === DOCX_MIME) return 'docx';
  if (ext === 'html' || ext === 'htm' || type === 'text/html') return 'html';
  if (TEXT_EXTENSIONS.has(ext) || TEXT_MIMES.has(type)) return 'text';
  return null;
}

const decode = (bytes: Buffer) => new TextDecoder('utf-8').decode(bytes);

async function pdfPages(bytes: Buffer): Promise<ExtractedPage[]> {
  if (bytes.subarray(0, 1024).indexOf('%PDF-') < 0) throw new KnowledgeError('This is not a PDF.');
  // Loaded on first use: pdf.js is large, and most starts never read a PDF.
  const { getDocumentProxy, extractText } = await import('unpdf');
  let doc: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    doc = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  } catch {
    throw new KnowledgeError(
      'This PDF could not be read. It may be damaged or password protected.',
    );
  }
  try {
    const { text } = await extractText(doc, { mergePages: false });
    return text.map((t, i) => ({ n: i + 1, text: t }));
  } finally {
    void doc.loadingTask.destroy().catch(() => {});
  }
}

/**
 * Every entry is inflated once, bounded, before mammoth sees the file: the directory's sizes
 * can lie, and `inflateEntry` stops at the declared size, the total cap or an absurd ratio.
 */
async function guardDocx(bytes: Buffer): Promise<void> {
  const unreadable = () => new KnowledgeError('This Word file could not be read.');
  let entries: ReturnType<typeof readCentralDirectory>;
  try {
    entries = readCentralDirectory(bytes, DOCX_MAX_ENTRIES);
  } catch {
    throw unreadable();
  }
  const declared = entries.reduce((sum, e) => sum + e.originalSize, 0);
  if (declared > DOCX_MAX_UNPACKED)
    throw new KnowledgeError('This Word file is too large to open.');
  if (!entries.some((e) => e.name === 'word/document.xml')) throw unreadable();
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    try {
      await inflateEntry(bytes, entry, DOCX_MAX_UNPACKED);
    } catch (err) {
      if (err instanceof InflateRefused && err.reason !== 'corrupt') {
        throw new KnowledgeError('This Word file is too large to open.');
      }
      throw unreadable();
    }
  }
}

async function docxText(bytes: Buffer): Promise<string> {
  await guardDocx(bytes);
  const mammoth = (await import('mammoth')).default;
  try {
    return (await mammoth.extractRawText({ buffer: bytes })).value;
  } catch {
    throw new KnowledgeError('This Word file could not be read.');
  }
}

async function htmlText(bytes: Buffer, signal: AbortSignal): Promise<string> {
  try {
    // In a child process with its own deadline, like pages `fetch_url` reads.
    const page = await parseHtml(decode(bytes), 'https://knowledge.invalid/', {
      signal,
      deadlineMs: 20_000,
    });
    return page.title && !page.text.startsWith(page.title)
      ? `${page.title}\n\n${page.text}`
      : page.text;
  } catch {
    if (signal.aborted) throw new KnowledgeError(TIMED_OUT);
    throw new KnowledgeError('This HTML file is too complex to read.');
  }
}

async function pagesOf(
  kind: KnowledgeKind,
  bytes: Buffer,
  signal: AbortSignal,
): Promise<ExtractedPage[]> {
  if (kind === 'pdf') return pdfPages(bytes);
  if (kind === 'docx') return [{ n: null, text: await docxText(bytes) }];
  if (kind === 'html') return [{ n: null, text: await htmlText(bytes, signal) }];
  return [{ n: null, text: decode(bytes) }];
}

/** Resolves with `work`, or rejects with the timeout reason once `signal` aborts. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new KnowledgeError(TIMED_OUT));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new KnowledgeError(TIMED_OUT));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * The text of an uploaded file, by page for a PDF (`pageCount` counts every page, with text or
 * not). Pages without text are dropped; a file with
 * no text at all, a type the knowledge base does not take, or a run past `signal` is a
 * `KnowledgeError` with its reason.
 */
export async function extractText(
  name: string,
  mime: string,
  bytes: Buffer,
  signal: AbortSignal,
): Promise<{ pages: ExtractedPage[]; pageCount: number | null }> {
  const kind = knowledgeKind(name, mime);
  if (!kind) throw new KnowledgeError('This file type is not supported.');
  const all = await untilAborted(pagesOf(kind, bytes, signal), signal);
  const pages = all
    .map((p) => ({ n: p.n, text: p.text.replace(/^﻿/, '').replace(/\r\n?/g, '\n') }))
    .filter((p) => p.text.trim() !== '');
  if (pages.length === 0) throw new KnowledgeError(kind === 'pdf' ? NO_TEXT_PDF : NO_TEXT);
  return { pages, pageCount: kind === 'pdf' ? all.length : null };
}

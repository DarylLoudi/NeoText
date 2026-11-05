import { type ChildProcess, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** A page is given this long to be read, once its turn comes. */
export const PARSE_DEADLINE_MS = 5_000;
/** How many pages are read at once; the rest wait. */
const MAX_PARALLEL = 2;
/** Heap limit of the child that reads a page. */
const CHILD_HEAP_MB = 512;
/** The most the child may print; a parsed 2 MB page is far smaller. */
const OUTPUT_MAX_BYTES = 8 * 1024 * 1024;

const CHILD_FILE = fileURLToPath(new URL('./html-child.mjs', import.meta.url));

/** The page took too long, too much memory, or could not be read at all: hostile markup. */
export class ComplexPageError extends Error {
  constructor() {
    super('This page is too complex to read.');
    this.name = 'ComplexPageError';
  }
}

export class ParseStoppedError extends Error {
  constructor() {
    super('Reading the page was stopped.');
    this.name = 'ParseStoppedError';
  }
}

export interface ParsedPage {
  title: string;
  text: string;
}

/** The child's output, or null when it is not exactly one `{title, text}` object of strings. */
export function readResult(output: string): ParsedPage | null {
  try {
    const value: unknown = JSON.parse(output);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const { title, text } = value as Record<string, unknown>;
    return typeof title === 'string' && typeof text === 'string' ? { title, text } : null;
  } catch {
    return null;
  }
}

let running = 0;
const waiting: { go: () => void; drop: () => void }[] = [];

function acquire(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new ParseStoppedError());
  if (running < MAX_PARALLEL) {
    running++;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const entry = {
      go: () => {
        signal.removeEventListener('abort', entry.drop);
        running++;
        resolve();
      },
      drop: () => {
        waiting.splice(waiting.indexOf(entry), 1);
        reject(new ParseStoppedError());
      },
    };
    signal.addEventListener('abort', entry.drop, { once: true });
    waiting.push(entry);
  });
}

function release(): void {
  running--;
  waiting.shift()?.go();
}

/**
 * Only what node itself needs: never the server's environment, which holds keys. The loader is
 * resolved the same way under `tsx`, `node --import tsx` and vitest.
 */
export function childSpawn(): { args: string[]; env: NodeJS.ProcessEnv } {
  const env: NodeJS.ProcessEnv = {};
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  return {
    args: [
      `--max-old-space-size=${CHILD_HEAP_MB}`,
      '--import',
      import.meta.resolve('tsx'),
      CHILD_FILE,
    ],
    env,
  };
}

function runChild(
  html: string,
  url: string,
  signal: AbortSignal,
  deadlineMs: number,
  onSpawn?: (pid: number) => void,
): Promise<ParsedPage> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      const { args, env } = childSpawn();
      child = spawn(process.execPath, args, {
        env,
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch (err) {
      release();
      reject(err);
      return;
    }
    if (child.pid !== undefined) onSpawn?.(child.pid);
    let done = false;
    let output = '';
    let outputBytes = 0;
    let failure: Error | null = null;
    // Kill once, remember why, and settle when the process is really gone.
    const stop = (why: Error) => {
      failure ??= why;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => stop(new ComplexPageError()), deadlineMs);
    const onAbort = () => stop(new ParseStoppedError());
    signal.addEventListener('abort', onAbort, { once: true });
    const settle = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      release();
      fn();
    };
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (data: string) => {
      outputBytes += Buffer.byteLength(data);
      if (outputBytes > OUTPUT_MAX_BYTES) stop(new ComplexPageError());
      else output += data;
    });
    child.stdin?.on('error', () => {});
    child.once('error', (err) => settle(() => reject(err)));
    child.once('close', (code) =>
      settle(() => {
        const page = code === 0 ? readResult(output) : null;
        if (failure) reject(failure);
        else if (page) resolve(page);
        else reject(new ComplexPageError());
      }),
    );
    child.stdin?.end(JSON.stringify({ html, url }));
  });
}

/**
 * Extracts a page's title and text in a child process, because parsing and Readability can take
 * unbounded time or memory on hostile markup, and exhausting the heap kills the process that
 * suffers it. At most `MAX_PARALLEL` pages are read at once (waiting counts toward the caller's
 * signal); a child that has not answered by `deadlineMs`, crashes, exits non-zero or prints
 * anything but a `{title, text}` line is killed or dropped as a `ComplexPageError`.
 */
export async function parseHtml(
  html: string,
  url: string,
  opts: { signal: AbortSignal; deadlineMs?: number; onSpawn?: (pid: number) => void },
): Promise<ParsedPage> {
  await acquire(opts.signal);
  if (opts.signal.aborted) {
    release();
    throw new ParseStoppedError();
  }
  return runChild(html, url, opts.signal, opts.deadlineMs ?? PARSE_DEADLINE_MS, opts.onSpawn);
}

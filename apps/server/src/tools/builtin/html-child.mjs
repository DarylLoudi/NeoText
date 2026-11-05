// Reads one page from a child process: {html, url} as JSON on stdin, one JSON line on stdout.
// It runs apart from the server because a hostile page can exhaust the heap, which aborts the
// whole process in a way no JavaScript handler can catch; the parent only loses this child.
import { Worker } from 'node:worker_threads';

/** The child ends itself after this long, even if its parent is gone and cannot kill it. */
const WATCHDOG_MS = 6_000;

// A timer on this thread cannot fire during a synchronous parse, so a worker thread keeps the
// time. Killing the whole process is the only way to stop a parse that never yields.
const watchdog = new Worker(
  `setTimeout(() => process.kill(process.pid, 'SIGKILL'), ${WATCHDOG_MS});`,
  { eval: true },
);

const { htmlToText } = await import('./html-text.ts');

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const { html, url } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const result = htmlToText(html, url);
await watchdog.terminate();
process.stdout.write(`${JSON.stringify(result)}\n`);

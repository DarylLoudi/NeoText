import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nestedHtml as nested } from '../../../test-support/nested-html';
import {
  ComplexPageError,
  childSpawn,
  PARSE_DEADLINE_MS,
  parseHtml,
  readResult,
} from './html-parse';

const article = readFileSync(
  new URL('../../../test-support/fixtures/article.html', import.meta.url),
  'utf8',
);
const never = new AbortController().signal;
const url = 'https://example.org/';

/** Longest pause of the main event loop while `work` runs. */
async function longestGap<T>(work: () => Promise<T>) {
  let last = Date.now();
  let gap = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    gap = Math.max(gap, now - last);
    last = now;
  }, 20);
  try {
    return { result: await work(), gap };
  } finally {
    clearInterval(timer);
  }
}

test('the deadline is 5 seconds', () => {
  expect(PARSE_DEADLINE_MS).toBe(5_000);
});

test('parses in a child process', async () => {
  const page = await parseHtml(article, url, { signal: never });
  expect(page.title).toBe('Panduan caching');
  expect(page.text).toContain('Caching menyimpan salinan data');
});

test('a hostile page is cut off at the deadline and never blocks the main loop', async () => {
  const started = Date.now();
  const { result, gap } = await longestGap(() =>
    parseHtml(nested(), url, { signal: never, deadlineMs: 400 }).catch((e: unknown) => e),
  );
  expect(result).toBeInstanceOf(ComplexPageError);
  expect(Date.now() - started).toBeLessThan(3_000);
  expect(gap).toBeLessThan(500);
});

test('two parses run at once and the rest wait their turn', async () => {
  const started = Date.now();
  const ends: number[] = [];
  const hostile = () =>
    parseHtml(nested(), url, { signal: never, deadlineMs: 500 }).catch(() => {
      ends.push(Date.now() - started);
    });
  await Promise.all([hostile(), hostile(), hostile()]);
  ends.sort((a, b) => a - b);
  expect(ends[1]).toBeLessThan(ends[2] as number);
  // The third could only start once a slot freed up, so it ends at least a full deadline later.
  expect((ends[2] as number) - (ends[0] as number)).toBeGreaterThanOrEqual(400);
});

test('a parse that is still queued stops waiting when its signal aborts', async () => {
  const hold = [0, 1].map(() =>
    parseHtml(nested(), url, { signal: never, deadlineMs: 1_500 }).catch(() => {}),
  );
  const abort = new AbortController();
  const queued = parseHtml(article, url, { signal: abort.signal });
  setTimeout(() => abort.abort(), 100);
  const started = Date.now();
  await expect(queued).rejects.toThrow(/stopped/i);
  expect(Date.now() - started).toBeLessThan(1_000);
  await Promise.all(hold);
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('a page that exhausts memory ends in a plain error and the server survives', async () => {
  const hungry = `<html><body><ul>${'<li>x'.repeat(400_000)}</ul></body></html>`;
  expect(hungry.length).toBeGreaterThan(2_000_000 - 100_000);
  const { result, gap } = await longestGap(() =>
    parseHtml(hungry, url, { signal: never }).catch((e: unknown) => e),
  );
  expect(result).toBeInstanceOf(ComplexPageError);
  expect(gap).toBeLessThan(1_000);
}, 20_000);

test('a killed child leaves no process behind', async () => {
  const pids: number[] = [];
  const result = await parseHtml(nested(), url, {
    signal: never,
    deadlineMs: 700,
    onSpawn: (pid) => pids.push(pid),
  }).catch((e: unknown) => e);
  expect(result).toBeInstanceOf(ComplexPageError);
  expect(pids).toHaveLength(1);
  expect(alive(pids[0] as number)).toBe(false);

  const abort = new AbortController();
  const stopped = parseHtml(nested(), url, {
    signal: abort.signal,
    onSpawn: (pid) => {
      pids.push(pid);
      setTimeout(() => abort.abort(), 50);
    },
  });
  await expect(stopped).rejects.toThrow(/stopped/i);
  expect(alive(pids[1] as number)).toBe(false);
});

test('a signal that is already aborted never starts a child', async () => {
  const abort = new AbortController();
  abort.abort();
  const pids: number[] = [];
  await expect(
    parseHtml(article, url, { signal: abort.signal, onSpawn: (pid) => pids.push(pid) }),
  ).rejects.toThrow(/stopped/i);
  expect(pids).toEqual([]);
});

test('the child gets only what node needs, never the server environment', () => {
  process.env.NEOTEXT_TEST_SECRET = 'hunter2';
  try {
    const { args, env } = childSpawn();
    expect(JSON.stringify(env)).not.toContain('hunter2');
    expect(Object.keys(env).every((key) => key === 'SystemRoot')).toBe(true);
    expect(args[0]).toBe('--max-old-space-size=512');
    expect(args).toContain('--import');
  } finally {
    Reflect.deleteProperty(process.env, 'NEOTEXT_TEST_SECRET');
  }
});

test.each([
  'not json',
  '',
  'null',
  '{"title":1,"text":"x"}',
  '{"title":"x","text":null}',
  '{"title":"x"}',
  '[]',
])('malformed child output %j is rejected', (out) => {
  expect(readResult(out)).toBeNull();
});

test('well-formed child output is accepted', () => {
  expect(readResult('{"title":"T","text":"isi"}\n')).toEqual({ title: 'T', text: 'isi' });
});

test('a child whose parent never stops it ends itself after six seconds', async () => {
  const parentDeadlineMs = 60_000;
  const pids: number[] = [];
  const started = Date.now();
  const result = await parseHtml(nested(400_000), url, {
    signal: never,
    deadlineMs: parentDeadlineMs,
    onSpawn: (pid) => pids.push(pid),
  }).catch((e: unknown) => e);
  const elapsed = Date.now() - started;
  expect(result).toBeInstanceOf(ComplexPageError);
  // Far short of the parent's deadline, even on a loaded machine: the parent did not kill it.
  expect(elapsed).toBeLessThan(parentDeadlineMs / 2);
  expect(elapsed).toBeGreaterThanOrEqual(5_500);
  expect(alive(pids[0] as number)).toBe(false);
}, 45_000);

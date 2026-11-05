import type { MessagePublic } from '@neotext/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createFakeClock } from '../../lib/clock';
import { createGeneration, type Generation } from './generation';
import { createGenerationManager, GENERATION_LIMITS } from './manager';

const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as never;
const model = { providerId: 'prv_1', modelId: 'm/1' };
let n = 0;

function msg(id: string, status: MessagePublic['status'] = 'streaming'): MessagePublic {
  return {
    id,
    conversationId: 'cnv_1',
    parentId: null,
    role: 'assistant',
    status,
    parts: [],
    model,
    usage: null,
    finishReason: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function gen(userId = 'usr_a'): Generation {
  n += 1;
  return createGeneration({
    id: `gen_${n}`,
    userId,
    conversationId: 'cnv_1',
    message: msg(`msg_${n}`),
    model,
    startedAt: 1,
    log,
  });
}

const finishNow = (g: Generation) => g.finish({ ...g.snapshot(), status: 'complete' });
const hang = () => new Promise<void>(() => {});
const manager = () => createGenerationManager({ clock: createFakeClock(), log });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test('capacity per user', () => {
  const m = manager();
  for (let i = 0; i < GENERATION_LIMITS.perUser; i++) m.start(gen(), hang);
  expect(() => m.assertCapacity('usr_a', 1)).toThrowError(
    expect.objectContaining({ code: 'rate_limited', status: 429 }),
  );
  expect(() => m.assertCapacity('usr_b', 1)).not.toThrow();
  expect(m.active('usr_a')).toHaveLength(4);
  expect(m.active('usr_b')).toEqual([]);
});

test('capacity frees up when a generation finishes', async () => {
  const m = manager();
  const gens = [gen(), gen(), gen(), gen()];
  for (const g of gens) m.start(g, hang);
  finishNow(gens[0] as Generation);
  expect(() => m.assertCapacity('usr_a', 1)).not.toThrow();
  expect(m.active('usr_a')).toHaveLength(3);
});

test('instance-wide capacity', () => {
  const m = manager();
  for (let i = 0; i < GENERATION_LIMITS.total; i++) m.start(gen(`usr_${i}`), hang);
  expect(() => m.assertCapacity('usr_new', 1)).toThrowError(
    expect.objectContaining({ code: 'rate_limited' }),
  );
});

test('subscribers registered right after start receive the first event', async () => {
  const m = manager();
  const g = gen();
  const seen: number[] = [];
  m.start(g, async (x) => {
    x.emit({ type: 'activity', kind: 'processing' });
    x.emit({ type: 'activity', kind: 'idle' });
    finishNow(x);
  });
  g.subscribe((e) => seen.push(e.seq));
  await vi.advanceTimersByTimeAsync(0);
  expect(seen).toEqual([1, 2, 3]);
});

test('a throwing subscriber does not break the others or the generation', async () => {
  const m = manager();
  const g = gen();
  const seen: string[] = [];
  g.subscribe(() => {
    throw new Error('boom');
  });
  g.subscribe((e) => seen.push(e.type));
  m.start(g, async (x) => {
    x.emit({ type: 'activity', kind: 'processing' });
    finishNow(x);
  });
  await vi.advanceTimersByTimeAsync(0);
  await expect(g.finished).resolves.toMatchObject({ status: 'complete' });
  expect(seen).toEqual(['activity', 'generation.finished']);
});

test('unsubscribe stops delivery', () => {
  const g = gen();
  const seen: string[] = [];
  const off = g.subscribe((e) => seen.push(e.type));
  g.emit({ type: 'activity', kind: 'idle' });
  off();
  g.emit({ type: 'activity', kind: 'idle' });
  expect(seen).toEqual(['activity']);
});

test('a run that throws finishes the generation as an error', async () => {
  const m = manager();
  const g = gen();
  m.start(g, async () => {
    throw new Error('crash');
  });
  await vi.advanceTimersByTimeAsync(0);
  await expect(g.finished).resolves.toMatchObject({ status: 'error' });
});

test('finished generations are kept for two minutes', async () => {
  const m = manager();
  const g = gen();
  m.start(g, async (x) => finishNow(x));
  await vi.advanceTimersByTimeAsync(0);
  await g.finished;
  await vi.advanceTimersByTimeAsync(119_000);
  expect(m.get(g.id)).toBeDefined();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(m.get(g.id)).toBeUndefined();
});

test('abort only for the owner', () => {
  const m = manager();
  const g = gen('usr_a');
  m.start(g, hang);
  expect(m.abort('usr_other', g.id)).toBe(false);
  expect(g.signal.aborted).toBe(false);
  expect(m.abort('usr_a', 'gen_missing')).toBe(false);
  expect(m.abort('usr_a', g.id)).toBe(true);
  expect(g.signal.aborted).toBe(true);
  expect(g.abortReason()).toBe('user');
});

test('idempotency keys expire after 60 s', async () => {
  const m = manager();
  m.rememberIdempotency('usr_a', 'key-1', ['gen_1', 'gen_2']);
  expect(m.lookupIdempotency('usr_a', 'key-1')).toEqual(['gen_1', 'gen_2']);
  expect(m.lookupIdempotency('usr_b', 'key-1')).toBeNull();
  await vi.advanceTimersByTimeAsync(59_000);
  expect(m.lookupIdempotency('usr_a', 'key-1')).not.toBeNull();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(m.lookupIdempotency('usr_a', 'key-1')).toBeNull();
});

test('shutdown aborts with reason shutdown', async () => {
  const m = manager();
  const g = gen();
  m.start(g, async (x) => {
    await new Promise<void>((resolve) => x.signal.addEventListener('abort', () => resolve()));
    x.finish({ ...x.snapshot(), status: 'aborted' });
  });
  await vi.advanceTimersByTimeAsync(0);
  await m.shutdown();
  expect(g.abortReason()).toBe('shutdown');
  expect(g.status()).toBe('aborted');
});

test('shutdown stops waiting after the timeout and clears timers', async () => {
  const m = manager();
  const g = gen();
  m.start(g, hang);
  m.rememberIdempotency('usr_a', 'k', ['x']);
  await vi.advanceTimersByTimeAsync(0);
  const done = m.shutdown(5_000);
  await vi.advanceTimersByTimeAsync(5_000);
  await done;
  expect(g.abortReason()).toBe('shutdown');
  expect(vi.getTimerCount()).toBe(0);
});

test('generation finish emits generation.finished and close resolves closed', async () => {
  const g = gen();
  const types: string[] = [];
  g.subscribe((e) => types.push(e.type));
  const final = { ...g.snapshot(), status: 'complete' as const };
  g.finish(final);
  await expect(g.finished).resolves.toEqual(final);
  expect(types).toEqual(['generation.finished']);
  g.close();
  await expect(g.closed).resolves.toBeUndefined();
});

test('a run that throws synchronously finishes the generation as an error', async () => {
  const m = manager();
  const g = gen();
  m.start(g, () => {
    throw new Error('sync crash');
  });
  await vi.advanceTimersByTimeAsync(0);
  await expect(g.finished).resolves.toMatchObject({ status: 'error' });
});

test('start after shutdown aborts immediately with reason shutdown', async () => {
  const m = manager();
  await m.shutdown();
  const g = gen();
  m.start(g, async (x) => {
    x.finish({ ...x.snapshot(), status: x.signal.aborted ? 'aborted' : 'complete' });
  });
  expect(g.abortReason()).toBe('shutdown');
  await vi.advanceTimersByTimeAsync(0);
  await expect(g.finished).resolves.toMatchObject({ status: 'aborted' });
});

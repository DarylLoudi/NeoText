import type { MessagePart } from '@neotext/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createFakeClock } from '../../lib/clock';
import type { MessagesRepo } from '../messages-repo';
import { createMessageWriter } from './writer';

const dek = Buffer.alloc(32, 1);
const text = (t: string): MessagePart[] => [{ type: 'text', text: t }];

function fakeRepo() {
  const update = vi.fn();
  return { update, repo: { update } as unknown as MessagesRepo };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test('throttles to one write per second with the latest parts', () => {
  const { update, repo } = fakeRepo();
  const w = createMessageWriter({
    messages: repo,
    dek,
    messageId: 'msg_1',
    clock: createFakeClock(),
    log: { error: vi.fn() } as never,
  });
  w.schedule(text('a'));
  vi.advanceTimersByTime(100);
  w.schedule(text('ab'));
  vi.advanceTimersByTime(100);
  w.schedule(text('abc'));
  vi.advanceTimersByTime(100);
  expect(update).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  expect(update).toHaveBeenCalledTimes(1);
  expect(update.mock.calls[0]?.[0]).toBe('msg_1');
  expect(update.mock.calls[0]?.[1]).toEqual({ parts: text('abc') });
  expect(update.mock.calls[0]?.[3]).toBe(dek);
  vi.advanceTimersByTime(5000);
  expect(update).toHaveBeenCalledTimes(1);
  w.schedule(text('abcd'));
  vi.advanceTimersByTime(1000);
  expect(update).toHaveBeenCalledTimes(2);
});

test('finish writes immediately and cancels the pending write', () => {
  const { update, repo } = fakeRepo();
  const clock = createFakeClock();
  const w = createMessageWriter({
    messages: repo,
    dek,
    messageId: 'msg_1',
    clock,
    log: { error: vi.fn() } as never,
  });
  w.schedule(text('partial'));
  w.finish({
    parts: text('final'),
    status: 'complete',
    usage: null,
    finishReason: 'stop',
    errorCode: null,
    generationRef: 'gen-1',
  });
  expect(update).toHaveBeenCalledTimes(1);
  expect(update.mock.calls[0]?.[1]).toEqual({
    parts: text('final'),
    status: 'complete',
    usage: null,
    finishReason: 'stop',
    errorCode: null,
    generationRef: 'gen-1',
  });
  expect(update.mock.calls[0]?.[2]).toBe(clock.now());
  vi.advanceTimersByTime(5000);
  expect(update).toHaveBeenCalledTimes(1);
});

test('a failing throttled write is logged, not thrown', () => {
  const { update, repo } = fakeRepo();
  update.mockImplementation(() => {
    throw new Error('disk full');
  });
  const error = vi.fn();
  const w = createMessageWriter({
    messages: repo,
    dek,
    messageId: 'msg_1',
    clock: createFakeClock(),
    log: { error } as never,
  });
  w.schedule(text('a'));
  expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  expect(error).toHaveBeenCalledTimes(1);
});

test('schedule after finish does nothing', () => {
  const { update, repo } = fakeRepo();
  const w = createMessageWriter({
    messages: repo,
    dek,
    messageId: 'msg_1',
    clock: createFakeClock(),
    log: { error: vi.fn() } as never,
  });
  w.finish({
    parts: text('final'),
    status: 'complete',
    usage: null,
    finishReason: 'stop',
    errorCode: null,
    generationRef: null,
  });
  w.schedule(text('stale'));
  vi.advanceTimersByTime(5000);
  expect(update).toHaveBeenCalledTimes(1);
  expect(update.mock.calls[0]?.[1]).toMatchObject({ parts: text('final') });
});

test('log is required', () => {
  const { repo } = fakeRepo();
  // @ts-expect-error log is required so write failures are never silent
  createMessageWriter({ messages: repo, dek, messageId: 'msg_1', clock: createFakeClock() });
});

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { eventsFor, msg, textOf } from '../test/chat-fixtures';
import {
  clearGeneration,
  flushEvents,
  getGenerationsState,
  ingestEvents,
  liveMessageFor,
  markLost,
  resetGenerations,
  setReconnecting,
  subscribeGenerations,
} from './generations';

let frames: FrameRequestCallback[] = [];
const runFrame = () => {
  const due = frames;
  frames = [];
  for (const cb of due) cb(0);
};

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  resetGenerations();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const assistant = msg({ id: 'msg_a', status: 'streaming' });

test('many events in a frame cause one update', () => {
  const listener = vi.fn();
  const unsubscribe = subscribeGenerations(listener);
  const e = eventsFor('gen_1');
  ingestEvents([e.started(assistant)]);
  for (let i = 0; i < 100; i++) ingestEvents([e.text(`${i % 10}`)]);
  expect(listener).toHaveBeenCalledTimes(0);
  expect(frames).toHaveLength(1);
  runFrame();
  expect(listener).toHaveBeenCalledTimes(1);
  expect(textOf(liveMessageFor('msg_a'))).toBe('0123456789'.repeat(10));
  unsubscribe();
});

test('deltas at or before the snapshot seq are dropped', () => {
  const e = eventsFor('gen_1');
  const snap = msg({ id: 'msg_a', status: 'streaming', parts: [{ type: 'text', text: 'Halo' }] });
  ingestEvents([e.snapshot(snap, 5), e.text(' lagi', 4), e.text('o', 5), e.text(' dunia', 6)]);
  flushEvents();
  expect(textOf(liveMessageFor('msg_a'))).toBe('Halo dunia');
});

test('a resume snapshot creates the generation and clears reconnecting', () => {
  const e = eventsFor('gen_1');
  ingestEvents([e.started(assistant), e.text('Ha')]);
  flushEvents();
  setReconnecting('gen_1', true);
  expect(getGenerationsState().byId.gen_1?.reconnecting).toBe(true);
  const snap = msg({ id: 'msg_a', status: 'streaming', parts: [{ type: 'text', text: 'Halo' }] });
  ingestEvents([e.snapshot(snap, 9)]);
  flushEvents();
  const live = getGenerationsState().byId.gen_1;
  expect(live?.reconnecting).toBe(false);
  expect(live?.conversationId).toBe('cnv_1');
  expect(textOf(live?.message)).toBe('Halo');
});

test('activity is tracked and reset when finished', () => {
  const e = eventsFor('gen_1');
  ingestEvents([e.started(assistant), e.activity('searching')]);
  flushEvents();
  expect(getGenerationsState().byId.gen_1?.activity).toBe('searching');
  ingestEvents([e.finished(msg({ id: 'msg_a', status: 'complete' }))]);
  flushEvents();
  expect(getGenerationsState().byId.gen_1?.activity).toBe('idle');
  expect(liveMessageFor('msg_a')?.status).toBe('complete');
});

test('an error event is a dropped stream: the message keeps streaming and reconnects', () => {
  const e = eventsFor('gen_1');
  ingestEvents([e.started(assistant), e.text('Ha')]);
  ingestEvents([
    { type: 'error', generationId: 'gen_1', seq: 0, code: 'internal', message: 'It broke.' },
  ]);
  flushEvents();
  const live = getGenerationsState().byId.gen_1;
  expect(live?.message.status).toBe('streaming');
  expect(live?.message.parts).toEqual([{ type: 'text', text: 'Ha' }]);
  expect(live?.reconnecting).toBe(true);
});

test('a lost generation stops reconnecting and is not streaming any more', () => {
  const e = eventsFor('gen_1');
  ingestEvents([e.started(assistant), e.text('Ha')]);
  flushEvents();
  setReconnecting('gen_1', true);
  markLost('gen_1');
  const live = getGenerationsState().byId.gen_1;
  expect(live?.lost).toBe(true);
  expect(live?.reconnecting).toBe(false);
  expect(textOf(live?.message)).toBe('Ha');
  // A snapshot means the connection is back.
  ingestEvents([e.snapshot(msg({ id: 'msg_a', status: 'streaming' }), 20)]);
  flushEvents();
  expect(getGenerationsState().byId.gen_1?.lost).toBe(false);
});

test('events for unknown generations are ignored; clearGeneration removes one', () => {
  const e = eventsFor('gen_x');
  ingestEvents([e.text('lost')]);
  flushEvents();
  expect(getGenerationsState().byId).toEqual({});
  const f = eventsFor('gen_1');
  ingestEvents([f.started(assistant)]);
  flushEvents();
  clearGeneration('gen_1');
  expect(liveMessageFor('msg_a')).toBeUndefined();
});

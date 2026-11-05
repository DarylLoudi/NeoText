import type { MessagePublic, StreamEvent } from '@neotext/shared';
import { useSyncExternalStore } from 'react';
import { applyStreamEvent } from '../features/chat/streaming/apply-event';

/** An answer being written right now, as this page has received it. */
export interface LiveGeneration {
  generationId: string;
  conversationId: string;
  message: MessagePublic;
  activity: 'searching' | 'processing' | 'idle';
  reconnecting: boolean;
  /** Reconnecting gave up: the text so far stays, with a note, until a refetch replaces it. */
  lost: boolean;
}

export interface GenerationsState {
  byId: Readonly<Record<string, LiveGeneration>>;
  /** The same generations keyed by their assistant message id. */
  byMessage: Readonly<Record<string, LiveGeneration>>;
}

let state: GenerationsState = { byId: {}, byMessage: {} };
/** The last applied `seq` per generation; a resume snapshot moves it to the snapshot's seq. */
const lastSeq = new Map<string, number>();
const listeners = new Set<() => void>();
let pending: StreamEvent[] = [];
let frame: number | null = null;

const schedule: (cb: () => void) => number = (cb) =>
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(cb)
    : (setTimeout(cb, 16) as unknown as number);

const unschedule = (id: number) => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id);
};

function commit(byId: Record<string, LiveGeneration>): void {
  const byMessage: Record<string, LiveGeneration> = {};
  for (const g of Object.values(byId)) byMessage[g.message.id] = g;
  state = { byId, byMessage };
  for (const fn of listeners) fn();
}

/** Applies one event to `byId` in place; returns whether anything changed. */
function applyOne(byId: Record<string, LiveGeneration>, e: StreamEvent): boolean {
  const id = e.generationId;
  const prev = byId[id];
  if (e.type === 'generation.started') {
    byId[id] = {
      generationId: id,
      conversationId: e.conversationId,
      message: e.assistantMessage,
      activity: 'idle',
      reconnecting: false,
      lost: false,
    };
    lastSeq.set(id, e.seq);
    return true;
  }
  if (e.type === 'generation.snapshot') {
    byId[id] = {
      generationId: id,
      conversationId: e.message.conversationId,
      activity: prev?.activity ?? 'idle',
      message: e.message,
      reconnecting: false,
      lost: false,
    };
    lastSeq.set(id, e.seq);
    return true;
  }
  if (!prev) return false;
  // The server's stream-failure `error` (seq 0) is never a repeat.
  if (e.type !== 'error') {
    if (e.seq <= (lastSeq.get(id) ?? -1)) return false;
    lastSeq.set(id, e.seq);
  }
  switch (e.type) {
    case 'activity':
      byId[id] = { ...prev, activity: e.kind };
      return true;
    case 'conversation.updated':
      return false;
    case 'error':
      // The answer stream failed after it began, but the generation may still be running:
      // the client resumes, and the snapshot or final message decides how it ended.
      if (prev.message.status !== 'streaming') return false;
      byId[id] = { ...prev, reconnecting: true };
      return true;
    case 'generation.finished':
      byId[id] = {
        ...prev,
        activity: 'idle',
        reconnecting: false,
        lost: false,
        message: e.message,
      };
      return true;
    default: {
      const message = applyStreamEvent(prev.message, e);
      if (message === prev.message) return false;
      byId[id] = { ...prev, message };
      return true;
    }
  }
}

/** Applies every queued event now, in order, with one notification. */
export function flushEvents(): void {
  if (frame !== null) {
    unschedule(frame);
    frame = null;
  }
  if (pending.length === 0) return;
  const events = pending;
  pending = [];
  const byId = { ...state.byId };
  let changed = false;
  for (const e of events) changed = applyOne(byId, e) || changed;
  if (changed) commit(byId);
}

/**
 * Queues stream events; they are applied in order on the next animation frame, so React
 * renders at most once per frame however fast tokens arrive.
 */
export function ingestEvents(events: StreamEvent[]): void {
  if (events.length === 0) return;
  pending.push(...events);
  if (frame === null) {
    frame = schedule(() => {
      frame = null;
      flushEvents();
    });
  }
}

export function setReconnecting(generationId: string, reconnecting: boolean): void {
  flushEvents();
  const prev = state.byId[generationId];
  if (!prev || prev.reconnecting === reconnecting) return;
  commit({ ...state.byId, [generationId]: { ...prev, reconnecting } });
}

/** Reconnecting gave up; the live text stays on screen with a note. */
export function markLost(generationId: string): void {
  flushEvents();
  const prev = state.byId[generationId];
  if (!prev || prev.lost) return;
  commit({ ...state.byId, [generationId]: { ...prev, reconnecting: false, lost: true } });
}

export function clearGeneration(generationId: string): void {
  flushEvents();
  lastSeq.delete(generationId);
  if (!state.byId[generationId]) return;
  const { [generationId]: _gone, ...rest } = state.byId;
  commit(rest);
}

export function liveMessageFor(assistantMessageId: string): MessagePublic | undefined {
  return state.byMessage[assistantMessageId]?.message;
}

export function getGenerationsState(): GenerationsState {
  return state;
}

export function subscribeGenerations(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The selector must return a stable value (a stored object, a primitive), as with any store. */
export function useGenerations<T>(selector: (s: GenerationsState) => T): T {
  return useSyncExternalStore(
    subscribeGenerations,
    () => selector(state),
    () => selector(state),
  );
}

/** For tests: forgets every generation and queued event. */
export function resetGenerations(): void {
  if (frame !== null) unschedule(frame);
  frame = null;
  pending = [];
  lastSeq.clear();
  state = { byId: {}, byMessage: {} };
  for (const fn of listeners) fn();
}

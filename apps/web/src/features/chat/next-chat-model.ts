import type { ModelRef } from '@neotext/shared';

let next: ModelRef | null = null;

/** Leaves the model a new chat should start with (read once by the new chat's view). */
export function setNextChatModel(ref: ModelRef | null): void {
  next = ref;
}

export function takeNextChatModel(): ModelRef | null {
  const ref = next;
  next = null;
  return ref;
}

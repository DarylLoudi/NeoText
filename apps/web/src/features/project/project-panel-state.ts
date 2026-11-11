import { useSyncExternalStore } from 'react';

/**
 * Whether the project panel is open, for which chat, and at which message. Tiny on purpose:
 * answers and code blocks import it to open the panel, and the panel itself loads lazily.
 */
export interface ProjectPanelState {
  open: boolean;
  conversationId: string | null;
  /** The message it was opened from; null follows the latest version. */
  messageId: string | null;
  /** Where focus goes back when the panel closes. */
  opener: HTMLElement | null;
}

const closed: ProjectPanelState = {
  open: false,
  conversationId: null,
  messageId: null,
  opener: null,
};
let state = closed;
const listeners = new Set<() => void>();

function set(next: ProjectPanelState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function openProjectPanel(conversationId: string, messageId: string | null): void {
  const active = document.activeElement;
  set({
    open: true,
    conversationId,
    messageId,
    opener: active instanceof HTMLElement ? active : null,
  });
}

export function closeProjectPanel(): void {
  const { opener } = state;
  set(closed);
  opener?.focus();
}

export function toggleProjectPanel(conversationId: string): void {
  if (state.open && state.conversationId === conversationId) closeProjectPanel();
  else openProjectPanel(conversationId, null);
}

export function getProjectPanel(): ProjectPanelState {
  return state;
}

export function useProjectPanel(): ProjectPanelState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

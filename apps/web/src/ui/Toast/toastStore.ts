export type ToastTone = 'neutral' | 'success' | 'danger';

export type ToastInput = {
  message: string;
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  durationMs?: number;
};

export type ToastItem = {
  id: string;
  message: string;
  tone: ToastTone;
  action?: ToastInput['action'];
};

const DEFAULT_MS = 5_000;
const ACTION_MS = 10_000;

let items: ToastItem[] = [];
let counter = 0;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const deadlines = new Map<string, number>();
const remaining = new Map<string, number>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts(): ToastItem[] {
  return items;
}

export function toast(input: ToastInput): string {
  counter += 1;
  const id = `toast-${counter}`;
  items = [
    ...items,
    { id, message: input.message, tone: input.tone ?? 'neutral', action: input.action },
  ];
  const ms = input.durationMs ?? (input.action ? ACTION_MS : DEFAULT_MS);
  startTimer(id, ms);
  emit();
  return id;
}

function startTimer(id: string, ms: number): void {
  deadlines.set(id, Date.now() + ms);
  timers.set(
    id,
    setTimeout(() => dismissToast(id), ms),
  );
}

/** Stop the auto-dismiss countdown (pointer or focus is on the toast). */
export function pauseToast(id: string): void {
  const timer = timers.get(id);
  const deadline = deadlines.get(id);
  if (timer === undefined || deadline === undefined) return;
  clearTimeout(timer);
  timers.delete(id);
  remaining.set(id, Math.max(deadline - Date.now(), 0));
}

/** Continue the countdown with the time that was left when it paused. */
export function resumeToast(id: string): void {
  const left = remaining.get(id);
  if (left === undefined || timers.has(id)) return;
  remaining.delete(id);
  startTimer(id, left);
}

export function dismissToast(id: string): void {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  deadlines.delete(id);
  remaining.delete(id);
  if (!items.some((t) => t.id === id)) return;
  items = items.filter((t) => t.id !== id);
  emit();
}

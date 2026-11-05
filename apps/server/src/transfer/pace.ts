/** About this much synchronous work runs before a long export or import lets other requests in. */
export const WORK_BUDGET_MS = 50;

/** Resolves on a later turn of the event loop, after pending I/O callbacks have run. */
export const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Called between steps of a long job: yields once `budgetMs` of work ran since the last yield. */
export type Pace = () => Promise<void>;

export function createPace(budgetMs = WORK_BUDGET_MS, now = () => performance.now()): Pace {
  let since = now();
  return async () => {
    if (now() - since < budgetMs) return;
    await yieldToEventLoop();
    since = now();
  };
}

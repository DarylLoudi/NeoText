export type Semaphore = <T>(fn: () => Promise<T>) => Promise<T>;

/** Returns a runner that executes at most `max` async functions at a time, in FIFO order. */
export function createSemaphore(max: number): Semaphore {
  let active = 0;
  const waiting: Array<() => void> = [];

  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active < max) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

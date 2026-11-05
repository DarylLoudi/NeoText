import { expect, test } from 'vitest';
import { createSemaphore } from './semaphore';

test('never runs more than max at once', async () => {
  const run = createSemaphore(2);
  let active = 0;
  let peak = 0;
  const task = async (n: number) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return n;
  };
  const results = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => run(() => task(n))));
  expect(results).toEqual([1, 2, 3, 4, 5, 6]);
  expect(peak).toBe(2);
});

test('releases the slot when a task throws', async () => {
  const run = createSemaphore(1);
  await expect(run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  await expect(run(async () => 'ok')).resolves.toBe('ok');
});

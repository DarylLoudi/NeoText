import { expect, test } from 'vitest';
import { createFakeClock } from '../lib/clock';
import { createRateLimiter } from './rate-limit';

test('allows max hits per window and reports retry time', () => {
  const clock = createFakeClock();
  const rl = createRateLimiter({ windowMs: 1000, max: 3, clock });
  for (let i = 0; i < 3; i++) expect(rl.hit('a').allowed).toBe(true);
  expect(rl.hit('a')).toEqual({ allowed: false, retryAfterMs: 1000 });
  expect(rl.hit('b').allowed).toBe(true);
  clock.advance(400);
  expect(rl.hit('a')).toEqual({ allowed: false, retryAfterMs: 600 });
  clock.advance(600);
  expect(rl.hit('a').allowed).toBe(true);
});

test('blocked hits do not extend the window', () => {
  const clock = createFakeClock();
  const rl = createRateLimiter({ windowMs: 1000, max: 1, clock });
  rl.hit('a');
  clock.advance(900);
  rl.hit('a');
  clock.advance(100);
  expect(rl.hit('a').allowed).toBe(true);
});

test('reset forgets a key', () => {
  const rl = createRateLimiter({ windowMs: 1000, max: 1, clock: createFakeClock() });
  rl.hit('a');
  expect(rl.hit('a').allowed).toBe(false);
  rl.reset('a');
  expect(rl.hit('a').allowed).toBe(true);
});

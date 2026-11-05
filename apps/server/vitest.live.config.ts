import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.live.test.ts'],
    setupFiles: ['test-support/live-env.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    disableConsoleIntercept: true,
  },
});

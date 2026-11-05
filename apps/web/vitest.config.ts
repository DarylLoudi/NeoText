import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'happy-dom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      passWithNoTests: true,
      // The suite runs on many workers at once; a slow import must not fail a test that is fine.
      testTimeout: 20_000,
      hookTimeout: 20_000,
    },
  }),
);

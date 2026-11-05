import { defineConfig, devices } from '@playwright/test';
import { APP_URL } from './e2e/support/ports';

const signedIn = 'e2e/.auth/state.json';

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  globalSetup: './e2e/support/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: APP_URL,
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
    locale: 'en-US',
  },
  projects: [
    // The first run on an empty server; everything after it signs in to the account it makes.
    {
      name: 'first-run',
      testMatch: 'first-run.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'session',
      testMatch: 'session.setup.ts',
      dependencies: ['first-run'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'app',
      testMatch: '*.spec.ts',
      testIgnore: 'first-run.spec.ts',
      dependencies: ['session'],
      use: { ...devices['Desktop Chrome'], storageState: signedIn },
    },
  ],
});

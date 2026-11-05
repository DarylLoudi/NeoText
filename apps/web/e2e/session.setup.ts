import { test as setup } from '@playwright/test';
import { account } from './support/control';

/** Signs in once through the API and keeps the cookie for every spec after the first run. */
setup('sign in', async ({ request }) => {
  const res = await request.post('/api/auth/login', { data: account });
  if (!res.ok()) throw new Error(`Sign-in failed: ${res.status()} ${await res.text()}`);
  await request.storageState({ path: 'e2e/.auth/state.json' });
});

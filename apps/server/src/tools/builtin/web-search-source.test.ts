import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  authContextFor,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../../test-support/test-app';

let t: TestApp;
let auth: ReturnType<typeof authContextFor>;
beforeEach(async () => {
  t = await createTestApp();
  auth = authContextFor(t, (await setupOwner(t)).cookie);
});
afterEach(() => t.close());

const names = async (webSearch: boolean) =>
  (await t.c.tools.forTurn(auth, { userText: 'hi', webSearch })).map((d) => d.name);

test('web_search is listed only with a chosen, enabled search backend; a turn gets it from its web search plan', async () => {
  expect(await names(true)).not.toContain('web_search');

  const llm = await t.c.providers.create(auth, {
    kind: 'openai-compatible',
    name: 'Local',
    baseUrl: 'http://127.0.0.1:9',
  });
  t.c.settings.patch(auth.userId, auth.dek, { webSearch: { backendProviderId: llm.id } });
  expect(await names(true)).not.toContain('web_search');

  const searx = await t.c.providers.create(auth, {
    kind: 'searxng',
    name: 'SearXNG',
    baseUrl: 'http://127.0.0.1:9',
  });
  t.c.settings.patch(auth.userId, auth.dek, { webSearch: { backendProviderId: searx.id } });
  expect(await names(true)).not.toContain('web_search');
  expect((await t.c.tools.list(auth)).map((d) => d.name)).toContain('web_search');

  await t.c.providers.update(auth, searx.id, { enabled: false });
  expect((await t.c.tools.list(auth)).map((d) => d.name)).not.toContain('web_search');
});

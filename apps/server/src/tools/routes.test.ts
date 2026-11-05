import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { authed, createTestApp, setupOwner, type TestApp } from '../../test-support/test-app';

let t: TestApp;
let api: ReturnType<typeof authed>;
const source = vi.fn(() => []);
beforeEach(async () => {
  t = await createTestApp();
  api = authed(t, (await setupOwner(t)).cookie);
  source.mockClear();
  // Stands in for MCP: listing it would connect to tool servers.
  t.c.tools.add(source);
});
afterEach(() => t.close());

test('only=meta answers without listing any tool source', async () => {
  const res = await api('/api/tools?only=meta');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ tools: [], webSearchBackend: false });
  expect(source).not.toHaveBeenCalled();
});

test('the full list asks every source', async () => {
  const body = (await (await api('/api/tools')).json()) as { tools: { name: string }[] };
  expect(source).toHaveBeenCalledTimes(1);
  expect(body.tools.map((x) => x.name)).toContain('fetch_url');
});

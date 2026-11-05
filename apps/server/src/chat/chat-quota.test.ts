import type { StreamEvent } from '@neotext/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { type MockProvider, startMockProvider } from '../../test-support/mock-provider';
import { readEvents } from '../../test-support/sse-client';
import { chunk, DONE, finish, usage } from '../../test-support/sse-frames';
import {
  addUser,
  authed,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';

let t: TestApp;
let mock: MockProvider;
let admin: ReturnType<typeof authed>;
let member: ReturnType<typeof authed>;
let memberId: string;
let sharedId: string;
let ownId: string;

const mk = async (api: typeof admin, extra: Record<string, unknown>) => {
  const res = await api('/api/providers', {
    method: 'POST',
    body: JSON.stringify({ kind: 'openai-compatible', baseUrl: mock.url, ...extra }),
  });
  const out = (await res.json()) as { provider: { id: string } };
  if (!out.provider) throw new Error(JSON.stringify(out));
  return out.provider.id;
};

beforeEach(async () => {
  t = await createTestApp();
  mock = await startMockProvider();
  mock.models = ['m1'];
  admin = authed(t, (await setupOwner(t, { mode: 'community' })).cookie);
  const sinta = await addUser(t, 'sinta', 'admin'); // admins may add the mock's private address
  member = authed(t, sinta.cookie);
  memberId = sinta.userId;
  sharedId = await mk(admin, { name: 'Lab', shared: true });
  ownId = await mk(member, { name: 'Mine' });
  await member('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ patch: { chat: { autoTitle: false } } }),
  });
});
afterEach(async () => {
  await t.close();
  await mock.close();
});

const chat = (providerId: string, key?: string) =>
  member('/api/chat', {
    method: 'POST',
    headers: key ? { 'Idempotency-Key': key } : {},
    body: JSON.stringify({
      conversationId: null,
      parentId: null,
      userMessage: { text: 'Hai' },
      targets: [{ providerId, modelId: 'm1' }],
      options: {},
    }),
  });
const costly = (cost: number) => [
  chunk({ content: 'Halo' }),
  finish('stop'),
  usage({ prompt_tokens: 12, completion_tokens: 5, total_tokens: 17, cost }),
  DONE,
];
const status = async (evs: Response) =>
  (
    (await readEvents(evs)).find((e) => e.type === 'generation.finished') as Extract<
      StreamEvent,
      { type: 'generation.finished' }
    >
  ).message.status;

test('limit reached blocks shared providers only', async () => {
  t.c.quotas.setForUser(memberId, { dailyUsd: 0.001, monthlyUsd: null });
  mock.enqueue({ frames: costly(0.002) });
  // The turn that crosses the limit still finishes.
  expect(await status(await chat(sharedId))).toBe('complete');
  const res = await chat(sharedId);
  expect(res.status).toBe(402);
  expect(((await res.json()) as { error: unknown }).error).toMatchObject({
    code: 'quota_exceeded',
    message:
      "You've used your daily budget on shared models ($0.001). It resets tomorrow (UTC). You can also add your own key in Settings → Providers.",
    details: { period: 'daily', amountUsd: 0.001 },
  });
  // The member's own provider is never limited.
  mock.enqueue({ frames: costly(0.5) });
  expect(await status(await chat(ownId))).toBe('complete');
  expect(mock.requests.filter((r) => r.path === '/v1/chat/completions')).toHaveLength(2);
});

test('the next day allows shared models again', async () => {
  t.c.quotas.setForUser(memberId, { dailyUsd: 0.001, monthlyUsd: null });
  mock.enqueue({ frames: costly(0.002) }, { frames: costly(0) });
  await readEvents(await chat(sharedId));
  expect((await chat(sharedId)).status).toBe(402);
  t.clock.advance(86_400_000);
  expect(await status(await chat(sharedId))).toBe('complete');
});

test('GET /api/usage/quota reports the status', async () => {
  t.c.quotas.setForUser(memberId, { dailyUsd: 1, monthlyUsd: null });
  mock.enqueue({ frames: costly(0.25) });
  await readEvents(await chat(sharedId));
  const res = await member('/api/usage/quota');
  expect(await res.json()).toEqual({
    dailyUsd: 1,
    monthlyUsd: null,
    dailySpent: 0.25,
    monthlySpent: 0.25,
    exhausted: false,
  });
});

test('admins set and clear a limit; members cannot', async () => {
  const put = (api: typeof admin, body: unknown) =>
    api(`/api/admin/quotas/${memberId}`, { method: 'PUT', body: JSON.stringify(body) });
  const budi = authed(t, (await addUser(t, 'budi')).cookie);
  expect((await put(budi, { quota: null })).status).toBe(403);
  const set = await put(admin, { quota: { dailyUsd: 2, monthlyUsd: 20 } });
  expect(await set.json()).toEqual({
    quota: { dailyUsd: 2, monthlyUsd: 20 },
    effective: { dailyUsd: 2, monthlyUsd: 20 },
  });
  expect((await put(admin, { quota: { dailyUsd: -1, monthlyUsd: null } })).status).toBe(400);
  await admin('/api/admin/instance', {
    method: 'PATCH',
    body: JSON.stringify({ defaultQuota: { dailyUsd: 1, monthlyUsd: null } }),
  });
  const cleared = await put(admin, { quota: null });
  expect(await cleared.json()).toEqual({
    quota: null,
    effective: { dailyUsd: 1, monthlyUsd: null },
  });
  expect((await admin('/api/admin/quotas/usr_nobody')).status).toBe(404);
  expect(
    ((await (await admin('/api/admin/instance')).json()) as { defaultQuota: unknown }).defaultQuota,
  ).toEqual({
    dailyUsd: 1,
    monthlyUsd: null,
  });
});

test('a title model on a shared provider is skipped once the shared quota is spent', async () => {
  const titleKey = 'sk-lab-title-0000000000';
  const keyed = await mk(admin, { name: 'Titles', shared: true, apiKey: titleKey });
  t.c.quotas.setForUser(memberId, { dailyUsd: 0.001, monthlyUsd: null });
  mock.enqueue({ frames: costly(0.002) });
  expect(await status(await chat(sharedId))).toBe('complete');
  await member('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      patch: { chat: { autoTitle: true, titleModel: { providerId: keyed, modelId: 'm1' } } },
    }),
  });
  mock.requests.length = 0;
  // A turn on the member's own provider: the title falls back to it, not to the shared one.
  expect(await status(await chat(ownId))).toBe('complete');
  const calls = mock.requests.filter((r) => r.path === '/v1/chat/completions');
  expect(calls).toHaveLength(2);
  for (const call of calls) expect(call.headers.authorization ?? '').not.toContain(titleKey);
});

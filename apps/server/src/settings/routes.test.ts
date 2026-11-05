import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { authed, createTestApp, setupOwner, type TestApp } from '../../test-support/test-app';

let t: TestApp;
let call: ReturnType<typeof authed>;

beforeEach(async () => {
  t = await createTestApp();
  const owner = await setupOwner(t);
  call = authed(t, owner.cookie);
});
afterEach(() => t.close());

const patch = (body: unknown) =>
  call('/api/settings', { method: 'PATCH', body: JSON.stringify(body) });

describe('settings routes', () => {
  test('settings need a session', async () => {
    const res = await t.app.request('/api/settings');
    expect(res.status).toBe(401);
  });

  test('PATCH returns the new version and GET reads it back', async () => {
    const res = await patch({ patch: { appearance: { theme: 'dark' } } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { version: number }).version).toBe(1);
    const got = (await (await call('/api/settings')).json()) as {
      version: number;
      settings: { appearance: { theme: string } };
      recovered: boolean;
    };
    expect(got.version).toBe(1);
    expect(got.settings.appearance.theme).toBe('dark');
    expect(got.recovered).toBe(false);
  });

  test('PATCH rejects a non-object patch', async () => {
    const res = await patch({ patch: [1] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'validation_failed',
    );
  });

  test('history and restore over HTTP', async () => {
    await patch({ patch: { appearance: { theme: 'dark' } } });
    t.clock.advance(60_000);
    await patch({ patch: { appearance: { theme: 'light' } } });
    const hist = (await (await call('/api/settings/history')).json()) as {
      items: { version: number; reason: string }[];
    };
    expect(hist.items).toEqual([expect.objectContaining({ version: 1, reason: 'autosave' })]);
    const restored = await call('/api/settings/restore', {
      method: 'POST',
      body: JSON.stringify({ version: 1 }),
    });
    expect(restored.status).toBe(200);
    const body = (await restored.json()) as {
      version: number;
      settings: { appearance: { theme: string } };
    };
    expect(body.version).toBe(3);
    expect(body.settings.appearance.theme).toBe('dark');
    const missing = await call('/api/settings/restore', {
      method: 'POST',
      body: JSON.stringify({ version: 99 }),
    });
    expect(missing.status).toBe(404);
  });
});

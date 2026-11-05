import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { addUser } from '../../test-support/test-app';
import { auditEvents } from '../db/schema';
import { auth, chatgpt, cookie, PW, seed, t, useImportApp } from './import-test-support';

useImportApp();

describe('POST /api/import', () => {
  const upload = (form: FormData, c = cookie) =>
    t.app.request('/api/import', {
      method: 'POST',
      body: form,
      headers: { cookie: c, origin: 'http://localhost:3420' },
    });
  const form = (fields: Record<string, string | Blob>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    return f;
  };

  test('imports an upload and audits counts only', async () => {
    const res = await upload(
      form({ source: 'chatgpt', file: new Blob([new Uint8Array(chatgpt)]) }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ imported: 1, skipped: 0, failed: [] });
    const events = t.c.db.orm
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.kind, 'data.imported'))
      .all();
    expect(events).toHaveLength(1);
    expect(events[0]?.meta).toEqual({
      source: 'chatgpt',
      imported: 1,
      skipped: 0,
      failed: 0,
      error: false,
    });
  });

  test('malformed requests are a 400 naming what was expected', async () => {
    const noFile = await upload(form({ source: 'chatgpt' }));
    expect(noFile.status).toBe(400);
    expect(((await noFile.json()) as { error: { message: string } }).error.message).toMatch(
      /file/i,
    );
    const badSource = await upload(form({ source: 'gemini', file: new Blob(['[]']) }));
    expect(badSource.status).toBe(400);
    const garbage = await upload(form({ source: 'chatgpt', file: new Blob(['{}']) }));
    expect(garbage.status).toBe(400);
    expect(((await garbage.json()) as { error: { message: string } }).error.message).toMatch(
      /conversations\.json/,
    );
    const json = await t.app.request('/api/import', {
      method: 'POST',
      body: '{}',
      headers: { cookie, origin: 'http://localhost:3420', 'content-type': 'application/json' },
    });
    expect(json.status).toBe(415);
  });

  test('a NeoText upload with its passphrase and settings flag', async () => {
    t.c.settings.patch(auth.userId, auth.dek, { locale: 'id' });
    seed(auth, 'Satu');
    const file = (await t.c.exporter.exportData(auth, { format: 'neotext', passphrase: PW })).data;
    const other = await addUser(t, 'tamu');
    const res = await upload(
      form({
        source: 'neotext',
        file: new Blob([new Uint8Array(file)]),
        passphrase: PW,
        restoreSettings: 'true',
      }),
      other.cookie,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imported: 1 });
    expect(t.c.settings.get(other.auth.userId, other.auth.dek).settings.locale).toBe('id');
  });

  test('the rate limit is checked before the upload is read', async () => {
    const spy = vi.spyOn(t.c.importer, 'importData');
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      // No source: these would be a 400 once read, but they count against the limit first.
      codes.push((await upload(form({ file: new Blob(['[]']) }))).status);
    }
    expect(codes).toEqual([400, 400, 400, 400, 400, 429]);
    expect(spy).not.toHaveBeenCalled();
  });

  test('one import per user at a time', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi.spyOn(t.c.importer, 'importData').mockImplementation(async () => {
      await gate;
      return { imported: 0, skipped: 0, failed: [] };
    });
    const first = upload(form({ source: 'chatgpt', file: new Blob(['[]']) }));
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const second = await upload(form({ source: 'chatgpt', file: new Blob(['[]']) }));
    expect(second.status).toBe(429);
    expect(await second.json()).toMatchObject({
      error: { code: 'rate_limited', details: { reason: 'import_running' } },
    });
    // Another user is not held up by it.
    const other = await addUser(t, 'tamu');
    const theirs = upload(form({ source: 'chatgpt', file: new Blob(['[]']) }), other.cookie);
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    release();
    expect((await theirs).status).toBe(200);
    expect((await first).status).toBe(200);
    // The guard is released afterwards, also when an import fails.
    spy.mockRejectedValueOnce(new Error('boom'));
    expect((await upload(form({ source: 'chatgpt', file: new Blob(['[]']) }))).status).toBe(500);
    spy.mockResolvedValueOnce({ imported: 0, skipped: 0, failed: [] });
    expect((await upload(form({ source: 'chatgpt', file: new Blob(['[]']) }))).status).toBe(200);
  });

  test('at most two imports run on the server at once', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi.spyOn(t.c.importer, 'importData').mockImplementation(async () => {
      await gate;
      return { imported: 0, skipped: 0, failed: [] };
    });
    const send = (c: string) => upload(form({ source: 'chatgpt', file: new Blob(['[]']) }), c);
    const [a, b, c] = [await addUser(t, 'satu'), await addUser(t, 'dua'), await addUser(t, 'tiga')];
    const running = [send(a.cookie), send(b.cookie)];
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    const third = await send(c.cookie);
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ error: { details: { reason: 'import_busy' } } });
    release();
    expect((await Promise.all(running)).map((r) => r.status)).toEqual([200, 200]);
    // The slots are given back when the imports end.
    expect((await send(c.cookie)).status).toBe(200);
  });

  test('a request turned away as busy does not use up the rate limit', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi.spyOn(t.c.importer, 'importData').mockImplementationOnce(async () => {
      await gate;
      return { imported: 0, skipped: 0, failed: [] };
    });
    const send = () => upload(form({ source: 'chatgpt', file: new Blob(['[]']) }));
    const first = send();
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 6; i++) {
      const busy = await send();
      expect(await busy.json()).toMatchObject({ error: { details: { reason: 'import_running' } } });
    }
    release();
    expect((await first).status).toBe(200);
    spy.mockResolvedValue({ imported: 0, skipped: 0, failed: [] });
    // Only the one import that started counted: four more of the five fit.
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await send()).status);
    expect(codes).toEqual([200, 200, 200, 200, 429]);
  });

  test('import needs a session', async () => {
    const res = await t.app.request('/api/import', {
      method: 'POST',
      body: form({ source: 'chatgpt', file: new Blob(['[]']) }),
      headers: { origin: 'http://localhost:3420' },
    });
    expect(res.status).toBe(401);
  });
});

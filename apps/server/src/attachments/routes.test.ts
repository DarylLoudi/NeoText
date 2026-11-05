import type { AttachmentPublic } from '@neotext/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { PDF_BYTES, PNG_BYTES } from '../../test-support/attachment-bytes';
import { addUser, createTestApp, setupOwner, type TestApp } from '../../test-support/test-app';

let t: TestApp;
let cookie: string;

beforeEach(async () => {
  t = await createTestApp();
  cookie = (await setupOwner(t)).cookie;
});
afterEach(() => t.close());

const ORIGIN = 'http://localhost:3420';

function post(form: FormData | string, as = cookie, headers: Record<string, string> = {}) {
  return t.app.request('/api/attachments', {
    method: 'POST',
    body: form,
    headers: { cookie: as, origin: ORIGIN, ...headers },
  });
}
const formWith = (bytes: Buffer, name: string, type: string) => {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes)], name, { type }));
  return form;
};
const get = (id: string, as = cookie) =>
  t.app.request(`/api/attachments/${id}`, { headers: { cookie: as, origin: ORIGIN } });

test('requires a session', async () => {
  const res = await t.app.request('/api/attachments', {
    method: 'POST',
    body: formWith(PNG_BYTES, 'a.png', 'image/png'),
    headers: { origin: ORIGIN },
  });
  expect(res.status).toBe(401);
});

test('uploads and serves an image inline', async () => {
  const res = await post(formWith(PNG_BYTES, 'cat.png', 'image/png'));
  expect(res.status).toBe(201);
  const att = (await res.json()) as AttachmentPublic;
  expect(att).toMatchObject({ name: 'cat.png', mime: 'image/png', size: PNG_BYTES.length });
  const served = await get(att.id);
  expect(served.status).toBe(200);
  expect(served.headers.get('content-type')).toBe('image/png');
  expect(served.headers.get('content-disposition')).toMatch(/^inline/);
  expect(Buffer.from(await served.arrayBuffer()).equals(PNG_BYTES)).toBe(true);
});

test('response headers keep files inert', async () => {
  const att = (await (
    await post(formWith(PDF_BYTES, 'report "final".pdf', 'application/pdf'))
  ).json()) as AttachmentPublic;
  const res = await get(att.id);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('application/pdf');
  const disposition = res.headers.get('content-disposition') ?? '';
  expect(disposition).toMatch(/^attachment;/);
  expect(disposition).not.toContain('"final"');
  expect(disposition).toContain("filename*=UTF-8''report%20%22final%22.pdf");
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
  // Revalidated on every use, so decrypted bytes do not sit in the disk cache for a day.
  expect(res.headers.get('cache-control')).toBe('private, no-cache');
  expect(res.headers.get('etag')).toMatch(/^"[\w-]{32}"$/);
});

test('a matching If-None-Match is a 304 without the file; the tag names no secret', async () => {
  const att = (await (
    await post(formWith(PNG_BYTES, 'cat.png', 'image/png'))
  ).json()) as AttachmentPublic;
  const first = await get(att.id);
  const etag = first.headers.get('etag') ?? '';
  expect(etag).not.toBe('');
  expect(etag).not.toContain(att.id);
  const again = (inm: string) =>
    t.app.request(`/api/attachments/${att.id}`, {
      headers: { cookie, origin: ORIGIN, 'if-none-match': inm },
    });
  const cached = await again(etag);
  expect(cached.status).toBe(304);
  expect(cached.headers.get('etag')).toBe(etag);
  expect(cached.headers.get('cache-control')).toBe('private, no-cache');
  expect((await cached.arrayBuffer()).byteLength).toBe(0);
  expect((await again(`"other", W/${etag}`)).status).toBe(304);
  const stale = await again('"something-else"');
  expect(stale.status).toBe(200);
  expect(Buffer.from(await stale.arrayBuffer()).equals(PNG_BYTES)).toBe(true);
  // Another upload of the same bytes gets its own tag.
  const copy = (await (
    await post(formWith(PNG_BYTES, 'cat.png', 'image/png'))
  ).json()) as AttachmentPublic;
  expect((await get(copy.id)).headers.get('etag')).not.toBe(etag);
  // Someone else's file is still a 404, tag or not.
  const other = await addUser(t, 'tamu');
  const theirs = await t.app.request(`/api/attachments/${att.id}`, {
    headers: { cookie: other.cookie, origin: ORIGIN, 'if-none-match': etag },
  });
  expect(theirs.status).toBe(404);
});

test('text files download with a plain text type', async () => {
  const att = (await (
    await post(formWith(Buffer.from('<script>alert(1)</script>'), 'x.html', 'text/html'))
  ).json()) as AttachmentPublic;
  const res = await get(att.id);
  expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
});

test('other users get 404', async () => {
  const att = (await (
    await post(formWith(PNG_BYTES, 'cat.png', 'image/png'))
  ).json()) as AttachmentPublic;
  const other = await addUser(t, 'mallory');
  expect((await get(att.id, other.cookie)).status).toBe(404);
  expect((await get('att_missing')).status).toBe(404);
});

test('content that does not match its type is 415', async () => {
  const res = await post(formWith(Buffer.from('<html>hi</html>'), 'cat.png', 'image/png'));
  expect(res.status).toBe(415);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
    'unsupported_media_type',
  );
});

test('a request without a file is 400', async () => {
  const form = new FormData();
  form.append('other', 'x');
  expect((await post(form)).status).toBe(400);
  const json = await post('{"a":1}', cookie, { 'content-type': 'application/json' });
  expect(json.status).toBe(400);
});

test('a body over the route limit is 413', async () => {
  const big = Buffer.alloc(26 * 1024 * 1024, 0x61);
  const res = await post(formWith(big, 'big.txt', 'text/plain'));
  expect(res.status).toBe(413);
});

test('uploads stop at the per-user storage cap, with a reason the web can word', async () => {
  const small = await createTestApp({ env: { NEOTEXT_ATTACHMENT_QUOTA_MB: '1' } });
  try {
    const owner = (await setupOwner(small)).cookie;
    const send = (bytes: Buffer) =>
      small.app.request('/api/attachments', {
        method: 'POST',
        body: formWith(bytes, 'notes.txt', 'text/plain'),
        headers: { cookie: owner, origin: ORIGIN },
      });
    const text = Buffer.alloc(600 * 1024, 0x61);
    expect((await send(text)).status).toBe(201);
    const over = await send(text);
    expect(over.status).toBe(413);
    expect(await over.json()).toMatchObject({
      error: { code: 'payload_too_large', details: { reason: 'attachment_quota', limitMb: 1 } },
    });
    // What is left still fits; once full, any upload is turned away before it is read.
    expect((await send(Buffer.alloc(424 * 1024, 0x62))).status).toBe(201);
    const full = await send(Buffer.from('a'));
    expect(full.status).toBe(413);
    // Another user has their own allowance.
    const other = await addUser(small, 'tamu');
    const theirs = await small.app.request('/api/attachments', {
      method: 'POST',
      body: formWith(text, 'notes.txt', 'text/plain'),
      headers: { cookie: other.cookie, origin: ORIGIN },
    });
    expect(theirs.status).toBe(201);
  } finally {
    await small.close();
  }
});

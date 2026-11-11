import { afterEach, beforeEach, expect, test } from 'vitest';
import { createTestApp, type TestApp } from '../../test-support/test-app';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const CSP =
  "sandbox allow-scripts allow-forms allow-modals; default-src 'none'; script-src 'unsafe-inline' blob: data:; style-src 'unsafe-inline' blob:; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'";

test('the shell is served to anyone with its own sandboxing, offline policy', async () => {
  const res = await t.app.request('/preview-frame');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/html');
  // The app-wide policy must not replace this one.
  expect(res.headers.get('content-security-policy')).toBe(CSP);
  expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('permissions-policy')).toBe(
    'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=(), usb=(), payment=()',
  );
});

test('the shell says it is ready and loads only what its parent sends', async () => {
  const body = await (await t.app.request('/preview-frame')).text();
  expect(body).toContain('nt-preview-ready');
  expect(body).toContain('nt-preview-load');
  expect(body).toContain('event.source !== parent');
  expect(body).toContain('document.write');
});

test('paths below the shell get the same shell, so a page moving itself stays in the preview', async () => {
  for (const path of [
    '/preview-frame/',
    '/preview-frame/index.html',
    '/preview-frame/pages/a.html',
  ]) {
    const res = await t.app.request(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe(CSP);
    const body = await res.text();
    expect(body).toContain('nt-preview-ready');
    // It tells the app which page it was asked for.
    expect(body).toContain('location.pathname');
  }
});

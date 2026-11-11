import { expect, type Request, test } from '@playwright/test';
import { resetState } from './support/api';
import { enqueue } from './support/control';
import { CONTROL_URL } from './support/ports';

test.beforeEach(async ({ request }) => {
  await resetState(request);
});

const LEAK = `${CONTROL_URL}/leak`;

/** A page that tries every way out it can think of, and logs what happened. */
const PROBE = `<!doctype html>
<html>
<body>
<p>probe</p>
<a id="out" href="${LEAK}?link">Out</a>
<script>
const attempt = (name, fn) => {
  try { fn(); console.log(name + ': no error'); } catch (e) { console.log(name + ': ' + e.name); }
};
fetch('${LEAK}?fetch').then(() => console.log('fetch: reached'), (e) => console.log('fetch: ' + e.name));
attempt('image', () => { new Image().src = '${LEAK}?img'; });
attempt('beacon', () => navigator.sendBeacon('${LEAK}?beacon', 'x'));
attempt('rtc', () => new RTCPeerConnection());
const child = document.createElement('iframe');
document.body.append(child);
attempt('rtc-child', () => new child.contentWindow.RTCPeerConnection());
attempt('rtc-child-doc', () => new child.contentDocument.defaultView.RTCPeerConnection());
addEventListener('message', (e) => {
  if (e.data && e.data.rtcProbe) console.log('srcdoc rtc: ' + e.data.rtcProbe);
});
const inner = document.createElement('iframe');
inner.srcdoc = '<script>let r; try { new RTCPeerConnection(); r = "made"; } catch (e) { r = e.name; } parent.postMessage({ rtcProbe: r }, "*");<\\/script>';
document.body.append(inner);
attempt('open', () => console.log('open returned ' + window.open('${LEAK}?open')));
let cookie;
try { cookie = 'cookie read: [' + document.cookie + ']'; } catch (e) { cookie = 'cookie blocked: ' + e.name; }
console.log(cookie);
const style = document.createElement('style');
style.textContent = 'body { background: url(${LEAK}?css); }';
document.head.append(style);
setTimeout(() => { location.href = '${LEAK}?nav'; }, 300);
console.log('probe done');
</script>
</body>
</html>`;

test('a preview page cannot reach the network or read the app', async ({ page, request }) => {
  // Chromium reports a request the CSP stopped and then fails it with "csp"; one that got an
  // answer, or failed for any other reason, went out.
  const answered: string[] = [];
  const failedOtherwise: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/leak')) answered.push(r.url());
  });
  page.on('requestfailed', (r: Request) => {
    if (r.url().includes('/leak') && r.failure()?.errorText !== 'csp') {
      failedOtherwise.push(`${r.url()} ${r.failure()?.errorText}`);
    }
  });
  await enqueue(
    request,
    {
      chunks: [],
      toolCalls: [
        {
          id: 'p1',
          name: 'write_file',
          arguments: JSON.stringify({ path: 'index.html', content: PROBE }),
        },
      ],
    },
    { chunks: ['Probe written.'] },
  );
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Message' }).fill('Write the probe');
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
  const thread = page.getByRole('main');
  await expect(thread.getByText('Probe written.')).toBeVisible();
  await thread.getByRole('button', { name: 'Open preview' }).click();

  const panel = page.getByRole('complementary', { name: 'Preview' });
  const frame = page.frameLocator('iframe[title="Preview of index.html"]');
  await expect(frame.getByText('probe')).toBeVisible();
  await frame.getByRole('link', { name: 'Out' }).click();
  await panel.getByText('Console').click();
  await expect(panel.getByText('probe done')).toBeVisible();
  await expect(panel.getByText('cookie blocked: SecurityError')).toBeVisible();
  await expect(panel.getByText('rtc: Error')).toBeVisible();
  // A frame the page adds is its own opaque origin: the page cannot reach its constructors.
  await expect(panel.getByText('rtc-child: SecurityError')).toBeVisible();
  await expect(panel.getByText('rtc-child-doc: TypeError')).toBeVisible();
  // A srcdoc frame would run its own scripts with the real WebRTC: frames are taken out first.
  await expect(panel.getByText('Frames are not available in the preview.')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(panel.getByText(/^srcdoc rtc:/)).toHaveCount(0);
  await expect(panel.getByText(/fetch: TypeError/)).toBeVisible();
  await expect(panel.getByText('Not loaded, the preview is offline:')).toBeVisible();
  // Give the delayed navigation time to be tried: the frame may end on the browser's error
  // page, never on the outside address.
  await page.waitForTimeout(1500);
  expect(answered).toEqual([]);
  expect(failedOtherwise).toEqual([]);
  expect(page.frames().some((f) => f.url().includes('/leak'))).toBe(false);
});

test('the shell opened on its own still runs in an opaque origin', async ({ page }) => {
  await page.goto('/preview-frame');
  expect(await page.evaluate(() => self.origin)).toBe('null');
});

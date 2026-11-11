// Takes the screenshots used in README.md, at 1440x900, into assets/screenshots.
//
// It starts the same server the browser tests use (apps/web/e2e/support/e2e-server.ts: the real
// app on port 3421 with mock model providers, so nothing leaves this machine and no key is
// needed), fills an account with a few chats, and photographs the app.
//
//   npm run build -w @neotext/web
//   node scripts/capture-screenshots.mjs
//
// Ports 3421 and 3422 must be free (the browser tests use them too).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'docs', 'images');
const APP = 'http://localhost:3421';
const CONTROL = 'http://127.0.0.1:3422';
const ACCOUNT = { username: 'ada', password: 'correct horse battery staple' };
const FLASH = 'deepseek/deepseek-v4.1-flash';
const HAIKU = 'anthropic/claude-haiku-5.5';
const SIZE = { width: 1440, height: 900 };

if (!existsSync(join(ROOT, 'apps', 'web', 'dist', 'index.html'))) {
  throw new Error('Build the web app first: npm run build -w @neotext/web');
}
mkdirSync(OUT, { recursive: true });

/** The server the e2e suite uses, started the way Playwright's global setup starts it. */
async function startHarness() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => k !== 'OPENROUTER_API_KEY' && !k.startsWith('NEOTEXT_'),
    ),
  );
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', join('apps', 'web', 'e2e', 'support', 'e2e-server.ts')],
    { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], env: { ...env, NEOTEXT_E2E_HARNESS: '1' } },
  );
  let stderr = '';
  child.stderr.on('data', (part) => {
    stderr += part;
  });
  await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('The server did not start in 60s.')), 60_000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      fail(new Error(`The server exited with code ${code}. ${stderr}`));
    });
    let seen = '';
    child.stdout.on('data', (part) => {
      seen += part;
      if (seen.includes('e2e-ready')) {
        clearTimeout(timer);
        done();
      }
    });
  });
  child.stdout.resume();
  return child;
}

async function stopHarness(child) {
  try {
    await fetch(`${CONTROL}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(3000) });
  } catch {
    // Already gone, or the kill below handles it.
  }
  if (child.exitCode === null && child.signalCode === null) {
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    await new Promise((done) => child.once('exit', done));
    clearTimeout(timer);
  }
}

const control = async (route, data) => {
  const res = await fetch(`${CONTROL}${route}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`${route} failed: ${res.status} ${await res.text()}`);
  return res.json();
};

const THESIS_ANSWER = [
  'Here is a structure for chapter 2 that follows your question about caching.\n\n',
  '1. **Background**: why web caches exist, and what they trade away.\n',
  '2. **Related work**: HTTP caching, CDNs and in-memory stores, with one paragraph each.\n',
  '3. **Method**: how you measured hit rate and latency.\n\n',
  'A small helper for the measurement section:\n\n',
  '```ts\nexport function hitRate(hits: number, misses: number): number {\n',
  '  const total = hits + misses;\n  return total === 0 ? 0 : hits / total;\n}\n```\n\n',
  'Start with the background section. Everything else builds on how you define a *hit*.',
];

async function main() {
  const harness = await startHarness();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: SIZE,
      deviceScaleFactor: 1,
      baseURL: APP,
      locale: 'en-US',
      reducedMotion: 'reduce',
    });
    const api = context.request;
    const send = async (method, url, data) => {
      const res = await api.fetch(url, {
        method,
        headers: { origin: APP },
        ...(data === undefined ? {} : { data }),
      });
      if (!res.ok()) throw new Error(`${method} ${url}: ${res.status()} ${await res.text()}`);
      return res.status() === 204 ? null : res.json();
    };

    // An owner, signed in; the cookie lands in the browser context.
    await send('POST', '/api/setup', { ...ACCOUNT, mode: 'personal' });
    const orUrl = (await control('/openrouter-url')).url;
    const provider = await send('POST', '/api/providers', {
      kind: 'openrouter',
      name: 'OpenRouter',
      baseUrl: orUrl,
      apiKey: 'sk-or-screenshots-not-a-real-key',
    });
    const model = { providerId: provider.provider.id, modelId: FLASH };
    const settings = (patch) => send('PATCH', '/api/settings', { patch });
    await settings({
      appearance: { theme: 'light' },
      chat: { defaultModel: model, autoTitle: false },
      webSearch: { defaultOn: false },
    });

    // A sidebar that looks lived in: a folder, pinned chats, recent chats.
    const folder = await send('POST', '/api/folders', { name: 'Thesis', position: 'a0' });
    const chat = async (title, patch = {}) => {
      const made = await send('POST', '/api/conversations', { title });
      if (Object.keys(patch).length > 0)
        await send('PATCH', `/api/conversations/${made.id}`, patch);
      return made.id;
    };
    await chat('Lab notes: week 6', { pinned: true });
    await chat('Reading list for statistics', { pinned: true });
    await chat('Related work on web caches', { folderId: folder.id });
    await chat('Thesis timeline');
    await chat('Explain p-values simply');
    await chat('Translate abstract to Indonesian');
    await chat('Budget for the poster printing');

    const page = await context.newPage();
    // Source cards ask for site icons; there is no public host to ask here.
    await page.route('**/api/favicon**', (route) => route.fulfill({ status: 404 }));
    const box = page.getByRole('textbox', { name: 'Message' });
    const settle = async () => {
      // No hover or focus ring left over from the clicks before.
      await page.mouse.move(1000, 640);
      await page.evaluate(() => document.activeElement?.blur());
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
    };
    const shot = async (name) => {
      await settle();
      await page.screenshot({ path: join(OUT, name), type: 'png' });
      console.log(`wrote assets/screenshots/${name}`);
    };

    // 1. A chat in light and dark.
    await control('/enqueue', {
      provider: 'openrouter',
      // A small pause between pieces, so the answer shows a believable time.
      scripts: [{ chunks: THESIS_ANSWER, chunkDelayMs: 220 }],
    });
    await page.goto('/');
    await box.fill('Can you outline chapter 2 of my thesis on web caching?');
    await box.press('Enter');
    const thread = page.getByRole('main');
    await thread.getByText('Start with the background section').waitFor();
    await page.getByRole('button', { name: 'Send message' }).waitFor();
    const chatId = new URL(page.url()).pathname.split('/').at(-1);
    await send('PATCH', `/api/conversations/${chatId}`, { title: 'Thesis outline help' });
    await page.reload();
    await thread.getByText('Start with the background section').waitFor();
    await shot('chat-light.png');
    await settings({ appearance: { theme: 'dark' } });
    await page.reload();
    await thread.getByText('Start with the background section').waitFor();
    await shot('chat-dark.png');
    await settings({ appearance: { theme: 'light' } });

    // 2. An answer with web search, citations and the source cards.
    const extra = [
      ['BTC price chart', 'coinwatch.example', 'Live chart and 24-hour range.'],
      ['Bitcoin market report', 'ledgerdaily.example', 'Daily summary of the major coins.'],
      ['What moved bitcoin this week', 'marketnotes.example', 'A short note on the week.'],
      ['Exchange rates and fees', 'ratecompare.example', 'Compares rates across exchanges.'],
      ['Bitcoin explained', 'learn.example', 'A plain introduction for new readers.'],
    ].map(([title, host, content]) => ({ url: `https://${host}/btc`, title, content }));
    await control('/enqueue-fixture', {
      name: 'openrouter-search',
      citations: extra,
      processingDelayMs: 2500,
    });
    await page.goto('/');
    await box.fill('What is the bitcoin price today?');
    await box.press('Enter');
    await thread.getByText('Bitcoin is about $78,188 today').waitFor();
    await thread.getByRole('region', { name: 'Sources' }).waitFor();
    await page.getByRole('button', { name: 'Send message' }).waitFor();
    await send('PATCH', `/api/conversations/${new URL(page.url()).pathname.split('/').at(-1)}`, {
      title: 'Bitcoin price today',
    });
    await page.reload();
    await thread.getByRole('region', { name: 'Sources' }).waitFor();
    await shot('sources.png');

    // 3. Two models answering the same question.
    await control('/enqueue', {
      provider: 'openrouter',
      scripts: [
        {
          model: FLASH,
          chunkDelayMs: 200,
          chunks: [
            'Use a **log-structured** layout.\n\n',
            '- Append writes, never update in place.\n',
            '- Compact in the background.\n',
            '- Keep an in-memory index for reads.\n\n',
            'It is simple and fast, and recovery is just a replay of the log.',
          ],
        },
        {
          model: HAIKU,
          chunkDelayMs: 160,
          chunks: [
            'I would start with a **B-tree**.\n\n',
            '- Reads and writes stay predictable.\n',
            '- Range queries are cheap.\n',
            '- Every database course explains it well.\n\n',
            'Move to a log-structured design only if writes become the bottleneck.',
          ],
        },
      ],
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await page.getByRole('button', { name: 'Add a model' }).click();
    const picker = page.getByRole('dialog', { name: 'Models to compare' });
    await picker.getByRole('option', { name: /Claude Haiku 5\.5/ }).click();
    await page.keyboard.press('Escape');
    await box.fill('Which storage layout should I pick for my small key-value store?');
    await box.press('Enter');
    const columns = page.getByRole('group', { name: '2 answers side by side' });
    await columns.getByText('Move to a log-structured design only if').waitFor();
    await columns.getByText('recovery is just a replay of the log').waitFor();
    await page.getByRole('button', { name: 'Send message' }).waitFor();
    // Rename it from the sidebar, as a person would.
    const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
    const row = sidebar
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: 'New chat', exact: true }) });
    await row.hover();
    await row.getByRole('button', { name: 'Options for New chat' }).click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    const field = sidebar.getByRole('textbox', { name: 'Chat title' });
    await field.fill('Key-value store design');
    await field.press('Enter');
    await sidebar.getByRole('link', { name: 'Key-value store design' }).waitFor();
    await shot('compare.png');

    // 4. A sidebar arranged by its owner: on the right, mint accent, a smart section.
    await settings({
      appearance: { accent: 'mint', density: 'compact' },
      sidebar: {
        position: 'right',
        sections: [
          { id: 'pinned', kind: 'pinned', visible: true, collapsed: false },
          {
            id: 'smart-thesis',
            kind: 'smart',
            title: 'Thesis work',
            visible: true,
            collapsed: false,
            filter: { titleContains: 'thesis' },
          },
          { id: 'folders', kind: 'folders', visible: true, collapsed: false },
          { id: 'recent', kind: 'recent', visible: true, collapsed: false, groupBy: 'date' },
          { id: 'presets', kind: 'presets', visible: false, collapsed: false },
          { id: 'archived', kind: 'archived', visible: false, collapsed: false },
        ],
      },
    });
    await page.goto(`/c/${chatId}`);
    await thread.getByText('Start with the background section').waitFor();
    await page.getByRole('complementary', { name: 'Sidebar' }).getByText('Thesis work').waitFor();
    await page
      .getByRole('complementary', { name: 'Sidebar' })
      .getByRole('button', { name: 'Thesis', exact: true })
      .click();
    await shot('sidebar-custom.png');
  } finally {
    await browser.close();
    await stopHarness(harness);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

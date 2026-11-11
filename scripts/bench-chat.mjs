// Measures the server's own share of chat latency against its budgets, on the real
// server (a child process, production settings and Argon2 parameters) and a mock provider in
// this process, so both ends of every measurement read the same clock:
//   sendToUpstreamMs  POST /api/chat sent here → the mock receives the provider request (≤ 15 ms p95)
//   overheadMs        the mock writes its first token → this client reads it (≤ 30 ms p95)
//   login             one sign-in with Argon2id 64 MiB, t=2 (≤ 600 ms, slowest of 5)
// PERF_SLACK multiplies every budget (default 1; CI uses 2). Exit code 1 when one is missed.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const ROOT = resolve(import.meta.dirname, '..');
const TURNS = 50;
const WARMUP = 3;
const LOGINS = 5;
const SLACK = Number(process.env.PERF_SLACK) || 1;
const BUDGETS = { sendToUpstreamMs: 15, overheadMs: 30, loginMs: 600 };
const PASSWORD = 'correct horse battery staple';
const TOKEN = 'bench-first-token';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
const delta = (content) =>
  frame({ id: 'gen-bench', choices: [{ index: 0, delta: { content }, finish_reason: null }] });

function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close((err) => (err ? reject(err) : resolvePort(port)));
    });
  });
}

/** An OpenAI-compatible mock that timestamps each chat request and its first token. */
async function startMock() {
  const turns = [];
  const server = http.createServer((req, res) => {
    const receivedAt = performance.now();
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'bench/model' }] }));
        return;
      }
      if (req.method !== 'POST' || !req.url?.startsWith('/v1/chat/completions')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.flushHeaders();
      const turn = { receivedAt, firstTokenAt: performance.now() };
      res.write(delta(TOKEN));
      turns.push(turn);
      res.write(delta(' and the rest of the answer.'));
      res.write(
        frame({ id: 'gen-bench', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      );
      res.end('data: [DONE]\n\n');
    });
  });
  server.keepAliveTimeout = 60_000;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const close = () => {
    server.closeAllConnections();
    return new Promise((r) => server.close(() => r()));
  };
  return { url: `http://127.0.0.1:${server.address().port}/v1`, turns, close };
}

/** The real server entry point on a free port, as apps/server/test-support/spawn-server.ts runs it. */
async function startServer(dataDir) {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'OPENROUTER_API_KEY' && !k.startsWith('NEOTEXT_')) env[k] = v;
  }
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', join('apps', 'server', 'src', 'index.ts')],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Production defaults otherwise, Argon2 included (64 MiB, t=2).
      env: {
        ...env,
        NODE_ENV: 'production',
        NEOTEXT_PORT: String(port),
        NEOTEXT_PUBLIC_URL: baseUrl,
        NEOTEXT_LOG_LEVEL: 'info',
        NEOTEXT_DATA_DIR: dataDir,
      },
    },
  );
  const exited = new Promise((r) => child.once('exit', r));
  let stderr = '';
  child.stderr.on('data', (c) => {
    stderr += c.toString();
  });
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('The server did not start in 60 s.')), 60_000);
    child.once('exit', (code) =>
      reject(new Error(`The server exited with code ${code}. ${stderr}`)),
    );
    let buffered = '';
    child.stdout.on('data', (c) => {
      buffered += c.toString();
      if (buffered.includes('"msg":"listening"')) {
        clearTimeout(timer);
        resolveReady();
      }
      buffered = buffered.slice(-200);
    });
  });
  child.stdout.resume();
  return {
    baseUrl,
    stop: async () => {
      if (child.exitCode === null) child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      await exited;
      clearTimeout(timer);
    },
  };
}

function client(baseUrl) {
  let cookie = '';
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { origin: baseUrl, 'content-type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return res;
  };
}

async function ok(res, what) {
  if (!res.ok) throw new Error(`${what} failed: ${res.status} ${await res.text()}`);
  return res;
}

/** One chat turn; returns when this client has read the first token, then drains the stream. */
async function turn(api, mock, providerId) {
  for (;;) {
    const sentAt = performance.now();
    const res = await api('/api/chat', {
      method: 'POST',
      body: {
        conversationId: null,
        parentId: null,
        userMessage: { text: 'How fast is this?' },
        targets: [{ providerId, modelId: 'bench/model' }],
      },
    });
    if (res.status === 429) {
      // The chat limit (30 a minute) paces a long run; the wait is not part of any measurement.
      await res.body?.cancel();
      await sleep((Number(res.headers.get('retry-after')) || 5) * 1000);
      continue;
    }
    await ok(res, 'chat');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let readAt = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (readAt === null && text.includes(TOKEN)) readAt = performance.now();
    }
    const upstream = mock.turns.at(-1);
    if (readAt === null || !upstream) throw new Error('The answer never reached the client.');
    return {
      sendToUpstreamMs: upstream.receivedAt - sentAt,
      overheadMs: readAt - upstream.firstTokenAt,
    };
  }
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function main() {
  const dataDir = mkdtempSync(join(tmpdir(), 'neotext-bench-'));
  const mock = await startMock();
  let server = null;
  try {
    server = await startServer(dataDir);
    const api = client(server.baseUrl);
    await ok(
      await api('/api/setup', {
        method: 'POST',
        body: { username: 'bench', password: PASSWORD, mode: 'personal' },
      }),
      'setup',
    );
    // Titles are a second model call per chat; leave the mock to the turns being measured.
    await ok(
      await api('/api/settings', {
        method: 'PATCH',
        body: { patch: { chat: { autoTitle: false } } },
      }),
      'settings',
    );
    const added = await ok(
      await api('/api/providers', {
        method: 'POST',
        body: { kind: 'openai-compatible', name: 'Bench mock', baseUrl: mock.url },
      }),
      'adding the provider',
    );
    const providerId = (await added.json()).provider.id;

    const samples = [];
    for (let i = 0; i < WARMUP + TURNS; i++) {
      const sample = await turn(api, mock, providerId);
      if (i >= WARMUP) samples.push(sample);
    }

    const logins = [];
    for (let i = 0; i < LOGINS; i++) {
      const start = performance.now();
      await ok(
        await api('/api/auth/login', {
          method: 'POST',
          body: { username: 'bench', password: PASSWORD },
        }),
        'login',
      );
      logins.push(performance.now() - start);
    }

    const rows = [
      ['sendToUpstreamMs', samples.map((s) => s.sendToUpstreamMs), 95, BUDGETS.sendToUpstreamMs],
      ['overheadMs', samples.map((s) => s.overheadMs), 95, BUDGETS.overheadMs],
      ['loginMs', logins, 100, BUDGETS.loginMs],
    ];
    console.log(`${TURNS} turns, ${LOGINS} logins, PERF_SLACK=${SLACK}`);
    console.log(
      `${'metric'.padEnd(18)}${'p50'.padStart(9)}${'p95'.padStart(9)}${'max'.padStart(9)}  budget`,
    );
    let failed = false;
    for (const [name, values, p, budget] of rows) {
      const gate = percentile(values, p);
      const limit = budget * SLACK;
      const pass = gate <= limit;
      failed ||= !pass;
      const ms = (v) => v.toFixed(1).padStart(9);
      const which = p === 100 ? 'max' : `p${p}`;
      console.log(
        `${name.padEnd(18)}${ms(percentile(values, 50))}${ms(percentile(values, 95))}${ms(Math.max(...values))}  ${which} ≤ ${limit} ms ${pass ? 'ok' : 'OVER'}`,
      );
    }
    if (failed) {
      console.error('\nA latency budget was missed.');
      process.exitCode = 1;
    }
  } finally {
    await server?.stop();
    await mock.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

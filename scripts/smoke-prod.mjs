// Production smoke test: starts the server the way `npm start` does (scripts/start.mjs) on a
// random free port and a throwaway data directory, then checks what a real deployment serves.
// Run after `npm run build`. Works on Windows and Linux; exits non-zero on the first failure.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { root, spawnServer } from './start.mjs';

const dist = path.join(root, 'apps', 'web', 'dist');
const ok = (msg) => console.log(`ok       ${msg}`);
const skip = (msg) => console.log(`skipped  ${msg}`);

function fail(msg) {
  throw new Error(msg);
}
function check(cond, msg) {
  if (!cond) fail(msg);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Plain http.request so the response headers (content-encoding) stay exactly as sent. */
function get(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: 'GET', headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
        );
      },
    );
    req.once('error', reject);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(port, child, getStderr) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) fail(`server exited early (${child.exitCode}):\n${getStderr()}`);
    try {
      const res = await get(port, '/api/health');
      if (res.status === 200) return;
    } catch {
      // not listening yet
    }
    await sleep(200);
  }
  fail(`server did not become healthy in 60s:\n${getStderr()}`);
}

function listBrotli(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listBrotli(full));
    else if (entry.name.endsWith('.br')) found.push(full);
  }
  return found;
}

function stop(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', () => resolve());
    // POSIX: SIGTERM runs the server's graceful shutdown handler.
    // Windows has no real signals: child.kill() ends the process at once whatever the
    // signal name, so the graceful path cannot be exercised there. We still verify that the
    // process stops and prints no libuv assertion. The exit-code check is POSIX-only.
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 15_000).unref();
  });
}

async function run(tmp) {
  check(
    fs.existsSync(path.join(dist, 'index.html')),
    'apps/web/dist is missing. Run `npm run build` first.',
  );
  const port = await freePort();
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('NEOTEXT_') && k !== 'OPENROUTER_API_KEY') env[k] = v;
  }
  Object.assign(env, {
    NODE_ENV: 'production',
    NEOTEXT_HOST: '127.0.0.1',
    NEOTEXT_PORT: String(port),
    NEOTEXT_DATA_DIR: tmp,
  });
  let stderr = '';
  let stdout = '';
  const child = spawnServer({ env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => {
    stdout += d;
  });
  child.stderr.on('data', (d) => {
    stderr += d;
  });
  try {
    await waitForHealth(port, child, () => stderr + stdout);
    ok(`GET /api/health on port ${port}`);

    const index = await get(port, '/');
    check(index.status === 200, `GET / returned ${index.status}`);
    check(String(index.headers['content-type']).includes('text/html'), 'GET / is not HTML');
    const html = index.body.toString('utf8');
    check(html.includes('<div id="root"'), 'GET / is not the SPA shell (no #root)');
    const csp = index.headers['content-security-policy'];
    check(csp?.includes("default-src 'self'"), 'GET / has no Content-Security-Policy header');
    ok('GET / serves the SPA with a CSP header');

    const match = /\/assets\/[^"']+\.js/.exec(html);
    check(match, 'index.html references no hashed script under /assets/');
    const asset = await get(port, match[0]);
    check(asset.status === 200, `GET ${match[0]} returned ${asset.status}`);
    const cache = String(asset.headers['cache-control']);
    check(cache.includes('immutable'), `${match[0]} is not immutable (cache-control: ${cache})`);
    ok(`${match[0]} is cache-control immutable`);

    const brFiles = listBrotli(dist);
    if (brFiles.length === 0) {
      skip('brotli check: no precompressed assets in apps/web/dist');
    } else {
      const compressed = await get(port, match[0], { 'accept-encoding': 'br' });
      check(
        compressed.headers['content-encoding'] === 'br',
        `${match[0]} with accept-encoding: br has content-encoding ${compressed.headers['content-encoding']}`,
      );
      ok(`${match[0]} is served with content-encoding: br`);
    }

    await stop(child);
    if (process.platform !== 'win32') {
      check(
        child.exitCode === 0,
        `server exited with ${child.exitCode ?? child.signalCode} after SIGTERM`,
      );
    }
    const combined = `${stderr}\n${stdout}`;
    check(!/assertion failed|uv_/i.test(combined), `libuv assertion on shutdown:\n${combined}`);
    ok(
      process.platform === 'win32'
        ? 'server stopped with no libuv assertion (Windows: graceful SIGTERM path not testable)'
        : 'SIGTERM exits cleanly with no libuv assertion',
    );
  } finally {
    await stop(child);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neotext-smoke-'));
let failed = false;
try {
  await run(tmp);
  console.log('smoke:prod passed');
} catch (err) {
  failed = true;
  console.error(`FAILED   ${err instanceof Error ? err.message : err}`);
} finally {
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (err) {
    console.error(`warning: could not remove ${tmp}: ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);

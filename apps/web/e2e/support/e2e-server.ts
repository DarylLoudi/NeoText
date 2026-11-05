/**
 * The server the browser tests talk to: the real app on port 3421, serving the built web app,
 * with mock model providers (a custom endpoint and one that answers like OpenRouter), a mock
 * MCP server, and a small control server on port 3422. Started by global-setup;
 * it removes its temp data directory and closes every handle when asked to stop, when its
 * parent goes away, or on a signal.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { newId } from '@neotext/shared';
import { createApp } from '../../../server/src/app';
import { normalizeUsername } from '../../../server/src/auth/username';
import type { UserRow } from '../../../server/src/auth/users-repo';
import { loadConfig } from '../../../server/src/config/env';
import { type Container, createContainer } from '../../../server/src/container';
import { argon2Params } from '../../../server/src/crypto/kdf';
import { createVault, unlockWithPassword } from '../../../server/src/crypto/vault';
import { startServer } from '../../../server/src/server';
import { startMockMcpServer } from '../../../server/test-support/mock-mcp-server';
import { type MockScript, startMockProvider } from '../../../server/test-support/mock-provider';
import { seedConversations, seedThread } from '../../../server/test-support/seed';
import {
  chunk,
  DONE,
  finish,
  fixtureFrames,
  textFrames,
  usage,
} from '../../../server/test-support/sse-frames';
import { APP_PORT, APP_URL, CONTROL_PORT } from './ports';

const webDist = path.resolve(import.meta.dirname, '../../dist');
const openRouterModels = fs.readFileSync(
  path.resolve(import.meta.dirname, '../../../server/test-support/fixtures/openrouter-models.json'),
  'utf8',
);

/** What a test asks the mock provider to play for its next chat request. */
interface ScriptSpec {
  /** The answer, sent one piece per chunk. */
  chunks: string[];
  /** Pause after each chunk. */
  chunkDelayMs?: number;
  /** Leave the connection open after the last chunk instead of finishing. */
  hang?: boolean;
  /** Tool calls the model makes after the chunks; the step then ends with `tool_calls`. */
  toolCalls?: { id: string; name: string; arguments: string }[];
  /** Played only for a request naming this model, so parallel answers each get their own. */
  model?: string;
}

/** A recorded OpenRouter stream from the server's fixtures, optionally with more in it. */
interface FixtureSpec {
  name: string;
  /** More `url_citation` annotations, sent after the fixture's own and before its text. */
  citations?: { url: string; title: string; content: string }[];
  /** Pause after the `PROCESSING` comment, so the search shows while it runs. */
  processingDelayMs?: number;
}

function toolCallFrames(spec: ScriptSpec): MockScript {
  const frames: MockScript['frames'] = spec.chunks.map((text) => chunk({ content: text }));
  (spec.toolCalls ?? []).forEach((call, index) => {
    const start = {
      index,
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: '' },
    };
    frames.push(
      chunk({ tool_calls: [start] }),
      chunk({ tool_calls: [{ index, function: { arguments: call.arguments } }] }),
    );
  });
  frames.push(
    finish('tool_calls'),
    usage({ prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 }),
    DONE,
  );
  return { frames };
}

function citationFrame(c: NonNullable<FixtureSpec['citations']>[number]): string {
  const annotation = {
    type: 'url_citation',
    url_citation: { ...c, start_index: 0, end_index: 0 },
  };
  return chunk({ content: '', role: 'assistant', annotations: [annotation] });
}

function toFixtureScript(spec: FixtureSpec): MockScript {
  const frames: MockScript['frames'] = [];
  const extra = (spec.citations ?? []).map(citationFrame);
  let added = false;
  for (const f of fixtureFrames(spec.name)) {
    // The extra sources go in just before the first frame that carries answer text.
    if (!added && /"delta":\{"content":"[^"]/.test(f)) {
      frames.push(...extra);
      added = true;
    }
    frames.push(f);
    if (spec.processingDelayMs && f.startsWith(': OPENROUTER PROCESSING')) {
      frames.push({ delayMs: spec.processingDelayMs });
    }
  }
  return { frames };
}

function toScript(spec: ScriptSpec): MockScript {
  const script = framesFor(spec);
  return spec.model === undefined ? script : { ...script, model: spec.model };
}

function framesFor(spec: ScriptSpec): MockScript {
  if (spec.toolCalls?.length) return toolCallFrames(spec);
  if (spec.chunkDelayMs === undefined && !spec.hang) return { frames: textFrames(...spec.chunks) };
  const frames: MockScript['frames'] = [];
  for (const text of spec.chunks) {
    frames.push(chunk({ content: text }));
    if (spec.chunkDelayMs) frames.push({ delayMs: spec.chunkDelayMs });
  }
  if (!spec.hang) {
    frames.push(
      finish('stop'),
      usage({ prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 }),
      DONE,
    );
  }
  return { frames, ...(spec.hang ? { hangAfterFrames: true } : {}) };
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(part as Buffer);
  const raw = Buffer.concat(parts).toString('utf8');
  return raw === '' ? null : JSON.parse(raw);
}

/**
 * Adds an account straight to the database, as the server tests do: the app itself only
 * makes the first one. This control server exists only in the e2e harness.
 */
async function addUser(c: Container, username: string, password: string): Promise<void> {
  const id = newId('usr');
  const vault = await createVault(id, password, argon2Params(c.config.argon2));
  const now = c.clock.now();
  const row: UserRow = {
    id,
    username,
    displayName: username,
    role: 'member',
    status: 'active',
    kdfSalt: vault.password.kdfSalt,
    kdfParams: vault.password.kdfParams,
    authVerifier: vault.password.authVerifier,
    dekByPassword: vault.password.dekByPassword,
    dekByRecovery: vault.dekByRecovery,
    dekByInstance: null,
    createdAt: now,
    updatedAt: now,
    passwordChangedAt: now,
  };
  c.users.insert(row);
}

/** Set by global-setup for this harness only; without it the seed route refuses. */
const SEEDING_ALLOWED = process.env.NEOTEXT_E2E_HARNESS === '1';

interface SeedSpec {
  username: string;
  password: string;
  /** Chats to add, oldest titled "Seeded chat 1". */
  chats: number;
  /** Messages in one more chat, "Long thread", the newest of all; none when 0. */
  threadMessages: number;
}

/**
 * Fills an account straight through the repositories, sealed with its own key, for the
 * performance specs (5,000 chats is far too many to make through the API).
 */
async function seed(c: Container, spec: SeedSpec): Promise<{ threadId: string | null }> {
  const user = c.users.findByUsername(normalizeUsername(spec.username));
  const dek = user && (await unlockWithPassword(user.id, user, spec.password));
  if (!user || !dek) throw new Error('No such account, or the wrong password.');
  seedConversations(c, user.id, dek, { count: spec.chats });
  const threadId =
    spec.threadMessages > 0
      ? seedThread(c, user.id, dek, { title: 'Long thread', messages: spec.threadMessages })
      : null;
  return { threadId };
}

/**
 * Gives every account fresh request budgets. The suite signs one account in for dozens of
 * tests a minute, far past what a person does, so each test starts as a new minute would.
 */
function forgetRateLimits(c: Container): void {
  const ids = c.db.raw.prepare('SELECT id FROM users').pluck().all() as string[];
  for (const id of ids) {
    c.limiters.api.reset(id);
    c.limiters.chat.reset(`chat:${id}`);
    c.limiters.sensitive.reset(`export:${id}`);
    c.limiters.sensitive.reset(`import:${id}`);
  }
}

async function main(): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neotext-e2e-'));
  const mock = await startMockProvider();
  mock.models = ['mock/alpha', 'mock/beta'];
  // A second mock that speaks for OpenRouter: its catalog and streams are OpenRouter's own.
  const openRouter = await startMockProvider();
  openRouter.modelsBody = openRouterModels;
  const mcp = await startMockMcpServer();

  // An explicit environment: nothing from the developer's shell or .env can leak in.
  const config = loadConfig(
    {
      NODE_ENV: 'test',
      NEOTEXT_PORT: String(APP_PORT),
      NEOTEXT_PUBLIC_URL: APP_URL,
      NEOTEXT_DATA_DIR: dataDir,
      NEOTEXT_ARGON2_MEMORY_KIB: '1024',
      NEOTEXT_ARGON2_PASSES: '1',
      NEOTEXT_WEB_DIST: webDist,
    },
    path.resolve(import.meta.dirname, '../../../..'),
  );

  let container: Container | null = null;
  let app: { close(): Promise<void> } | null = null;
  const start = async (): Promise<void> => {
    container = await createContainer(config);
    app = await startServer(container, createApp(container));
  };
  const stop = async (): Promise<void> => {
    const [running, db] = [app, container];
    app = null;
    container = null;
    await running?.close();
    await db?.close();
  };

  let stopping: Promise<void> | null = null;
  let control: http.Server | null = null;
  const shutdown = (): Promise<void> => {
    stopping ??= (async () => {
      try {
        await stop();
        await mock.close();
        await openRouter.close();
        await mcp.close();
        control?.closeAllConnections();
        await new Promise<void>((r) => (control ? control.close(() => r()) : r()));
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
      } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    })();
    return stopping;
  };

  control = http.createServer((req, res) => {
    const reply = (status: number, body: unknown = {}) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    void (async () => {
      const route = `${req.method} ${req.url}`;
      if (route === 'GET /mock-url') return reply(200, { url: mock.url });
      if (route === 'GET /openrouter-url') return reply(200, { url: openRouter.url });
      if (route === 'GET /mcp-url') return reply(200, { url: mcp.url });
      if (route === 'POST /enqueue') {
        const { scripts, provider } = (await readJson(req)) as {
          scripts: ScriptSpec[];
          provider?: 'openrouter';
        };
        // Plain scripts go to the custom endpoint unless asked for the OpenRouter mock.
        (provider === 'openrouter' ? openRouter : mock).enqueue(...scripts.map(toScript));
        return reply(200);
      }
      if (route === 'POST /enqueue-fixture') {
        openRouter.enqueue(toFixtureScript((await readJson(req)) as FixtureSpec));
        return reply(200);
      }
      if (route === 'POST /reset') {
        mock.reset();
        mock.models = ['mock/alpha', 'mock/beta'];
        openRouter.reset();
        openRouter.modelsBody = openRouterModels;
        if (container) forgetRateLimits(container);
        return reply(200);
      }
      if (route === 'GET /chat-requests') {
        const chats = mock.requests.filter((r) => r.path === '/v1/chat/completions');
        return reply(200, { count: chats.length, bodies: chats.map((r) => r.body) });
      }
      if (route === 'POST /users') {
        if (!container) return reply(503, { error: 'the app server is not running' });
        const { username, password } = (await readJson(req)) as {
          username: string;
          password: string;
        };
        await addUser(container, username, password);
        return reply(200);
      }
      if (route === 'POST /seed') {
        if (!SEEDING_ALLOWED) return reply(403, { error: 'seeding is for the e2e harness only' });
        if (!container) return reply(503, { error: 'the app server is not running' });
        return reply(200, await seed(container, (await readJson(req)) as SeedSpec));
      }
      if (route === 'POST /restart') {
        await stop();
        await start();
        return reply(200);
      }
      if (route === 'POST /shutdown') {
        reply(200);
        void shutdown();
        return;
      }
      reply(404, { error: 'unknown route' });
    })().catch((err) => reply(500, { error: err instanceof Error ? err.message : String(err) }));
  });
  try {
    await start();
    await new Promise<void>((resolve, reject) => {
      control?.once('error', reject);
      control?.listen(CONTROL_PORT, '127.0.0.1', resolve);
    });
  } catch (err) {
    // A port that is already taken must not leave the mock or the temp directory behind.
    await shutdown();
    throw err;
  }

  // The runner holds our stdin; when it goes away, so do we.
  process.stdin.on('end', () => void shutdown());
  process.stdin.on('error', () => void shutdown());
  process.stdin.resume();
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  console.log('e2e-ready');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

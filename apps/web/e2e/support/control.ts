import type { APIRequestContext } from '@playwright/test';
import { CONTROL_URL } from './ports';

export interface Script {
  chunks: string[];
  chunkDelayMs?: number;
  hang?: boolean;
  /** Tool calls after the chunks; the step ends with `tool_calls`. */
  toolCalls?: { id: string; name: string; arguments: string }[];
  /** Answer only a request for this model (compare sends several at once, in any order). */
  model?: string;
}

export interface FixtureScript {
  /** A recorded OpenRouter stream in `apps/server/test-support/fixtures`, without `.sse`. */
  name: string;
  /** More sources, sent before the answer text. */
  citations?: { url: string; title: string; content: string }[];
  /** Pause after OpenRouter's processing notice, while the search runs. */
  processingDelayMs?: number;
}

export const account = { username: 'ada', password: 'correct horse battery' };

async function post(request: APIRequestContext, route: string, data?: unknown): Promise<void> {
  const res = await request.post(`${CONTROL_URL}${route}`, data === undefined ? {} : { data });
  if (!res.ok()) throw new Error(`${route} failed: ${res.status()} ${await res.text()}`);
}

/** Queues what the mock provider answers to the next chat requests, in order. */
export const enqueue = (request: APIRequestContext, ...scripts: Script[]) =>
  post(request, '/enqueue', { scripts });

/** Queues a recorded stream for the next chat request to the OpenRouter mock. */
export const enqueueFixture = (request: APIRequestContext, script: FixtureScript) =>
  post(request, '/enqueue-fixture', script);

/** Forgets anything queued for the mock provider by an earlier test. */
export const resetMock = (request: APIRequestContext) => post(request, '/reset');

/** Stops and starts the app server on the same data directory. */
export const restartServer = (request: APIRequestContext) => post(request, '/restart');

async function urlOf(request: APIRequestContext, route: string): Promise<string> {
  const res = await request.get(`${CONTROL_URL}${route}`);
  return ((await res.json()) as { url: string }).url;
}

export const mockUrl = (request: APIRequestContext) => urlOf(request, '/mock-url');
/** The mock that answers like OpenRouter, for a provider of kind `openrouter`. */
export const openRouterUrl = (request: APIRequestContext) => urlOf(request, '/openrouter-url');
/** The mock MCP server, with tools `echo`, `slow`, `big`, `fail` and `mixed`. */
export const mcpUrl = (request: APIRequestContext) => urlOf(request, '/mcp-url');

async function chatRequests(request: APIRequestContext) {
  const res = await request.get(`${CONTROL_URL}/chat-requests`);
  return (await res.json()) as { count: number; bodies: unknown[] };
}

export async function chatRequestCount(request: APIRequestContext): Promise<number> {
  return (await chatRequests(request)).count;
}

/** What the app sent the mock provider in each chat request since the last reset, in order. */
export async function chatRequestBodies(request: APIRequestContext): Promise<ChatRequestBody[]> {
  return (await chatRequests(request)).bodies as ChatRequestBody[];
}

export interface ChatRequestBody {
  model: string;
  messages: { role: string; content: string | { type: string; [key: string]: unknown }[] }[];
}

/** Adds another account to the server, which the app's own setup never does after the first. */
export const addAccount = (request: APIRequestContext, username: string, password: string) =>
  post(request, '/users', { username, password });

/** Fills an account with `chats` chats and one "Long thread" of `threadMessages` messages. */
export async function seedAccount(
  request: APIRequestContext,
  spec: { username: string; password: string; chats: number; threadMessages: number },
): Promise<{ threadId: string | null }> {
  const res = await request.post(`${CONTROL_URL}/seed`, { data: spec, timeout: 120_000 });
  if (!res.ok()) throw new Error(`/seed failed: ${res.status()} ${await res.text()}`);
  return (await res.json()) as { threadId: string | null };
}

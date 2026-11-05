import type { APIRequestContext, Page } from '@playwright/test';
import { mcpUrl, openRouterUrl, resetMock } from './control';

const sections = [
  { id: 'pinned', kind: 'pinned', visible: true, collapsed: false },
  { id: 'folders', kind: 'folders', visible: true, collapsed: false },
  { id: 'recent', kind: 'recent', visible: true, collapsed: false, groupBy: 'date' },
  { id: 'presets', kind: 'presets', visible: true, collapsed: false },
  { id: 'archived', kind: 'archived', visible: false, collapsed: false },
];

/** What every spec starts from: the settings these tests touch, and an empty mock queue. */
export async function resetState(request: APIRequestContext): Promise<void> {
  await resetMock(request);
  await patchSettings(request, {
    appearance: { theme: 'system', reduceMotion: 'system' },
    // Titles come from a second model call that would take a script meant for the next test.
    chat: { autoTitle: false, sendKey: 'enter' },
    sidebar: { position: 'left', collapsed: false, sections },
  });
}

export async function patchSettings(
  request: APIRequestContext,
  patch: Record<string, unknown>,
): Promise<void> {
  const res = await request.patch('/api/settings', { data: { patch } });
  if (!res.ok()) throw new Error(`Settings patch failed: ${res.status()} ${await res.text()}`);
}

export async function readSettings(request: APIRequestContext): Promise<{
  appearance: { theme: string };
  chat: { sendKey: string };
  sidebar: { position: string; sections: { id: string; visible: boolean }[] };
}> {
  const res = await request.get('/api/settings');
  return ((await res.json()) as { settings: never }).settings;
}

export async function createChat(request: APIRequestContext, title: string): Promise<string> {
  const res = await request.post('/api/conversations', { data: { title } });
  if (!res.ok()) throw new Error(`Creating a chat failed: ${res.status()} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

/** Waits for the answer to a settings PATCH the page sends. */
export function settingsSaved(page: Page) {
  return page.waitForResponse(
    (r) => r.url().endsWith('/api/settings') && r.request().method() === 'PATCH' && r.ok(),
  );
}

async function send(
  request: APIRequestContext,
  method: 'post' | 'delete',
  url: string,
  data?: unknown,
): Promise<unknown> {
  const res = await request[method](url, data === undefined ? {} : { data });
  if (!res.ok()) throw new Error(`${method} ${url} failed: ${res.status()} ${await res.text()}`);
  return res.status() === 204 ? null : res.json();
}

/** Adds a provider of kind `openrouter` that talks to the OpenRouter mock; returns its id. */
export async function addOpenRouterProvider(request: APIRequestContext): Promise<string> {
  const baseUrl = await openRouterUrl(request);
  const body = await send(request, 'post', '/api/providers', {
    kind: 'openrouter',
    name: 'OpenRouter mock',
    baseUrl,
    apiKey: 'sk-or-e2e-not-a-real-key',
  });
  return (body as { provider: { id: string } }).provider.id;
}

export const removeProvider = (request: APIRequestContext, id: string) =>
  send(request, 'delete', `/api/providers/${id}`);

/** Adds the mock MCP server under `name`; returns its id. */
export async function addMcpServer(request: APIRequestContext, name: string): Promise<string> {
  const url = await mcpUrl(request);
  const body = await send(request, 'post', '/api/mcp-servers', { name, url });
  return (body as { server: { id: string } }).server.id;
}

export const removeMcpServer = (request: APIRequestContext, id: string) =>
  send(request, 'delete', `/api/mcp-servers/${id}`);

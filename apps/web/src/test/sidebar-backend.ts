import type { ConversationSummary, Folder } from '@neotext/shared';
import { HttpResponse, http } from 'msw';
import { server } from './msw';

let seq = 0;

export function conv(
  lastActivityAt: number,
  over: Partial<ConversationSummary> = {},
): ConversationSummary {
  seq += 1;
  return {
    id: `cnv_${seq}`,
    title: `Chat ${seq}`,
    titleSource: 'user',
    folderId: null,
    pinned: false,
    pinPosition: null,
    archived: false,
    presetId: null,
    modelRef: null,
    activeLeafId: null,
    messageCount: 2,
    createdAt: lastActivityAt,
    updatedAt: lastActivityAt,
    lastActivityAt,
    deletedAt: null,
    ...over,
  };
}

export function folder(over: Partial<Folder> & { id: string; name: string }): Folder {
  return {
    parentId: null,
    color: null,
    position: 'a0',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

export interface FakeDb {
  conversations: ConversationSummary[];
  folders: Folder[];
  active: { id: string; conversationId: string }[];
}

export interface Call {
  method: string;
  path: string;
  search: string;
  body?: unknown;
}

function inScope(c: ConversationSummary, url: URL): boolean {
  const scope = url.searchParams.get('scope') ?? 'recent';
  const live = c.deletedAt === null;
  switch (scope) {
    case 'recent':
      return live && !c.archived && !c.pinned && c.folderId === null;
    case 'pinned':
      return live && !c.archived && c.pinned;
    case 'archived':
      return live && c.archived;
    case 'folder':
      return live && c.folderId === url.searchParams.get('folderId');
    case 'trash':
      return !live;
    default:
      return live;
  }
}

function order(scope: string | null) {
  return (a: ConversationSummary, b: ConversationSummary) => {
    if (scope === 'pinned') return (a.pinPosition ?? '') < (b.pinPosition ?? '') ? -1 : 1;
    return b.lastActivityAt - a.lastActivityAt;
  };
}

/** A tiny in-memory server for the sidebar's endpoints. Returns the list of calls made. */
export function serveSidebar(db: Partial<FakeDb> = {}): { db: FakeDb; calls: Call[] } {
  const data: FakeDb = { conversations: [], folders: [], active: [], ...db };
  const calls: Call[] = [];
  const log = async (request: Request, withBody = false) => {
    const url = new URL(request.url);
    const call: Call = { method: request.method, path: url.pathname, search: url.search };
    if (withBody) call.body = await request.json();
    calls.push(call);
    return url;
  };
  const find = (id: unknown) => data.conversations.find((c) => c.id === id);
  server.use(
    http.get('/api/conversations', async ({ request }) => {
      const url = await log(request);
      const items = data.conversations
        .filter((c) => inScope(c, url))
        .sort(order(url.searchParams.get('scope')));
      return HttpResponse.json({ items, nextCursor: null });
    }),
    http.get('/api/conversations/:id', async ({ request, params }) => {
      await log(request);
      const c = find(params.id);
      if (!c || c.deletedAt !== null) {
        return HttpResponse.json(
          { error: { code: 'not_found', message: 'Gone.' } },
          { status: 404 },
        );
      }
      return HttpResponse.json({ conversation: c, messages: [] });
    }),
    http.patch('/api/conversations/:id', async ({ request, params }) => {
      await log(request, true);
      const c = find(params.id);
      if (!c)
        return HttpResponse.json(
          { error: { code: 'not_found', message: 'Gone.' } },
          { status: 404 },
        );
      const body = calls.at(-1)?.body as Partial<ConversationSummary>;
      Object.assign(c, body, { updatedAt: c.updatedAt + 1 });
      return HttpResponse.json(c);
    }),
    http.delete('/api/conversations/:id', async ({ request, params }) => {
      await log(request);
      const c = find(params.id);
      if (c) c.deletedAt = 1;
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('/api/conversations/:id/restore', async ({ request, params }) => {
      await log(request);
      const c = find(params.id);
      if (!c)
        return HttpResponse.json(
          { error: { code: 'not_found', message: 'Gone.' } },
          { status: 404 },
        );
      c.deletedAt = null;
      return HttpResponse.json(c);
    }),
    http.get('/api/folders', async ({ request }) => {
      await log(request);
      return HttpResponse.json({ folders: data.folders });
    }),
    http.post('/api/folders', async ({ request }) => {
      await log(request, true);
      const body = calls.at(-1)?.body as { name: string; position: string };
      const f = folder({ id: `fld_${data.folders.length + 1}`, ...body });
      data.folders.push(f);
      return HttpResponse.json(f, { status: 201 });
    }),
    http.patch('/api/folders/:id', async ({ request, params }) => {
      await log(request, true);
      const f = data.folders.find((x) => x.id === params.id);
      if (!f)
        return HttpResponse.json(
          { error: { code: 'not_found', message: 'Gone.' } },
          { status: 404 },
        );
      Object.assign(f, calls.at(-1)?.body);
      return HttpResponse.json(f);
    }),
    http.delete('/api/folders/:id', async ({ request, params }) => {
      await log(request);
      data.folders = data.folders.filter((x) => x.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.get('/api/generations/active', () =>
      HttpResponse.json({
        items: data.active.map((a) => ({
          id: a.id,
          conversationId: a.conversationId,
          assistantMessageId: `msg_${a.id}`,
          model: { providerId: 'p', modelId: 'm' },
          startedAt: 0,
        })),
      }),
    ),
  );
  return { db: data, calls };
}

/**
 * happy-dom does no layout, so scroll containers report a height of 0 and a virtual list would
 * render nothing. Give every element a viewport-sized client height for the test.
 */
export function stubLayout(height = 800): () => void {
  const proto = HTMLElement.prototype;
  const before = Object.getOwnPropertyDescriptor(proto, 'clientHeight');
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => height });
  return () => {
    if (before) Object.defineProperty(proto, 'clientHeight', before);
  };
}

import { AGENT_FILES_MAX, type AgentFile, type AgentFilesList } from '@neotext/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { pdfWithPages } from '../../../test-support/knowledge-files';
import {
  addUser,
  authContextFor,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../../test-support/test-app';
import { createKnowledgeRepo } from './repo';
import { createKnowledgeService } from './service';

let t: TestApp;
let cookie: string;
let agentId: string;

const ORIGIN = 'http://localhost:3420';

async function createAgent(as: string, name = 'Asisten Kalkulus'): Promise<string> {
  const res = await t.app.request('/api/agents', {
    method: 'POST',
    body: JSON.stringify({ name, data: { instructions: 'Help with calculus.' } }),
    headers: { cookie: as, origin: ORIGIN, 'content-type': 'application/json' },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

beforeEach(async () => {
  t = await createTestApp();
  cookie = (await setupOwner(t)).cookie;
  agentId = await createAgent(cookie);
});
afterEach(() => t.close());

const formWith = (bytes: Buffer, name: string, type: string) => {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes)], name, { type }));
  return form;
};
const upload = (form: FormData, id = agentId, as = cookie) =>
  t.app.request(`/api/agents/${id}/files`, {
    method: 'POST',
    body: form,
    headers: { cookie: as, origin: ORIGIN },
  });
const list = async (id = agentId, as = cookie) => {
  const res = await t.app.request(`/api/agents/${id}/files`, {
    headers: { cookie: as, origin: ORIGIN },
  });
  return { status: res.status, body: (await res.json()) as AgentFilesList };
};
const remove = (fileId: string, id = agentId, as = cookie) =>
  t.app.request(`/api/agents/${id}/files/${fileId}`, {
    method: 'DELETE',
    headers: { cookie: as, origin: ORIGIN },
  });
const md = (text: string, name = 'notes.md') => formWith(Buffer.from(text), name, 'text/markdown');
const codeOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

test('upload, list and delete a file', async () => {
  const res = await upload(md('# Limits\n\nThe limit of sin(x)/x at 0 is 1.'));
  expect(res.status).toBe(201);
  expect(res.headers.get('cache-control')).toBe('no-store');
  const file = (await res.json()) as AgentFile;
  expect(file).toMatchObject({
    agentId,
    name: 'notes.md',
    pages: null,
    chunks: 1,
    status: 'ready',
    error: null,
  });
  expect((await list()).body.files).toEqual([file]);
  expect((await remove(file.id)).status).toBe(204);
  expect((await list()).body.files).toEqual([]);
  expect((await remove(file.id)).status).toBe(404);
});

test('a PDF keeps its page count; a file without text is stored as failed with the reason', async () => {
  const pdf = await upload(formWith(pdfWithPages(['One', 'Two']), 'c.pdf', 'application/pdf'));
  expect(await pdf.json()).toMatchObject({ pages: 2, chunks: 2, status: 'ready' });
  const scanned = await upload(formWith(pdfWithPages(['']), 'scan.pdf', 'application/pdf'));
  expect(scanned.status).toBe(201);
  expect(await scanned.json()).toMatchObject({
    status: 'failed',
    error: 'No text found (scanned PDF?).',
    chunks: 0,
  });
  const auth = authContextFor(t, cookie);
  expect(t.c.knowledge.fileNames(auth, agentId)).toEqual(['c.pdf']);
  expect(t.c.knowledge.hasReady(auth, agentId)).toBe(true);
});

test('a wrong type is 415, a file over 10 MB is 413, and a 21st file is refused', async () => {
  const png = await upload(formWith(Buffer.from('x'), 'a.png', 'image/png'));
  expect(png.status).toBe(415);
  expect(await codeOf(png)).toBe('knowledge_type');
  const big = await upload(
    formWith(Buffer.alloc(10 * 1024 * 1024 + 1, 97), 'big.txt', 'text/plain'),
  );
  expect(big.status).toBe(413);
  expect(await codeOf(big)).toBe('knowledge_too_large');
  for (let i = 0; i < AGENT_FILES_MAX; i++) {
    expect((await upload(md(`file ${i}`, `f${i}.md`))).status).toBe(201);
  }
  const extra = await upload(md('one more'));
  expect(extra.status).toBe(409);
  expect(await codeOf(extra)).toBe('knowledge_limit');
  expect((await list()).body.files).toHaveLength(AGENT_FILES_MAX);
});

test('a body above the route limit is refused before it is read; chunked bodies need a length', async () => {
  const huge = await t.app.request(`/api/agents/${agentId}/files`, {
    method: 'POST',
    body: 'x',
    headers: {
      cookie,
      origin: ORIGIN,
      'content-type': 'multipart/form-data; boundary=x',
      'content-length': String(12 * 1024 * 1024),
    },
  });
  expect(huge.status).toBe(413);
  const chunked = await t.app.request(`/api/agents/${agentId}/files`, {
    method: 'POST',
    body: 'x',
    headers: {
      cookie,
      origin: ORIGIN,
      'content-type': 'multipart/form-data; boundary=x',
      'transfer-encoding': 'chunked',
    },
  });
  expect(chunked.status).toBe(411);
});

test("another user's agent looks missing", async () => {
  const other = (await addUser(t, 'bob')).cookie;
  const file = (await (await upload(md('secret plan'))).json()) as AgentFile;
  expect((await upload(md('x'), agentId, other)).status).toBe(404);
  expect((await list(agentId, other)).status).toBe(404);
  expect((await remove(file.id, agentId, other)).status).toBe(404);
  const own = await createAgent(other, 'Bob agent');
  expect((await remove(file.id, own, other)).status).toBe(404);
  expect((await list()).body.files).toHaveLength(1);
});

test('deleting the agent deletes its files and chunks', async () => {
  await upload(md('alpha beta'));
  const count = (table: string) =>
    (t.c.db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  expect(count('agent_files')).toBe(1);
  expect(count('agent_chunks')).toBe(1);
  const res = await t.app.request(`/api/agents/${agentId}`, {
    method: 'DELETE',
    headers: { cookie, origin: ORIGIN },
  });
  expect(res.status).toBe(204);
  expect(count('agent_files')).toBe(0);
  expect(count('agent_chunks')).toBe(0);
});

test('file names and chunk text are sealed: no plaintext in the database', async () => {
  await upload(md('The zebra-quokka theorem holds on Tuesdays.', 'zebra-secret.md'));
  const files = t.c.db.raw.prepare('SELECT * FROM agent_files').all() as Record<string, unknown>[];
  const chunks = t.c.db.raw.prepare('SELECT * FROM agent_chunks').all() as Record<
    string,
    unknown
  >[];
  const dump = [...files, ...chunks]
    .flatMap((row) => Object.values(row))
    .map((v) => (Buffer.isBuffer(v) ? v.toString('latin1') : String(v)))
    .join('|');
  expect(dump).not.toContain('zebra');
  expect(dump).not.toContain('quokka');
  expect(files[0]?.text_bytes).toBe(
    Buffer.byteLength('The zebra-quokka theorem holds on Tuesdays.'),
  );
});

test('the text quota counts every agent of the user', async () => {
  const auth = authContextFor(t, cookie);
  const second = await createAgent(cookie, 'Second');
  const knowledge = createKnowledgeService({
    repo: createKnowledgeRepo(t.c.db),
    agents: t.c.agents,
    clock: t.clock,
    log: t.c.log,
    textQuotaBytes: 30,
  });
  const file = (text: string) => ({ name: 'a.txt', mime: 'text/plain', bytes: Buffer.from(text) });
  await knowledge.add(auth, agentId, file('x'.repeat(20)));
  await expect(knowledge.add(auth, second, file('y'.repeat(20)))).rejects.toMatchObject({
    code: 'knowledge_limit',
  });
  await knowledge.add(auth, second, file('y'.repeat(10)));
  expect(knowledge.list(auth, second)).toHaveLength(1);
});

test('search returns the best chunks with their file and page, within 8,000 characters', async () => {
  const auth = authContextFor(t, cookie);
  const words = (w: string) => `${w} `.repeat(400);
  await upload(
    formWith(pdfWithPages(['Limits and continuity', 'Chain rule']), 'c.pdf', 'application/pdf'),
  );
  for (let i = 0; i < 8; i++) await upload(md(`${words('derivative')} ${i}`, `long${i}.md`));
  expect(t.c.knowledge.search(auth, agentId, 'chain rule')).toEqual([
    { file: 'c.pdf', page: 2, text: 'Chain rule' },
  ]);
  const hits = t.c.knowledge.search(auth, agentId, 'derivative');
  expect(hits.length).toBeGreaterThan(1);
  expect(hits.length).toBeLessThanOrEqual(6);
  const size = hits.reduce((n, h) => n + h.text.length + h.file.length + 24, 0);
  expect(size).toBeLessThanOrEqual(8_000);
  expect(t.c.knowledge.search(auth, agentId, 'photosynthesis')).toEqual([]);
});

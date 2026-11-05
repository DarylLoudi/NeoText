import { type MessagePart, newId } from '@neotext/shared';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  authContextFor,
  authed,
  createTestApp,
  setupOwner,
  type TestApp,
} from '../../test-support/test-app';
import type { MessagesRepo } from '../chat/messages-repo';
import type { AuthContext } from '../http/env';
import { openBundle } from './bundle';
import { createExportService, type ExportServiceDeps } from './export-service';
import { createPace } from './pace';

const PW = 'kata sandi yang panjang';
const MANY = 30;

let t: TestApp;
let auth: AuthContext;
let api: ReturnType<typeof authed>;

beforeEach(async () => {
  t = await createTestApp();
  const { cookie } = await setupOwner(t);
  auth = authContextFor(t, cookie);
  api = authed(t, cookie);
});
afterEach(() => t.close());

/** One chat with a user turn (`parts`) and an answer. */
function seed(title: string, parts: MessagePart[] = [{ type: 'text', text: 'Halo' }]) {
  const id = newId('cnv');
  const at = t.c.clock.now();
  t.c.repos.conversations.insert(
    { id, userId: auth.userId, folderId: null, title, createdAt: at },
    auth.dek,
  );
  const base = { conversationId: id, userId: auth.userId, status: 'complete' as const };
  const u = newId('msg');
  const a = newId('msg');
  t.c.repos.messages.insert(
    {
      ...base,
      id: u,
      parentId: null,
      role: 'user',
      parts,
      providerId: null,
      modelId: null,
      createdAt: at,
    },
    auth.dek,
  );
  t.c.repos.messages.insert(
    {
      ...base,
      id: a,
      parentId: u,
      role: 'assistant',
      parts: [{ type: 'text', text: `Jawaban ${title} ${'x'.repeat(200)}` }],
      providerId: null,
      modelId: 'test/model',
      createdAt: at + 1,
    },
    auth.dek,
  );
  t.c.repos.conversations.update(
    auth.userId,
    id,
    { activeLeafId: a, messageCount: 2 },
    at,
    auth.dek,
  );
  return id;
}

/** Counts turns of the event loop: a callback that schedules itself with setImmediate. */
function loopTurns() {
  let turns = 0;
  let running = true;
  const tick = () => {
    if (!running) return;
    turns++;
    setImmediate(tick);
  };
  setImmediate(tick);
  return {
    get turns() {
      return turns;
    },
    stop() {
      running = false;
    },
  };
}

/** An exporter whose message reads note how many loop turns had passed at each read. */
function exporter(extra: Partial<ExportServiceDeps>, seen: number[], turns: { turns: number }) {
  const messages: MessagesRepo = {
    ...t.c.repos.messages,
    listForConversation: (id, dek) => {
      seen.push(turns.turns);
      return t.c.repos.messages.listForConversation(id, dek);
    },
  };
  return createExportService({
    conversations: t.c.repos.conversations,
    messages,
    folders: t.c.repos.folders,
    presets: t.c.presets,
    agents: t.c.agents,
    settings: t.c.settings,
    providers: t.c.providers,
    audit: t.c.audit,
    clock: t.c.clock,
    appVersion: '0.0.0-test',
    ...extra,
  });
}

const strictlyRising = (xs: number[]) => xs.every((x, i) => i === 0 || x > (xs[i - 1] as number));

describe('long exports share the event loop', () => {
  test('every format lets other callbacks run between conversations', async () => {
    for (let i = 0; i < MANY; i++) seed(`Obrolan ${i}`);
    const bodies = [
      { format: 'neotext', passphrase: PW },
      { format: 'json', confirmPlaintext: true },
      { format: 'markdown' },
    ] as const;
    for (const body of bodies) {
      const seen: number[] = [];
      const turns = loopTurns();
      // A zero budget yields after every step, so each read must land on a later turn.
      const file = await exporter({ workBudgetMs: 0 }, seen, turns).exportData(auth, body);
      turns.stop();
      expect(seen, body.format).toHaveLength(MANY);
      expect(strictlyRising(seen), `${body.format}: ${seen.join(',')}`).toBe(true);
      if (body.format === 'neotext') {
        const bundle = await openBundle(file.data, PW);
        expect(bundle.conversations).toHaveLength(MANY);
        expect(bundle.messages).toHaveLength(MANY * 2);
      } else if (body.format === 'markdown') {
        expect(Object.keys(unzipSync(new Uint8Array(file.data)))).toHaveLength(MANY);
      } else {
        expect(JSON.parse(file.data.toString('utf8')).messages).toHaveLength(MANY * 2);
      }
    }
  });

  test('the pace yields only once its budget of work has passed', async () => {
    let clock = 0;
    const pace = createPace(50, () => clock);
    const yielded = async () => {
      let ran = false;
      setImmediate(() => {
        ran = true;
      });
      await pace();
      return ran;
    };
    clock = 49;
    expect(await yielded()).toBe(false);
    clock = 50;
    expect(await yielded()).toBe(true);
    clock = 99;
    expect(await yielded()).toBe(false);
    clock = 100;
    expect(await yielded()).toBe(true);
  });
});

describe('export size', () => {
  test('a NeoText export larger than an import can open is refused before it is built', async () => {
    for (let i = 0; i < 10; i++) seed(`Obrolan ${i}`);
    const seen: number[] = [];
    const turns = loopTurns();
    const service = exporter({ maxBundleBytes: 4000 }, seen, turns);
    await expect(
      service.exportData(auth, { format: 'neotext', passphrase: PW }),
    ).rejects.toMatchObject({
      code: 'bad_request',
      status: 400,
      details: { reason: 'export_too_large' },
      message: expect.stringMatching(/too large for one NeoText file/),
    });
    turns.stop();
    // It stopped reading as soon as the text passed the cap.
    expect(seen.length).toBeLessThan(10);
    // Markdown and plain JSON are not imported, so the cap does not apply to them.
    const json = await service.exportData(auth, { format: 'json', confirmPlaintext: true });
    expect(json.data.length).toBeGreaterThan(4000);
  });
});

describe('skipped attachments', () => {
  test('every export says how many attached files it left out', async () => {
    const file = (n: number): MessagePart => ({
      type: 'attachment',
      attachmentId: `att_${n}`,
      name: `laporan-${n}.pdf`,
      mime: 'application/pdf',
      size: 10,
    });
    const id = seed('Dengan berkas', [file(1), file(2), { type: 'text', text: 'Ringkas ini' }]);
    seed('Tanpa berkas');
    const post = (body: unknown) =>
      api('/api/export', { method: 'POST', body: JSON.stringify(body) });
    for (const body of [
      { format: 'neotext', passphrase: PW },
      { format: 'json', confirmPlaintext: true },
      { format: 'markdown' },
      { format: 'markdown', conversationId: id },
    ]) {
      const res = await post(body);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-skipped-attachments'), JSON.stringify(body)).toBe('2');
    }
    const zip = unzipSync(new Uint8Array(await (await post({ format: 'markdown' })).arrayBuffer()));
    expect(strFromU8(zip['Dengan berkas.md'] as Uint8Array)).toContain('Ringkas ini');
  });
});

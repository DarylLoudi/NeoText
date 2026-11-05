import { siblingsOf } from '@neotext/shared';
import { eq } from 'drizzle-orm';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';
import { addUser } from '../../test-support/test-app';
import { auditEvents, conversations as conversationsTable } from '../db/schema';
import {
  all,
  auth,
  chatgpt,
  claude,
  detail,
  importer,
  t,
  useImportApp,
} from './import-test-support';

useImportApp();

describe('import from ChatGPT and Claude', () => {
  test('import creates browsable conversations', async () => {
    const result = await importer().importData(auth, { source: 'chatgpt', file: chatgpt });
    expect(result).toEqual({ imported: 1, skipped: 0, failed: [] });
    const [c] = all(auth);
    if (!c) throw new Error('nothing imported');
    expect(c.title).toBe('Rencana liburan');
    expect(c.createdAt).toBe(1767225600500);
    expect(c.messageCount).toBe(5);
    const d = detail(auth, c.id);
    expect(d.messages).toHaveLength(5);
    const last = d.messages.find(
      (m) => m.parts[0]?.type === 'text' && m.parts[0].text === 'Selesai',
    );
    expect(c.activeLeafId).toBe(last?.id);
    expect(d.messages.every((m) => m.status === 'complete' && m.usage === null)).toBe(true);
    // Branch switcher data: both answers are siblings, in their original order.
    const a = d.messages.find((m) => (m.parts[0] as { text: string }).text === 'Jawaban A');
    if (!a) throw new Error('missing branch');
    const { siblings, index } = siblingsOf(d.messages, a.id);
    expect(siblings.map((m) => (m.parts[0] as { text: string }).text)).toEqual([
      'Jawaban A',
      'Jawaban B',
    ]);
    expect(index).toBe(0);
    // Titles are sealed at rest.
    const row = t.c.db.orm
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, c.id))
      .get();
    expect(Buffer.from(row?.title ?? []).includes('Rencana')).toBe(false);
    expect(row?.importRef).toBe('chatgpt:conv-chatgpt-1');
  });

  test('importing twice does not duplicate', async () => {
    await importer().importData(auth, { source: 'chatgpt', file: chatgpt });
    const again = await importer().importData(auth, { source: 'chatgpt', file: chatgpt });
    expect(again).toEqual({ imported: 0, skipped: 1, failed: [] });
    expect(all(auth)).toHaveLength(1);
  });

  test('the same export imports for each user separately', async () => {
    const other = await addUser(t, 'tamu');
    await importer().importData(auth, { source: 'chatgpt', file: chatgpt });
    const theirs = await importer().importData(other.auth, { source: 'chatgpt', file: chatgpt });
    expect(theirs.imported).toBe(1);
    expect(all(other.auth)).toHaveLength(1);
  });

  test('claude export from a zip', async () => {
    const zip = Buffer.from(
      zipSync({
        'conversations.json': new Uint8Array(claude),
        'users.json': strToU8('[]'),
      }),
    );
    const result = await importer().importData(auth, { source: 'claude', file: zip });
    expect(result.imported).toBe(1);
    const [c] = all(auth);
    if (!c) throw new Error('nothing imported');
    const d = detail(auth, c.id);
    expect(d.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(d.messages[2]?.parts).toEqual([{ type: 'text', text: 'Pakai telur?\n\nAtau tidak?' }]);
    expect(c.activeLeafId).toBe(d.messages[3]?.id);
  });

  test('one bad conversation does not stop the rest', async () => {
    const data = JSON.parse(chatgpt.toString('utf8')) as unknown[];
    const broken = { id: 'conv-bad', title: 'Rusak', mapping: 'not a mapping' };
    const empty = { id: 'conv-empty', title: 'Kosong', mapping: {} };
    const file = Buffer.from(JSON.stringify([broken, ...data, empty]));
    const result = await importer().importData(auth, { source: 'chatgpt', file });
    expect(result.imported).toBe(1);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0]).toEqual({
      title: 'Rusak',
      code: 'missing_messages',
      reason: 'This conversation has no message tree.',
    });
    expect(result.failed[1]).toEqual({
      title: 'Kosong',
      code: 'no_messages',
      reason: expect.stringMatching(/no messages/),
    });
    expect(all(auth)).toHaveLength(1);
  });

  test('garbage files say what was expected', async () => {
    await expect(
      importer().importData(auth, { source: 'chatgpt', file: Buffer.from('{"a":1}') }),
    ).rejects.toMatchObject({
      code: 'bad_request',
      message: expect.stringMatching(/conversations\.json/),
    });
    await expect(
      importer().importData(auth, { source: 'claude', file: Buffer.from('not json at all') }),
    ).rejects.toMatchObject({
      code: 'bad_request',
      message: expect.stringMatching(/conversations\.json/),
    });
    const zip = Buffer.from(zipSync({ 'other.json': strToU8('[]') }));
    await expect(
      importer().importData(auth, { source: 'chatgpt', file: zip }),
    ).rejects.toMatchObject({
      code: 'bad_request',
      message: expect.stringMatching(/conversations\.json/),
      details: { reason: 'zip_without_entry' },
    });
  });

  test('titles lose control and bidi characters; tool-addressed answers are skipped', async () => {
    const data = JSON.parse(chatgpt.toString('utf8')) as Record<string, unknown>[];
    const conv = data[0] as { title: string; mapping: Record<string, { message: unknown }> };
    conv.title = 'Rencana\u202e\u0007 liburan\n';
    const a = conv.mapping['node-a']?.message as Record<string, unknown>;
    a.recipient = 'browser';
    const file = Buffer.from(JSON.stringify(data));
    await importer().importData(auth, { source: 'chatgpt', file });
    const [c] = all(auth);
    if (!c) throw new Error('nothing imported');
    expect(c.title).toBe('Rencana liburan');
    const texts = detail(auth, c.id).messages.map((m) => (m.parts[0] as { text: string }).text);
    expect(texts).not.toContain('Jawaban A');
  });

  test('a failed import is still audited, with counts and an error flag only', async () => {
    await expect(
      importer().importData(auth, { source: 'claude', file: Buffer.from('{}') }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    const events = t.c.db.orm
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.kind, 'data.imported'))
      .all();
    expect(events.map((e) => e.meta)).toEqual([
      { source: 'claude', imported: 0, skipped: 0, failed: 0, error: true },
    ]);
  });
});

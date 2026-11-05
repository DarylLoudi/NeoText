import type { MessagePublic } from '@neotext/shared';
import { expect, test, vi } from 'vitest';
import { capText, type LoadedAttachment, toModelFile } from '../attachments/model-file';
import {
  type BuildContextInput,
  buildContext,
  CONTEXT_SAFETY_TOKENS,
  DEFAULT_CONTEXT_TOKENS,
  DEFAULT_OUTPUT_TOKENS,
  formatDateLine,
  modelInputFor,
} from './context';
import { estimateMessageTokens, estimateTokens } from './tokens';

let seq = 0;
function msg(
  role: 'user' | 'assistant',
  text: string,
  status: MessagePublic['status'] = 'complete',
): MessagePublic {
  seq += 1;
  return {
    id: `m${seq}`,
    conversationId: 'c1',
    parentId: null,
    role,
    status,
    parts: text === '' ? [] : [{ type: 'text', text }],
    model: null,
    usage: null,
    finishReason: null,
    createdAt: seq,
    updatedAt: seq,
  };
}
const u = (t: string) => msg('user', t);
const a = (t: string, s: MessagePublic['status'] = 'complete') => msg('assistant', t, s);

function input(over: Partial<BuildContextInput>): BuildContextInput {
  return {
    path: [],
    systemPrompt: '',
    includeDate: false,
    timeZone: 'UTC',
    now: 0,
    contextLength: null,
    maxOutputTokens: null,
    strategy: 'trim-oldest',
    ...over,
  };
}

test('maps the path in order with system prompt and date line', () => {
  const out = buildContext(
    input({
      path: [u('Halo'), a('Hai!'), u('Apa kabar?')],
      systemPrompt: 'Be brief.',
      includeDate: true,
      timeZone: 'Asia/Jakarta',
      now: Date.UTC(2026, 10, 3, 2),
    }),
  );
  expect(out.messages).toEqual([
    { role: 'system', content: 'Be brief.\n\nCurrent date: 2026-11-03 (Asia/Jakarta)' },
    { role: 'user', content: 'Halo' },
    { role: 'assistant', content: 'Hai!' },
    { role: 'user', content: 'Apa kabar?' },
  ]);
  expect(out.trimmed).toBe(0);
});

test('date follows the time zone', () => {
  expect(formatDateLine(Date.UTC(2026, 10, 3, 20), 'Asia/Jakarta')).toBe(
    'Current date: 2026-11-04 (Asia/Jakarta)',
  );
});

test('invalid time zone falls back to UTC', () => {
  expect(formatDateLine(0, 'Mars/Base')).toBe('Current date: 1970-01-01 (UTC)');
});

test('empty prompt with date gives the date line alone; without date no system message', () => {
  const withDate = buildContext(input({ path: [u('x')], includeDate: true, now: 0 }));
  expect(withDate.messages[0]).toEqual({
    role: 'system',
    content: 'Current date: 1970-01-01 (UTC)',
  });
  const none = buildContext(input({ path: [u('x')], systemPrompt: '   ' }));
  expect(none.messages).toEqual([{ role: 'user', content: 'x' }]);
});

test('system prompt is trimmed and text parts are joined with blank lines', () => {
  const m = u('a');
  m.parts = [
    { type: 'text', text: 'one' },
    { type: 'text', text: 'two' },
  ];
  const out = buildContext(input({ path: [m], systemPrompt: '  hi  ' }));
  expect(out.messages).toEqual([
    { role: 'system', content: 'hi' },
    { role: 'user', content: 'one\n\ntwo' },
  ]);
});

test('failed and empty assistant turns are skipped', () => {
  const out = buildContext(
    input({ path: [u('1'), a('boom', 'error'), a(''), u('2'), a('ok', 'aborted')] }),
  );
  expect(out.messages).toEqual([
    { role: 'user', content: '1' },
    { role: 'user', content: '2' },
    { role: 'assistant', content: 'ok' },
  ]);
  expect(out.trimmed).toBe(0);
});

test('trims oldest and starts with a user turn', () => {
  const path: MessagePublic[] = [];
  for (let i = 0; i < 5; i++) path.push(u('u'.repeat(400)), a('a'.repeat(400)));
  const out = buildContext(
    input({ path, systemPrompt: 'sys', contextLength: 2000, maxOutputTokens: 200 }),
  );
  expect(out.trimmed).toBeGreaterThan(0);
  expect(out.messages[0]?.role).toBe('system');
  expect(out.messages[1]?.role).toBe('user');
  expect(out.messages.at(-1)).toEqual({ role: 'assistant', content: 'a'.repeat(400) });
  expect(out.messages.length - 1 + out.trimmed).toBe(10);
  expect(out.estimatedTokens).toBeLessThanOrEqual(2000 - 200 - CONTEXT_SAFETY_TOKENS);
});

test('leading assistant turns are dropped and counted after trimming', () => {
  const path = [a('x'.repeat(40)), u('y'), a('z')];
  const out = buildContext(input({ path }));
  expect(out.messages).toEqual([
    { role: 'user', content: 'y' },
    { role: 'assistant', content: 'z' },
  ]);
  expect(out.trimmed).toBe(1);
});

test('strategy none never trims', () => {
  const path = [a('x'.repeat(4000)), u('y'.repeat(4000)), u('z'.repeat(4000))];
  const out = buildContext(
    input({ path, contextLength: 2000, maxOutputTokens: 200, strategy: 'none' }),
  );
  expect(out.messages).toHaveLength(3);
  expect(out.trimmed).toBe(0);
});

test('when only the last message fits, the request is system plus last user message', () => {
  const path = [u('a'.repeat(4000)), a('b'.repeat(4000)), u('last')];
  const out = buildContext(
    input({ path, systemPrompt: 'sys', contextLength: 3000, maxOutputTokens: 200 }),
  );
  expect(out.messages).toEqual([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'last' },
  ]);
  expect(out.trimmed).toBe(2);
});

test('negative or tiny budget never trims the last message and never throws', () => {
  const path = [u('a'.repeat(400)), a('b'.repeat(400)), u('c'.repeat(8000))];
  for (const [contextLength, maxOutputTokens] of [
    [100, 4096],
    [0, 0],
    [-5, 10],
  ] as const) {
    const out = buildContext(input({ path, contextLength, maxOutputTokens }));
    expect(out.messages).toEqual([{ role: 'user', content: 'c'.repeat(8000) }]);
    expect(out.trimmed).toBe(2);
  }
});

test('defaults are used when limits are null', () => {
  expect(DEFAULT_CONTEXT_TOKENS - DEFAULT_OUTPUT_TOKENS - CONTEXT_SAFETY_TOKENS).toBe(122_880);
  const path = [u('x'.repeat(4 * 130_000)), u('y')];
  const out = buildContext(input({ path }));
  expect(out.messages).toEqual([{ role: 'user', content: 'y' }]);
  expect(out.trimmed).toBe(1);
});

test('token estimates', () => {
  expect(estimateTokens('')).toBe(0);
  expect(estimateTokens('abcde')).toBe(2);
  expect(estimateMessageTokens({ role: 'user', content: 'abcd' })).toBe(5);
  expect(
    estimateMessageTokens({
      role: 'user',
      content: [
        { type: 'text', text: 'abcd' },
        { type: 'image', dataUrl: 'data:image/png;base64,AAAA' },
        { type: 'file', filename: 'f.pdf', dataUrl: 'data:application/pdf;base64,AAAA' },
      ],
    }),
  ).toBe(1 + 4 + 1000 + 1000);
  expect(estimateMessageTokens({ role: 'assistant', content: null })).toBe(4);
});

const withFiles = (text: string, files: { id: string; name: string; mime: string }[]) => {
  const m = u(text);
  m.parts.push(
    ...files.map((f) => ({ type: 'attachment' as const, attachmentId: f.id, ...f, size: 1 })),
  );
  return m;
};
const FILES: Record<string, LoadedAttachment> = {
  img: toModelFile('cat.png', 'image/png', Buffer.from([1, 2, 3])),
  doc: toModelFile('report.pdf', 'application/pdf', Buffer.from('%PDF-1.7')),
  txt: toModelFile('notes.txt', 'text/plain', Buffer.from('halo dunia')),
};
const loadAttachment = (id: string) => FILES[id] ?? null;
const attachments = [
  { id: 'img', name: 'cat.png', mime: 'image/png' },
  { id: 'doc', name: 'report.pdf', mime: 'application/pdf' },
  { id: 'txt', name: 'notes.txt', mime: 'text/plain' },
];

test('images and files by capability', () => {
  const { messages } = buildContext(
    input({
      path: [withFiles('look', attachments)],
      loadAttachment,
      modelInput: { images: true, files: false },
    }),
  );
  const content = messages[0]?.content;
  expect(Array.isArray(content)).toBe(true);
  const parts = content as Exclude<typeof content, string | null | undefined>;
  expect(parts).toContainEqual({ type: 'image', dataUrl: 'data:image/png;base64,AQID' });
  expect(parts.some((p) => p.type === 'file')).toBe(false);
  const text = parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n');
  expect(text).toContain('look');
  expect(text).toContain('[Attachment "report.pdf" was not sent: this model can\'t read it.]');
  expect(text).toContain('```notes.txt\nhalo dunia\n```');
});

test('pdfs go as files when the model reads them', () => {
  const { messages } = buildContext(
    input({
      path: [withFiles('look', attachments)],
      loadAttachment,
      modelInput: { images: false, files: true },
    }),
  );
  const parts = messages[0]?.content as { type: string; text?: string }[];
  expect(parts).toContainEqual({
    type: 'file',
    filename: 'report.pdf',
    dataUrl: `data:application/pdf;base64,${Buffer.from('%PDF-1.7').toString('base64')}`,
  });
  const text = parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n');
  expect(text).toContain('[Attachment "cat.png" was not sent: this model can\'t read it.]');
});

test('text-only attachments keep plain string content', () => {
  const { messages } = buildContext(
    input({
      path: [withFiles('look', [attachments[2] as (typeof attachments)[number]])],
      loadAttachment,
    }),
  );
  expect(messages[0]?.content).toBe('look\n\n```notes.txt\nhalo dunia\n```');
});

test('attached text is capped', () => {
  const long = toModelFile('long.txt', 'text/plain', Buffer.from('a'.repeat(150_000)));
  const { messages } = buildContext(
    input({
      path: [withFiles('read', [{ id: 'long', name: 'long.txt', mime: 'text/plain' }])],
      loadAttachment: () => long,
    }),
  );
  const content = messages[0]?.content as string;
  expect(content).toContain(`\`\`\`long.txt\n${'a'.repeat(100_000)}\n\`\`\``);
  expect(content).not.toContain('a'.repeat(100_001));
});

test('a missing file becomes a note', () => {
  const { messages } = buildContext(
    input({
      path: [withFiles('x', [{ id: 'gone', name: 'gone.png', mime: 'image/png' }])],
      loadAttachment,
    }),
  );
  expect(messages[0]?.content).toBe('x\n\n[Attachment "gone.png" is no longer available.]');
});

test('without a loader attachments are left out', () => {
  const { messages } = buildContext(input({ path: [withFiles('x', attachments)] }));
  expect(messages[0]?.content).toBe('x');
});

test.each([
  [null, { images: true, files: true }],
  [{ inputModalities: [] }, { images: true, files: true }],
  [{ inputModalities: ['text'] }, { images: false, files: false }],
  [{ inputModalities: ['text', 'image'] }, { images: true, files: false }],
  [{ inputModalities: ['text', 'file'] }, { images: false, files: true }],
])('model input for %j', (model, out) => {
  expect(modelInputFor(model)).toEqual(out);
});

test('files over the turn budget become a note', () => {
  const { messages } = buildContext(
    input({
      path: [withFiles('x', [{ id: 'big', name: 'big.png', mime: 'image/png' }])],
      loadAttachment: () => 'over-budget',
    }),
  );
  expect(messages[0]?.content).toBe(
    'x\n\n[Attachment "big.png" was not sent: too much attached content in this chat.]',
  );
});

test('the text cap never splits a surrogate pair', () => {
  expect(capText('ab😀', 3)).toEqual({ text: 'ab', cut: true });
  expect(capText('abc😀', 3)).toEqual({ text: 'abc', cut: true });
  expect(capText('ab', 3)).toEqual({ text: 'ab', cut: false });
});

test('a data url is built once and shared by every target', () => {
  const bytes = Buffer.from([1, 2, 3]);
  const spy = vi.spyOn(bytes, 'toString');
  const file = toModelFile('cat.png', 'image/png', bytes);
  const path = [withFiles('look', [{ id: 'img', name: 'cat.png', mime: 'image/png' }])];
  for (let i = 0; i < 3; i += 1) buildContext(input({ path, loadAttachment: () => file }));
  expect(spy).toHaveBeenCalledTimes(1);
});

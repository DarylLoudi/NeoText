import { describe, expect, it } from 'vitest';
import type { MessagePart, MessagePublic, ToolCallPart } from '../chat';
import { applyOp, replayProject } from './replay';
import { PROJECT_LIMITS } from './types';

let seq = 0;
function call(
  name: string,
  args: Record<string, unknown>,
  status: ToolCallPart['status'] = 'ok',
): ToolCallPart {
  seq += 1;
  return {
    type: 'tool_call',
    id: `call_${seq}`,
    name,
    source: 'app',
    args: JSON.stringify(args),
    status,
    result: null,
    startedAt: 0,
    finishedAt: 0,
  };
}

function msg(id: string, role: 'user' | 'assistant', parts: MessagePart[]): MessagePublic {
  return {
    id,
    conversationId: 'c1',
    parentId: null,
    role,
    status: 'complete',
    parts,
    model: null,
    usage: null,
    finishReason: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

const write = (path: string, content: string) => call('write_file', { path, content });
const edit = (path: string, old_text: string, new_text: string) =>
  call('edit_file', { path, old_text, new_text });

describe('applyOp', () => {
  it('creates, then edits a file', () => {
    const files = new Map<string, string>();
    expect(applyOp(files, { kind: 'write', path: 'a.css', content: 'x{color:red}' })).toEqual({
      ok: true,
      change: { path: 'a.css', kind: 'created' },
    });
    expect(applyOp(files, { kind: 'write', path: 'a.css', content: 'y{}' })).toEqual({
      ok: true,
      change: { path: 'a.css', kind: 'edited' },
    });
    expect(applyOp(files, { kind: 'edit', path: 'a.css', oldText: 'y', newText: 'z' })).toEqual({
      ok: true,
      change: { path: 'a.css', kind: 'edited' },
    });
    expect(files.get('a.css')).toBe('z{}');
  });

  it('names a missing text', () => {
    const files = new Map([['style.css', 'a{}']]);
    const r = applyOp(files, { kind: 'edit', path: 'style.css', oldText: 'b', newText: 'c' });
    expect(r).toEqual({
      ok: false,
      error:
        'The text to replace was not found in style.css. Read the file and copy the exact text.',
    });
  });

  it('counts a text that matches more than once', () => {
    const files = new Map([['style.css', 'a a a']]);
    const r = applyOp(files, { kind: 'edit', path: 'style.css', oldText: 'a', newText: 'b' });
    expect(r).toEqual({
      ok: false,
      error:
        'The text to replace appears 3 times in style.css. Include more of the surrounding lines so it matches once.',
    });
    expect(files.get('style.css')).toBe('a a a');
  });

  it('refuses an edit or delete of an unknown file', () => {
    const files = new Map<string, string>();
    const missing = 'There is no file style.css in the project.';
    expect(applyOp(files, { kind: 'edit', path: 'style.css', oldText: 'a', newText: 'b' })).toEqual(
      { ok: false, error: missing },
    );
    expect(applyOp(files, { kind: 'delete', path: 'style.css' })).toEqual({
      ok: false,
      error: missing,
    });
  });

  it('deletes a file', () => {
    const files = new Map([['a.js', '1']]);
    expect(applyOp(files, { kind: 'delete', path: 'a.js' })).toEqual({
      ok: true,
      change: { path: 'a.js', kind: 'deleted' },
    });
    expect(files.size).toBe(0);
  });

  it('holds at most 50 files', () => {
    const files = new Map<string, string>();
    for (let i = 0; i < PROJECT_LIMITS.files; i++) files.set(`f${i}.js`, '');
    expect(applyOp(files, { kind: 'write', path: 'more.js', content: '' })).toEqual({
      ok: false,
      error: 'The project already has 50 files, the most it can hold.',
    });
    // Replacing a file that exists is still fine.
    expect(applyOp(files, { kind: 'write', path: 'f0.js', content: 'x' }).ok).toBe(true);
  });

  it('caps one file at 512 KB, counted in UTF-8 bytes', () => {
    const files = new Map<string, string>();
    const big = 'é'.repeat(PROJECT_LIMITS.fileBytes / 2 + 1);
    expect(applyOp(files, { kind: 'write', path: 'style.css', content: big })).toEqual({
      ok: false,
      error: 'style.css would be larger than 512 KB, the most one file can be.',
    });
  });

  it('caps the project at 2 MB', () => {
    const files = new Map<string, string>();
    const part = 'x'.repeat(500 * 1024);
    for (let i = 0; i < 4; i++) files.set(`p${i}.txt`, part);
    expect(applyOp(files, { kind: 'write', path: 'last.txt', content: part })).toEqual({
      ok: false,
      error: 'The project would be larger than 2 MB, the most it can be.',
    });
  });

  it('refuses an invalid path', () => {
    const r = applyOp(new Map(), { kind: 'write', path: '../x.html', content: '' });
    expect(r.ok).toBe(false);
  });
});

describe('replayProject', () => {
  it('has no files and no versions without project calls', () => {
    const r = replayProject([msg('u1', 'user', [{ type: 'text', text: 'hi' }])]);
    expect(r.files.size).toBe(0);
    expect(r.versions).toEqual([]);
    expect(r.skipped).toBe(0);
  });

  it('makes one version per assistant message that changed files', () => {
    const r = replayProject([
      msg('u1', 'user', []),
      msg('a1', 'assistant', [write('index.html', '<p>1</p>'), write('index.html', '<p>2</p>')]),
      msg('u2', 'user', []),
      msg('a2', 'assistant', [call('read_file', { path: 'index.html' })]),
      msg('u3', 'user', []),
      msg('a3', 'assistant', [write('style.css', 'p{}'), edit('index.html', '2', '3')]),
    ]);
    expect(r.versions.map((v) => [v.messageId, v.number, v.changes])).toEqual([
      ['a1', 1, [{ path: 'index.html', kind: 'created' }]],
      [
        'a3',
        2,
        [
          { path: 'style.css', kind: 'created' },
          { path: 'index.html', kind: 'edited' },
        ],
      ],
    ]);
    expect(r.files.get('index.html')).toBe('<p>3</p>');
    // An earlier version keeps its own files.
    expect(r.versions[0]?.files.get('index.html')).toBe('<p>2</p>');
    expect(r.versions[0]?.files.has('style.css')).toBe(false);
  });

  it('ignores calls that did not succeed and project names in user messages', () => {
    const r = replayProject([
      msg('u1', 'user', [write('a.html', 'no')]),
      msg('a1', 'assistant', [
        call('write_file', { path: 'b.html', content: 'x' }, 'error'),
        call('write_file', { path: 'c.html', content: 'x' }, 'running'),
        call('write_file', { path: 'd.html', content: 'x' }, 'denied'),
        call('fetch_url', { url: 'https://x' }),
      ]),
    ]);
    expect(r.files.size).toBe(0);
    expect(r.versions).toEqual([]);
  });

  it('skips an operation that fails on replay and counts it', () => {
    const r = replayProject([
      msg('a1', 'assistant', [
        write('a.css', 'a'),
        edit('a.css', 'zzz', 'b'),
        call('write_file', { path: 'a.css' }),
      ]),
    ]);
    expect(r.files.get('a.css')).toBe('a');
    expect(r.skipped).toBe(2);
  });

  it('takes named code blocks from a message without project calls', () => {
    const r = replayProject([
      msg('a1', 'assistant', [{ type: 'text', text: '**style.css**\n```css\np{}\n```' }]),
    ]);
    expect(r.files.get('style.css')).toBe('p{}');
    expect(r.versions[0]?.changes).toEqual([{ path: 'style.css', kind: 'created' }]);
  });

  it('ignores code blocks in a message that has a project call', () => {
    const r = replayProject([
      msg('a1', 'assistant', [
        write('a.css', 'real'),
        { type: 'text', text: '```css a.css\nquoted\n```\n```css b.css\nx\n```' },
      ]),
    ]);
    expect(r.files.get('a.css')).toBe('real');
    expect(r.files.has('b.css')).toBe(false);
  });

  it('counts a file created then deleted in one message as nothing changed', () => {
    const r = replayProject([
      msg('a1', 'assistant', [write('a.css', 'a'), call('delete_file', { path: 'a.css' })]),
    ]);
    expect(r.versions).toEqual([]);
  });
});

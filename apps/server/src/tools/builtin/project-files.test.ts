import { describe, expect, test } from 'vitest';
import type { ToolContext, ToolDefinition } from '../types';
import { createProjectTools, projectGuidance, projectListingSource } from './project-files';

const ctx = {} as ToolContext;

function tools(files = new Map<string, string>()) {
  const list = createProjectTools(files);
  const byName = new Map(list.map((t) => [t.name, t]));
  const run = (name: string, args: unknown) =>
    (byName.get(name) as ToolDefinition).execute(args, ctx);
  return { list, files, run };
}

describe('project file tools', () => {
  test('are the four tools, on auto', () => {
    const { list } = tools();
    expect(list.map((t) => [t.name, t.defaultPolicy, t.source])).toEqual([
      ['write_file', 'auto', 'app'],
      ['edit_file', 'auto', 'app'],
      ['delete_file', 'auto', 'app'],
      ['read_file', 'auto', 'app'],
    ]);
    expect(list.every((t) => t.ordered === true)).toBe(true);
    expect(list[0]?.description).toContain('offline');
    expect(list[0]?.description).toContain('only when the user wants a web page or browser app');
  });

  test('write then edit in one turn share the files, and results never echo the content', async () => {
    const { run, files } = tools();
    const content = `<!doctype html>\n${'<p>x</p>\n'.repeat(130)}`;
    expect(await run('write_file', { path: 'index.html', content })).toEqual({
      ok: true,
      content: 'Created index.html (1.2 KB).',
    });
    expect(await run('write_file', { path: './index.html', content })).toEqual({
      ok: true,
      content: 'Replaced index.html (1.2 KB).',
    });
    await run('write_file', { path: 'style.css', content: 'a{}\nb{}\nc{}\nd{}' });
    expect(
      await run('edit_file', {
        path: 'style.css',
        old_text: 'a{}\nb{}\nc{}',
        new_text: 'a{x}\nb{x}\nc{x}',
      }),
    ).toEqual({ ok: true, content: 'Edited style.css (3 lines changed).' });
    expect(files.get('style.css')).toBe('a{x}\nb{x}\nc{x}\nd{}');
  });

  test('read_file numbers the lines', async () => {
    const { run } = tools(new Map([['index.html', '<!doctype html>\n<p>a</p>']]));
    expect(await run('read_file', { path: 'index.html' })).toEqual({
      ok: true,
      content: '1| <!doctype html>\n2| <p>a</p>',
    });
  });

  test('read_file returns a long file in parts the model can ask for', async () => {
    const big = Array.from({ length: 1200 }, (_, i) => `line ${i + 1} ${'x'.repeat(30)}`).join(
      '\n',
    );
    const { run } = tools(new Map([['app.js', big]]));
    const first = await run('read_file', { path: 'app.js' });
    if (!first.ok) throw new Error(first.error);
    expect(first.content.length).toBeLessThanOrEqual(15_000);
    const shown = first.content.split('\n').filter((l) => /^\d+\| /.test(l)).length;
    expect(first.content).toContain(
      `Showing lines 1-${shown} of 1200. Call read_file with start_line=${shown + 1} for more.`,
    );
    const next = await run('read_file', {
      path: 'app.js',
      start_line: shown + 1,
      end_line: shown + 2,
    });
    expect(next).toEqual({
      ok: true,
      content: `${shown + 1}| line ${shown + 1} ${'x'.repeat(30)}\n${shown + 2}| line ${shown + 2} ${'x'.repeat(30)}\n\nShowing lines ${shown + 1}-${shown + 2} of 1200. Call read_file with start_line=${shown + 3} for more.`,
    });
    const last = await run('read_file', { path: 'app.js', start_line: 1200 });
    expect(last).toEqual({ ok: true, content: `1200| line 1200 ${'x'.repeat(30)}` });
  });

  test('read_file refuses a start past the end', async () => {
    const { run } = tools(new Map([['a.js', '1\n2']]));
    expect(await run('read_file', { path: 'a.js', start_line: 5 })).toEqual({
      ok: false,
      error: 'a.js has 2 lines; start_line must be between 1 and 2.',
    });
  });

  test('delete_file removes a file', async () => {
    const { run, files } = tools(new Map([['a.js', '1']]));
    expect(await run('delete_file', { path: 'a.js' })).toEqual({
      ok: true,
      content: 'Deleted a.js.',
    });
    expect(files.size).toBe(0);
  });

  test('errors explain what to do', async () => {
    const { run } = tools(new Map([['style.css', 'a a']]));
    expect(await run('write_file', { path: '../x.html', content: '' })).toEqual({
      ok: false,
      error:
        'Use a relative path such as index.html or css/style.css (letters, digits, . _ - and /; html, css, js, mjs, json, svg, txt or md).',
    });
    expect(await run('edit_file', { path: 'style.css', old_text: 'a', new_text: 'b' })).toEqual({
      ok: false,
      error:
        'The text to replace appears 2 times in style.css. Include more of the surrounding lines so it matches once.',
    });
    expect(await run('read_file', { path: 'nope.css' })).toEqual({
      ok: false,
      error: 'There is no file nope.css in the project.',
    });
    expect(await run('write_file', { path: 'a.css' })).toEqual({
      ok: false,
      error: 'Give "path" and "content" as text.',
    });
    expect(await run('edit_file', { path: 'a.css', old_text: 1 })).toEqual({
      ok: false,
      error: 'Give "path", "old_text" and "new_text" as text.',
    });
  });
});

describe('projectGuidance', () => {
  test('is null for an empty project', () => {
    expect(projectGuidance(new Map(), 0)).toBeNull();
  });

  test('is null for files without an HTML page, such as code blocks of an ordinary answer', () => {
    expect(projectGuidance(new Map([['app.js', '1']]), 1)).toBeNull();
  });

  test('lists files by path with sizes and says how to work on them', () => {
    const line = projectGuidance(
      new Map([
        ['style.css', 'x'.repeat(820)],
        ['index.html', 'x'.repeat(2150)],
      ]),
      3,
    );
    expect(line).toContain(
      'This chat has a web project (version 3): index.html (2.1 KB), style.css (0.8 KB).',
    );
    expect(line).toContain(
      'Read a file with read_file before editing it. The preview runs offline: keep everything in the project (no CDN links, web fonts, remote images or fetch calls); use inline SVG or data: URIs for pictures.',
    );
  });
});

test('the listing source names the tools only for the settings list', async () => {
  expect(await projectListingSource({} as never, { userText: '', webSearch: false })).toEqual([]);
  const listed = await projectListingSource({} as never, null);
  expect(listed.map((t) => t.name)).toEqual([
    'write_file',
    'edit_file',
    'delete_file',
    'read_file',
  ]);
});

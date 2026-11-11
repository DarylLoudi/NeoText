import 'fake-indexeddb/auto';
import type { MessagePart, MessagePublic } from '@neotext/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { closeUserPersistence, openUserPersistence } from '../../lib/persist/db';
import { msg } from '../../test/chat-fixtures';
import { renderWithClient } from '../../test/renderWithClient';
import { ProjectPanelView } from './ProjectPanelView';
import { previewStorage } from './preview-storage';
import { closeProjectPanel, getProjectPanel, openProjectPanel } from './project-panel-state';

let n = 0;
const call = (name: string, args: Record<string, string>): MessagePart => ({
  type: 'tool_call',
  id: `call_${++n}`,
  name,
  source: 'app',
  args: JSON.stringify(args),
  status: 'ok',
  result: null,
  startedAt: 0,
  finishedAt: 0,
});
const write = (path: string, content: string) => call('write_file', { path, content });

const v1 = msg({
  id: 'a1',
  parts: [write('index.html', '<link rel="stylesheet" href="style.css">\n<h1>One</h1>')],
});
const v2 = msg({
  id: 'a2',
  parts: [
    write('style.css', 'h1{color:red}'),
    call('edit_file', { path: 'index.html', old_text: 'One', new_text: 'Two' }),
  ],
});
const user = (id: string) => msg({ id, role: 'user', parts: [{ type: 'text', text: 'go' }] });
const path: MessagePublic[] = [user('u1'), v1, user('u2'), v2];

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await openUserPersistence('u1');
});
afterEach(() => {
  closeProjectPanel();
  closeUserPersistence();
});

function setup(messages = path, messageId: string | null = null) {
  openProjectPanel('cnv_1', messageId);
  return renderWithClient(
    <ProjectPanelView
      conversationId="cnv_1"
      title="Kalkulator"
      path={messages}
      storage={previewStorage}
      messageId={messageId}
      onClose={closeProjectPanel}
    />,
  );
}

test('shows the latest version of the page by default', async () => {
  setup();
  expect(await screen.findByTitle('Preview of index.html')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Version' })).toHaveTextContent('v2 of 2');
  expect(screen.queryByText('A newer version exists')).not.toBeInTheDocument();
});

test('opened from an older answer, it shows that version and says a newer one exists', async () => {
  const { user: u } = setup(path, 'a1');
  expect(await screen.findByRole('combobox', { name: 'Version' })).toHaveTextContent('v1 of 2');
  expect(screen.getByText('A newer version exists')).toBeInTheDocument();
  await u.click(screen.getByRole('button', { name: 'Files' }));
  const files = screen.getByRole('list', { name: 'Files' });
  expect(within(files).getByText('index.html')).toBeInTheDocument();
  expect(within(files).queryByText('style.css')).not.toBeInTheDocument();
});

test('the versions view lists changes and compares with the previous version', async () => {
  const { user: u } = setup();
  await u.click(await screen.findByRole('button', { name: 'Versions' }));
  const list = screen.getByRole('list', { name: 'Versions' });
  expect(within(list).getByText('created style.css, edited index.html')).toBeInTheDocument();
  await u.click(
    within(list).getAllByRole('button', { name: 'Compare with previous' })[0] as HTMLElement,
  );
  expect(screen.getByText('<h1>One</h1>')).toHaveAttribute('data-kind', 'del');
  expect(screen.getByText('<h1>Two</h1>')).toHaveAttribute('data-kind', 'add');
});

test('opened from the newest answer, it follows the versions that come after', async () => {
  const first = [user('u1'), v1];
  const { rerender } = setup(first, 'a1');
  expect(await screen.findByRole('combobox', { name: 'Version' })).toHaveTextContent('v1 of 1');
  rerender(
    <ProjectPanelView
      conversationId="cnv_1"
      title="Kalkulator"
      path={path}
      storage={previewStorage}
      messageId="a1"
      onClose={closeProjectPanel}
    />,
  );
  expect(screen.getByRole('combobox', { name: 'Version' })).toHaveTextContent('v2 of 2');
  expect(screen.queryByText('A newer version exists')).not.toBeInTheDocument();
});

test('another branch shows its own project', async () => {
  const { rerender } = setup();
  await screen.findByRole('combobox', { name: 'Version' });
  rerender(
    <ProjectPanelView
      conversationId="cnv_1"
      title="Kalkulator"
      path={[user('u1'), v1]}
      storage={previewStorage}
      messageId={null}
      onClose={closeProjectPanel}
    />,
  );
  expect(screen.getByRole('combobox', { name: 'Version' })).toHaveTextContent('v1 of 1');
});

test('a project without a page shows its files and says why there is no preview', async () => {
  setup([user('u1'), msg({ id: 'a1', parts: [write('app.js', '1')] })]);
  expect(await screen.findByText('This project has no HTML page to preview.')).toBeInTheDocument();
  expect(screen.getByRole('list', { name: 'Files' })).toHaveTextContent('app.js');
});

test('download saves one html file without the preview runtime', async () => {
  const blobs: Blob[] = [];
  URL.createObjectURL = vi.fn((b: Blob) => {
    blobs.push(b);
    return 'blob:x';
  });
  URL.revokeObjectURL = vi.fn();
  const { user: u } = setup();
  await u.click(await screen.findByRole('button', { name: 'Download .html' }));
  const text = await (blobs[0] as Blob).text();
  expect(text).toContain('<h1>Two</h1>');
  expect(text).toContain('h1{color:red}');
  expect(text).not.toContain('nt-console');
});

test('focus moves into the panel and back to the opener on close', async () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const view = setup();
  const close = await screen.findByRole('button', { name: 'Close preview' });
  await waitFor(() => expect(close).toHaveFocus());
  await view.user.click(close);
  await act(async () => {});
  expect(opener).toHaveFocus();
  opener.remove();
});

const twoPages = [
  user('u1'),
  msg({
    id: 'a1',
    parts: [
      write('index.html', '<a href="about.html">About</a>'),
      write('about.html', '<h1>About</h1>'),
    ],
  }),
];

/** A message from the preview frame's own window. */
function frameSays(data: unknown) {
  const frame = screen.getByTitle(/^Preview of/) as HTMLIFrameElement;
  if (!frame.contentWindow || !('postMessage' in frame.contentWindow)) {
    Object.defineProperty(frame, 'contentWindow', {
      configurable: true,
      value: { postMessage() {} },
    });
  }
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', { data, source: frame.contentWindow as Window }),
    );
  });
}

test('a page that moves itself to another project page switches the preview to it', async () => {
  setup(twoPages);
  await screen.findByTitle('Preview of index.html');
  frameSays({ type: 'nt-preview-ready', path: 'index.html' });
  frameSays({ type: 'nt-preview-ready', path: 'about.html' });
  expect(await screen.findByTitle('Preview of about.html')).toBeInTheDocument();
});

test('moving to a page the project lacks says so and keeps the page it was on', async () => {
  setup(twoPages);
  await screen.findByTitle('Preview of index.html');
  frameSays({ type: 'nt-preview-ready', path: 'index.html' });
  frameSays({ type: 'nt-preview-ready', path: 'nope.html' });
  expect(await screen.findByText('nope.html')).toBeInTheDocument();
  expect(screen.getByText(/Missing from the project/)).toBeInTheDocument();
  expect(screen.getByTitle('Preview of index.html')).toBeInTheDocument();
});

test('Escape the page leaves alone brings focus back to the panel, which a second one closes', async () => {
  const view = setup(twoPages);
  await screen.findByTitle('Preview of index.html');
  const close = screen.getByRole('button', { name: 'Close preview' });
  // Only while the page has focus: a page cannot pull focus out of the app on its own.
  const reload = screen.getByRole('button', { name: 'Reload' });
  reload.focus();
  frameSays({ type: 'nt-escape' });
  expect(reload).toHaveFocus();
  screen.getByTitle('Preview of index.html').focus();
  frameSays({ type: 'nt-escape' });
  expect(close).toHaveFocus();
  expect(screen.getByTitle('Preview of index.html')).toBeInTheDocument();
  expect(getProjectPanel().open).toBe(true);
  await view.user.keyboard('{Escape}');
  expect(getProjectPanel().open).toBe(false);
});

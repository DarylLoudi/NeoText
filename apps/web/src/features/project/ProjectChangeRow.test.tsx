import type { MessagePart, MessagePublic } from '@neotext/shared';
import { screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { msg } from '../../test/chat-fixtures';
import { renderWithClient } from '../../test/renderWithClient';
import { PreviewToggle, ProjectChangeRow } from './ProjectChangeRow';
import { chatProject } from './project-compute';
import { closeProjectPanel, getProjectPanel } from './project-panel-state';

afterEach(() => closeProjectPanel());

const write = (path: string, content: string): MessagePart => ({
  type: 'tool_call',
  id: `w_${path}`,
  name: 'write_file',
  source: 'app',
  args: JSON.stringify({ path, content }),
  status: 'ok',
  result: null,
  startedAt: 0,
  finishedAt: 0,
});
const user = msg({ id: 'u1', role: 'user', parts: [] });
const answer = (id: string, parts: MessagePart[]): MessagePublic => msg({ id, parts });

test('chatProject finds the versions of a path and whether it has a page', () => {
  const project = chatProject([
    user,
    answer('a1', [write('index.html', '<p>a</p>'), write('style.css', 'p{}')]),
  ]);
  expect(project.versions.get('a1')?.number).toBe(1);
  expect(project.hasPage).toBe(true);
  // Files without a page (the code blocks of an ordinary answer) are no project to show.
  const scripts = chatProject([user, answer('a1', [write('app.js', '1')])]);
  expect(scripts.hasPage).toBe(false);
  expect(scripts.versions.size).toBe(0);
  expect(chatProject([user]).versions.size).toBe(0);
});

test('the row names the version and its changes and opens the preview at that answer', async () => {
  const project = chatProject([
    user,
    answer('a1', [write('index.html', '<p>a</p>'), write('style.css', 'p{}')]),
  ]);
  const version = project.versions.get('a1');
  if (!version) throw new Error('no version');
  const { user: u } = renderWithClient(
    <ProjectChangeRow conversationId="cnv_1" messageId="a1" version={version} />,
  );
  expect(screen.getByText('v1 · created index.html, created style.css')).toBeInTheDocument();
  await u.click(screen.getByRole('button', { name: 'Open preview' }));
  expect(getProjectPanel()).toMatchObject({ open: true, conversationId: 'cnv_1', messageId: 'a1' });
});

test('the top bar toggle shows only for a project with a page, and toggles the panel', async () => {
  const { user: u, rerender } = renderWithClient(
    <PreviewToggle conversationId="cnv_1" hasPage={false} />,
  );
  expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
  rerender(<PreviewToggle conversationId="cnv_1" hasPage />);
  const toggle = screen.getByRole('button', { name: 'Preview' });
  await u.click(toggle);
  expect(getProjectPanel()).toMatchObject({ open: true, messageId: null });
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await u.click(toggle);
  expect(getProjectPanel().open).toBe(false);
});

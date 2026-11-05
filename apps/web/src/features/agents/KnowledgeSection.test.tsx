import type { AgentPublic } from '@neotext/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import { resetFakeSettings } from '../../test/fake-settings';
import { server } from '../../test/msw';
import { mockBackend, renderApp } from '../../test/renderApp';
import type { AgentFile } from './knowledge-types';

vi.mock('../../state/settings', () => import('../../test/fake-settings'));

const agent: AgentPublic = {
  id: 'agt_1',
  name: 'Reviewer',
  position: 'a0',
  createdAt: 0,
  updatedAt: 0,
  data: {
    description: 'Reviews code',
    instructions: 'Be strict.',
    model: null,
    tools: { webSearch: true, fetchUrl: true },
    autoDelegate: false,
    enabled: true,
  },
};

const file = (over: Partial<AgentFile> = {}): AgentFile => ({
  id: 'f1',
  agentId: 'agt_1',
  name: 'guide.pdf',
  size: 2048,
  pages: 12,
  chunks: 48,
  status: 'ready',
  error: null,
  createdAt: 0,
  ...over,
});

beforeEach(() => {
  resetFakeSettings();
  mockBackend({ signedIn: true });
});

async function openEditor(files: AgentFile[], isNew = false) {
  server.use(
    http.get('/api/agents', () => HttpResponse.json({ agents: isNew ? [] : [agent] })),
    http.get('/api/agents/agt_1/files', () => HttpResponse.json({ files })),
  );
  const view = renderApp('/settings/agents');
  await screen.findByRole('heading', { level: 1, name: 'Agents' });
  if (isNew) await view.user.click(await screen.findByRole('button', { name: 'New agent' }));
  else await view.user.click(await screen.findByRole('button', { name: 'Edit Reviewer' }));
  return view;
}

test('lists the files with details and status', async () => {
  await openEditor([
    file(),
    file({ id: 'f2', name: 'bad.docx', status: 'failed', pages: null, error: 'No text found' }),
  ]);
  expect(await screen.findByText('guide.pdf')).toBeInTheDocument();
  expect(screen.getByText('2 KB · 12 pages · 48 parts')).toBeInTheDocument();
  expect(screen.getByText('Ready')).toBeInTheDocument();
  expect(screen.getByText('Failed')).toBeInTheDocument();
  expect(screen.getAllByText('No text found').length).toBeGreaterThan(0);
  expect(screen.getByText('2 of 20 files')).toBeInTheDocument();
});

test('a new agent shows the save-first hint', async () => {
  await openEditor([], true);
  expect(await screen.findByText('Save the agent first to add files.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add files' })).toBeNull();
});

test('upload posts multipart', async () => {
  let form: FormData | undefined;
  let sent = 0;
  server.use(
    http.post('/api/agents/agt_1/files', async ({ request }) => {
      sent += 1;
      form = await request.formData();
      return HttpResponse.json(file({ id: 'f9', name: 'notes.md' }), { status: 201 });
    }),
  );
  const { user } = await openEditor([]);
  const input = await screen.findByLabelText('Knowledge files');
  await user.upload(input, new File(['# hi'], 'notes.md', { type: 'text/markdown' }));
  await waitFor(() => expect(sent).toBe(1));
  const sentFile = form?.get('file');
  expect(sentFile instanceof File ? sentFile.name : null).toBe('notes.md');
});

test('a wrong type or too-big file shows an error without a request', async () => {
  let sent = 0;
  server.use(
    http.post('/api/agents/agt_1/files', () => {
      sent += 1;
      return HttpResponse.json(file(), { status: 201 });
    }),
  );
  await openEditor([]);
  const input = await screen.findByLabelText('Knowledge files');
  const exe = new File(['x'], 'tool.exe', { type: 'application/octet-stream' });
  // The accept attribute filters the picker, not drops, so bypass it here.
  fireEvent.change(input, { target: { files: [exe] } });
  expect(await screen.findByText(/This type is not supported/)).toBeInTheDocument();
  const big = new File(['x'], 'big.pdf', { type: 'application/pdf' });
  Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
  fireEvent.change(input, { target: { files: [big] } });
  expect(await screen.findByText(/larger than 10 MB/)).toBeInTheDocument();
  expect(sent).toBe(0);
});

test('delete confirms first', async () => {
  let deleted = 0;
  server.use(
    http.delete('/api/agents/agt_1/files/f1', () => {
      deleted += 1;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { user } = await openEditor([file()]);
  await user.click(await screen.findByRole('button', { name: 'Delete guide.pdf' }));
  expect(deleted).toBe(0);
  const dialog = await screen.findByRole('dialog', { name: 'Delete guide.pdf?' });
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(deleted).toBe(1));
});

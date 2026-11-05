import type { McpServerPublic } from '@neotext/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import { setLocale, translate } from '../../../lib/i18n';
import { server } from '../../../test/msw';
import { renderWithClient } from '../../../test/renderWithClient';
import { McpSettings } from './McpSettings';

const calendar: McpServerPublic = {
  id: 'mcp_1',
  name: 'Calendar',
  url: 'https://calendar.example.com/mcp',
  hasHeaders: true,
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
};
const notes: McpServerPublic = {
  ...calendar,
  id: 'mcp_2',
  name: 'Notes',
  url: 'http://localhost:8080/mcp',
  hasHeaders: false,
  enabled: false,
};

let servers: McpServerPublic[];
let patched: { id: string; body: unknown }[];
let deleted: string[];

beforeEach(() => {
  servers = [calendar, notes];
  patched = [];
  deleted = [];
  server.use(
    http.get('/api/mcp-servers', () => HttpResponse.json({ servers })),
    http.patch('/api/mcp-servers/:id', async ({ params, request }) => {
      const body = (await request.json()) as Partial<McpServerPublic>;
      patched.push({ id: String(params.id), body });
      servers = servers.map((s) => (s.id === params.id ? { ...s, ...body } : s));
      return HttpResponse.json({ server: servers.find((s) => s.id === params.id) });
    }),
    http.delete('/api/mcp-servers/:id', ({ params }) => {
      deleted.push(String(params.id));
      servers = servers.filter((s) => s.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('/api/mcp-servers/:id/test', ({ params }) =>
      params.id === 'mcp_1'
        ? HttpResponse.json({
            ok: true,
            tools: [
              { name: 'calendar__list_events', description: 'List events' },
              { name: 'calendar__create_event', description: '' },
            ],
          })
        : HttpResponse.json({ ok: false, message: 'The server did not answer in time.' }),
    ),
  );
});

test('lists servers with their address and says headers are saved without showing them', async () => {
  renderWithClient(<McpSettings />);
  const rows = await screen.findAllByRole('listitem');
  expect(
    within(rows[0] as HTMLElement).getByText('https://calendar.example.com/mcp'),
  ).toBeVisible();
  expect(within(rows[0] as HTMLElement).getByText('Headers saved')).toBeVisible();
  expect(within(rows[1] as HTMLElement).queryByText('Headers saved')).not.toBeInTheDocument();
  expect(screen.getByText(/ask before running unless you allow them/)).toBeVisible();
});

test('says so when there is no tool server yet', async () => {
  servers = [];
  renderWithClient(<McpSettings />);
  expect(await screen.findByText(/No tool server yet/)).toBeInTheDocument();
});

test('test shows the tools it found and a toast with the count', async () => {
  const { user } = renderWithClient(<McpSettings />);
  await user.click(await screen.findByRole('button', { name: 'Test Calendar' }));
  expect(await screen.findByText('calendar__list_events')).toBeVisible();
  expect(screen.getByText('calendar__create_event')).toBeVisible();
  expect(screen.getByText('Tools found: 2')).toBeVisible();
  expect(await screen.findByText('Calendar works. Tools found: 2')).toBeVisible();
});

test('test shows the error when the server cannot be reached', async () => {
  const { user } = renderWithClient(<McpSettings />);
  await user.click(await screen.findByRole('button', { name: 'Test Notes' }));
  expect(await screen.findByText('The server did not answer in time.')).toBeVisible();
});

test('the switch turns a server on or off through the API', async () => {
  const { user } = renderWithClient(<McpSettings />);
  await user.click(await screen.findByRole('switch', { name: 'Notes' }));
  await waitFor(() => expect(patched).toEqual([{ id: 'mcp_2', body: { enabled: true } }]));
  await waitFor(() => expect(screen.getByRole('switch', { name: 'Notes' })).toBeChecked());
});

test('deleting asks first and then calls the API', async () => {
  const { user } = renderWithClient(<McpSettings />);
  await user.click(await screen.findByRole('button', { name: 'Edit Notes' }));
  const editor = await screen.findByRole('dialog', { name: 'Edit tool server' });
  await user.click(within(editor).getByRole('button', { name: 'Delete tool server' }));
  const confirm = await screen.findByRole('dialog', { name: 'Delete Notes?' });
  expect(deleted).toEqual([]);
  await user.click(within(confirm).getByRole('button', { name: 'Delete tool server' }));
  await waitFor(() => expect(deleted).toEqual(['mcp_2']));
  await waitFor(() =>
    expect(screen.queryByRole('switch', { name: 'Notes' })).not.toBeInTheDocument(),
  );
});

test('each Test button names its server, in Indonesian too', async () => {
  renderWithClient(<McpSettings />);
  expect(await screen.findByRole('button', { name: 'Test Calendar' })).toHaveTextContent('Test');
  act(() => setLocale('id'));
  try {
    const button = screen.getByRole('button', { name: 'Tes koneksi Calendar' });
    expect(button).toHaveTextContent('Tes koneksi');
    expect(translate('settings.mcp.testFailed')).toMatch(/^Tes koneksi gagal\./);
  } finally {
    act(() => setLocale('en'));
  }
});

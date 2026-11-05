import type { McpServerPublic } from '@neotext/shared';
import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import { server } from '../../../test/msw';
import { renderWithClient } from '../../../test/renderWithClient';
import { McpServerForm } from './McpServerForm';

const saved: McpServerPublic = {
  id: 'mcp_1',
  name: 'Calendar',
  url: 'https://calendar.example.com/mcp',
  hasHeaders: true,
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
};

let sent: { method: string; body: unknown }[];

beforeEach(() => {
  sent = [];
  server.use(
    http.post('/api/mcp-servers', async ({ request }) => {
      sent.push({ method: 'POST', body: await request.json() });
      return HttpResponse.json({ server: saved }, { status: 201 });
    }),
    http.patch('/api/mcp-servers/:id', async ({ request }) => {
      sent.push({ method: 'PATCH', body: await request.json() });
      return HttpResponse.json({ server: saved });
    }),
  );
});

test('form validates name and url', async () => {
  const onDone = vi.fn();
  const { user } = renderWithClient(<McpServerForm onDone={onDone} />);
  await user.click(screen.getByRole('button', { name: 'Add tool server' }));
  expect(await screen.findByText('Give the tool server a name.')).toBeVisible();
  expect(screen.getByText(/Enter a full address/)).toBeVisible();
  await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'Calendar');
  await user.type(screen.getByRole('textbox', { name: /^Server URL/ }), 'ftp://example.com');
  await user.click(screen.getByRole('button', { name: 'Add tool server' }));
  expect(await screen.findByText(/Enter a full address/)).toBeVisible();
  expect(sent).toEqual([]);
  expect(onDone).not.toHaveBeenCalled();
});

test('adds a server with a header row', async () => {
  const onDone = vi.fn();
  const { user } = renderWithClient(<McpServerForm onDone={onDone} />);
  await user.type(screen.getByRole('textbox', { name: /^Name/ }), ' Calendar ');
  await user.type(
    screen.getByRole('textbox', { name: /^Server URL/ }),
    'https://calendar.example.com/mcp',
  );
  await user.click(screen.getByRole('button', { name: 'Add header' }));
  await user.type(screen.getByRole('textbox', { name: 'Header 1 name' }), 'Authorization');
  await user.type(screen.getByLabelText('Header 1 value'), 'Bearer abc');
  await user.click(screen.getByRole('button', { name: 'Add tool server' }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(sent).toEqual([
    {
      method: 'POST',
      body: {
        name: 'Calendar',
        url: 'https://calendar.example.com/mcp',
        headers: { Authorization: 'Bearer abc' },
      },
    },
  ]);
});

test('stored header values stay hidden and an untouched set is kept', async () => {
  const onDone = vi.fn();
  const { user } = renderWithClient(<McpServerForm server={saved} onDone={onDone} />);
  expect(screen.getByText('Headers saved. Their values are not shown.')).toBeVisible();
  expect(screen.queryByLabelText(/Header 1/)).not.toBeInTheDocument();
  const name = screen.getByRole('textbox', { name: /^Name/ });
  await user.clear(name);
  await user.type(name, 'Work calendar');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(sent).toEqual([{ method: 'PATCH', body: { name: 'Work calendar' } }]);
});

test('replacing and removing saved headers send what was asked', async () => {
  const first = renderWithClient(<McpServerForm server={saved} onDone={() => {}} />);
  await first.user.click(screen.getByRole('button', { name: 'Replace headers' }));
  await first.user.type(screen.getByRole('textbox', { name: 'Header 1 name' }), 'X-Key');
  await first.user.type(screen.getByLabelText('Header 1 value'), 'k1');
  await first.user.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]?.body).toEqual({ headers: { 'X-Key': 'k1' } });
  first.unmount();

  const second = renderWithClient(<McpServerForm server={saved} onDone={() => {}} />);
  await second.user.click(screen.getByRole('button', { name: 'Remove headers' }));
  await second.user.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(sent).toHaveLength(2));
  expect(sent[1]?.body).toEqual({ headers: null });
});

test('shows the server message when it refuses the name', async () => {
  server.use(
    http.post('/api/mcp-servers', () =>
      HttpResponse.json(
        { error: { code: 'bad_request', message: 'Another tool server already uses that name.' } },
        { status: 400 },
      ),
    ),
  );
  const { user } = renderWithClient(<McpServerForm onDone={() => {}} />);
  await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'Calendar');
  await user.type(screen.getByRole('textbox', { name: /^Server URL/ }), 'https://a.example.com');
  await user.click(screen.getByRole('button', { name: 'Add tool server' }));
  expect(await screen.findByText('Another tool server already uses that name.')).toBeVisible();
});

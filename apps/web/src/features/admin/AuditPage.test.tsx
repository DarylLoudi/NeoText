import { AUDIT_KINDS, type AuditEvent } from '@neotext/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import en from '../../lib/i18n/locales/en.pages.json';
import id from '../../lib/i18n/locales/id.pages.json';
import { server } from '../../test/msw';
import { renderWithClient } from '../../test/renderWithClient';
import { AuditPage } from './AuditPage';
import { auditLabelKey } from './audit-labels';

const NOW = Date.UTC(2026, 10, 5, 12, 0);
let urls: URL[];

const event = (n: number, over: Partial<AuditEvent> = {}): AuditEvent => ({
  id: `aud_${n}`,
  kind: 'auth.login.success',
  userId: 'u1',
  createdAt: NOW - n * 60_000,
  details: {},
  ...over,
});

const users = [
  { id: 'u1', username: 'daryl', displayName: 'Daryl', role: 'admin', status: 'active' },
  { id: 'u2', username: 'ben', displayName: 'Ben', role: 'member', status: 'active' },
].map((u) => ({ ...u, createdAt: NOW, lastSeenAt: null, monthCostUsd: 0 }));

beforeEach(() => {
  urls = [];
  server.use(
    http.get('/api/admin/users', () => HttpResponse.json({ users })),
    http.get('/api/audit', ({ request }) => {
      const url = new URL(request.url);
      urls.push(url);
      const cursor = url.searchParams.get('cursor');
      const userId = url.searchParams.get('userId');
      if (cursor === 'next') {
        return HttpResponse.json({
          items: [event(9, { kind: 'data.exported', details: { format: 'json' } })],
          nextCursor: null,
        });
      }
      if (userId === 'u2') {
        return HttpResponse.json({
          items: [event(5, { kind: 'auth.logout', userId: 'u2' })],
          nextCursor: null,
        });
      }
      return HttpResponse.json({
        items: [
          event(1),
          event(2, { kind: 'admin.invite.created', userId: 'u1' }),
          event(3, { kind: 'auth.login.failure', userId: 'u2' }),
        ],
        nextCursor: 'next',
      });
    }),
  );
});

test('audit labels cover every kind', () => {
  const labels = (locale: typeof en) =>
    (locale.admin as unknown as { audit: { kinds: Record<string, string> } }).audit.kinds;
  for (const kind of AUDIT_KINDS) {
    expect(auditLabelKey(kind), kind).toBe(`admin.audit.kinds.${kind}`);
    expect(labels(en)[kind], `en ${kind}`).toBeTruthy();
    expect(labels(id)[kind], `id ${kind}`).toBeTruthy();
  }
  // No label without a kind: a removed kind should not linger in the locales.
  expect(Object.keys(labels(en)).sort()).toEqual([...AUDIT_KINDS].sort());
  expect(Object.keys(labels(id)).sort()).toEqual([...AUDIT_KINDS].sort());
});

test('shows events as sentences with who and when', async () => {
  renderWithClient(<AuditPage />);
  const row = (await screen.findByText('Signed in')).closest('tr') as HTMLElement;
  expect(within(row).getByText('Daryl')).toBeInTheDocument();
  expect(screen.getByText('Created an invite')).toBeInTheDocument();
  expect(screen.getByText('Failed sign-in attempt').closest('tr')).toHaveTextContent('Ben');
  expect(urls[0]?.searchParams.get('all')).toBe('1');
});

test('filters by user and loads more', async () => {
  renderWithClient(<AuditPage />);
  await screen.findByText('Signed in');
  await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('Exported data')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('combobox', { name: 'Person' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Ben' }));
  await waitFor(() => expect(screen.getByText('Signed out')).toBeInTheDocument());
  expect(screen.queryByText('Signed in')).not.toBeInTheDocument();
  expect(urls.at(-1)?.searchParams.get('userId')).toBe('u2');
});

test('an unknown kind still shows something readable', async () => {
  server.use(
    http.get('/api/audit', () =>
      HttpResponse.json({ items: [event(1, { kind: 'future.thing' })], nextCursor: null }),
    ),
  );
  renderWithClient(<AuditPage />);
  expect(await screen.findByText('future.thing')).toBeInTheDocument();
});

test('an empty log says so', async () => {
  server.use(http.get('/api/audit', () => HttpResponse.json({ items: [], nextCursor: null })));
  renderWithClient(<AuditPage />);
  expect(await screen.findByText('No activity yet.')).toBeInTheDocument();
});

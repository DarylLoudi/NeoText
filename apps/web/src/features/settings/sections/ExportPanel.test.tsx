import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { setLocale } from '../../../lib/i18n';
import { server } from '../../../test/msw';
import { renderWithClient } from '../../../test/renderWithClient';
import { ExportPanel } from './ExportPanel';

let bodies: unknown[];
let downloads: { href: string; download: string }[];
let created: Blob[];

beforeEach(() => {
  bodies = [];
  downloads = [];
  created = [];
  server.use(
    http.post('/api/export', async ({ request }) => {
      const body = (await request.json()) as { format: string };
      bodies.push(body);
      if (body.format === 'markdown') {
        return HttpResponse.json(
          { error: { code: 'internal', message: 'The export could not be built.' } },
          { status: 500 },
        );
      }
      const name = body.format === 'json' ? 'neotext-export-20261103.json' : 'Ekspor café.ntxb';
      return new HttpResponse(new Uint8Array([1, 2, 3]), {
        headers: {
          'content-type': 'application/octet-stream',
          'content-disposition': `attachment; filename="fallback.bin"; filename*=UTF-8''${encodeURIComponent(name)}`,
        },
      });
    }),
  );
  URL.createObjectURL = vi.fn((b: Blob) => {
    created.push(b);
    return 'blob:export';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ href: this.href, download: this.download });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  setLocale('en');
});

test('passphrase rules and download', async () => {
  const { user } = renderWithClient(<ExportPanel />);
  expect(screen.getByRole('radio', { name: /NeoText file/ })).toBeChecked();
  expect(screen.getByText('Keep it safe; it cannot be recovered.')).toBeInTheDocument();

  const pass = screen.getByLabelText('Passphrase');
  const repeat = screen.getByLabelText('Repeat passphrase');
  const exportButton = screen.getByRole('button', { name: 'Export' });

  await user.type(pass, 'pendek');
  await user.click(exportButton);
  expect(await screen.findByText('Use at least 10 characters.')).toBeInTheDocument();
  expect(pass).toHaveAttribute('aria-invalid', 'true');

  await user.clear(pass);
  await user.type(pass, 'kata sandi yang panjang');
  await user.type(repeat, 'kata sandi yang lain');
  await user.click(exportButton);
  expect(await screen.findByText('The passphrases do not match.')).toBeInTheDocument();
  expect(bodies).toEqual([]);

  await user.clear(repeat);
  await user.type(repeat, 'kata sandi yang panjang');
  await user.click(screen.getByRole('switch', { name: 'Include provider keys' }));
  await user.click(exportButton);
  await waitFor(() => expect(downloads).toHaveLength(1));
  expect(bodies).toEqual([
    { format: 'neotext', passphrase: 'kata sandi yang panjang', includeProviderKeys: true },
  ]);
  expect(downloads[0]).toEqual({ href: 'blob:export', download: 'Ekspor café.ntxb' });
  expect(created[0]?.size).toBe(3);
  expect(await screen.findByText('Export downloaded')).toBeInTheDocument();
  // The passphrase does not linger once the file is saved.
  expect(pass).toHaveValue('');
});

test('plain JSON needs the warning ticked', async () => {
  const { user } = renderWithClient(<ExportPanel />);
  await user.click(screen.getByRole('radio', { name: /Plain JSON/ }));
  expect(screen.queryByLabelText('Passphrase')).not.toBeInTheDocument();
  expect(screen.queryByRole('switch', { name: 'Include provider keys' })).not.toBeInTheDocument();
  const exportButton = screen.getByRole('button', { name: 'Export' });
  expect(exportButton).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /not encrypted/ }));
  await user.click(exportButton);
  await waitFor(() => expect(downloads).toHaveLength(1));
  expect(bodies).toEqual([{ format: 'json', confirmPlaintext: true }]);
  expect(downloads[0]?.download).toBe('neotext-export-20261103.json');
});

test('a failed export says what happened', async () => {
  const { user } = renderWithClient(<ExportPanel />);
  await user.click(screen.getByRole('radio', { name: /Markdown/ }));
  await user.click(screen.getByRole('button', { name: 'Export' }));
  expect(await screen.findByText('The export could not be built.')).toBeInTheDocument();
  expect(bodies).toEqual([{ format: 'markdown' }]);
  expect(downloads).toEqual([]);
});

test('says how many attached files the download left out', async () => {
  server.use(
    http.post('/api/export', () =>
      HttpResponse.text('{}', {
        headers: {
          'content-type': 'application/json',
          'content-disposition': 'attachment; filename="neotext-export-20261103.json"',
          'x-skipped-attachments': '2',
        },
      }),
    ),
  );
  const { user } = renderWithClient(<ExportPanel />);
  expect(
    screen.getByText(/Attached files and chats in the trash are not included/, {
      selector: '[id$="-neotext"]',
    }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('radio', { name: /Plain JSON/ }));
  await user.click(screen.getByRole('checkbox', { name: /not encrypted/ }));
  await user.click(screen.getByRole('button', { name: 'Export' }));
  expect(
    await screen.findByText(
      '2 attached files were not included. Open their chats to download them if you need them.',
    ),
  ).toBeInTheDocument();
});

test('an export too large to import again is explained, in Indonesian too', async () => {
  server.use(
    http.post('/api/export', () =>
      HttpResponse.json(
        {
          error: {
            code: 'bad_request',
            message: 'Server wording that may change.',
            details: { reason: 'export_too_large' },
          },
        },
        { status: 400 },
      ),
    ),
  );
  setLocale('id');
  const { user } = renderWithClient(<ExportPanel />);
  await user.type(screen.getByLabelText('Frasa sandi'), 'kata sandi yang panjang');
  await user.type(screen.getByLabelText('Ulangi frasa sandi'), 'kata sandi yang panjang');
  await user.click(screen.getByRole('button', { name: 'Ekspor' }));
  expect(
    await screen.findByText(
      'Obrolanmu terlalu besar untuk satu file NeoText. Ekspor sebagai Markdown saja, atau hapus obrolan yang tidak kamu perlukan lagi lalu coba lagi.',
    ),
  ).toBeInTheDocument();
  expect(downloads).toEqual([]);
});

import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { setLocale } from '../../../lib/i18n';
import { server } from '../../../test/msw';
import { renderWithClient } from '../../../test/renderWithClient';
import { ImportPanel } from './ImportPanel';

let forms: Record<string, string>[];

const failWith = (status: number, code: string, message: string, reason?: string) =>
  HttpResponse.json(
    { error: { code, message, ...(reason ? { details: { reason } } : {}) } },
    { status },
  );

beforeEach(() => {
  forms = [];
  server.use(
    http.post('/api/import', async ({ request }) => {
      const form = await request.formData();
      const seen: Record<string, string> = {};
      for (const [k, v] of form.entries()) seen[k] = typeof v === 'string' ? v : `file:${v.name}`;
      forms.push(seen);
      // Error copy is matched on `details.reason`, never on the server's English text.
      if (seen.source === 'neotext' && seen.passphrase !== 'kata sandi yang panjang') {
        return failWith(400, 'bad_request', 'Server wording that may change.', 'wrong_passphrase');
      }
      if (seen.file === 'file:busy.json') {
        return failWith(429, 'rate_limited', 'Busy.', 'import_busy');
      }
      if (seen.file === 'file:dup.zip') {
        return failWith(400, 'bad_request', 'Dup.', 'zip_duplicate_entry');
      }
      if (seen.file === 'file:odd.json') {
        return failWith(400, 'bad_request', 'Something only the server can say.');
      }
      if (seen.source === 'claude') {
        return failWith(413, 'payload_too_large', 'Too large.');
      }
      return HttpResponse.json({
        imported: 3,
        skipped: 1,
        failed: [
          { title: 'Rusak', code: 'unreadable', reason: 'This conversation could not be read.' },
          { title: null, code: 'invalid_folder', reason: 'A folder in the file is not valid.' },
          {
            title: 'Lokal',
            code: 'provider_rejected',
            reason: 'This address is on a private network.',
          },
          { title: 'Lama', reason: 'A reason with no code.' },
        ],
      });
    }),
  );
});
afterEach(() => {
  setLocale('en');
});

const file = (name: string) => new File(['[]'], name, { type: 'application/json' });

test('shows the summary and failures', async () => {
  const { user } = renderWithClient(<ImportPanel />);
  await user.click(screen.getByRole('radio', { name: 'ChatGPT' }));
  expect(screen.getByText(/Settings → Data controls → Export/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Passphrase')).not.toBeInTheDocument();
  const importButton = screen.getByRole('button', { name: 'Import' });
  expect(importButton).toBeDisabled();
  await user.upload(screen.getByLabelText('File'), file('conversations.json'));
  await user.click(importButton);
  expect(await screen.findByText('3 chats imported')).toBeInTheDocument();
  expect(screen.getByText('1 already here, skipped')).toBeInTheDocument();
  expect(forms).toEqual([{ source: 'chatgpt', file: 'file:conversations.json' }]);
  const failures = screen.getByRole('list', { name: '4 could not be imported' });
  expect(failures).toHaveTextContent('Rusak');
  expect(failures).toHaveTextContent('This conversation could not be read.');
  expect(failures).toHaveTextContent('Untitled');
  // Worded from the code, not the server's text.
  expect(failures).toHaveTextContent('A folder in the file is not valid, so it was skipped.');
  // Endpoint refusals and uncoded reasons keep the server's words.
  expect(failures).toHaveTextContent('This address is on a private network.');
  expect(failures).toHaveTextContent('A reason with no code.');
});

test('a failure code this build does not know still shows the result', async () => {
  server.use(
    http.post('/api/import', () =>
      HttpResponse.json({
        imported: 2,
        skipped: 0,
        failed: [{ title: 'Baru', code: 'from_a_newer_server', reason: 'A newer reason.' }],
      }),
    ),
  );
  const { user } = renderWithClient(<ImportPanel />);
  await user.click(screen.getByRole('radio', { name: 'ChatGPT' }));
  await user.upload(screen.getByLabelText('File'), file('conversations.json'));
  await user.click(screen.getByRole('button', { name: 'Import' }));
  expect(await screen.findByText('2 chats imported')).toBeInTheDocument();
  expect(screen.getByRole('list', { name: '1 could not be imported' })).toHaveTextContent(
    'A newer reason.',
  );
});

test('failures and errors in Indonesian', async () => {
  setLocale('id');
  const { user } = renderWithClient(<ImportPanel />);
  await user.click(screen.getByRole('radio', { name: 'ChatGPT' }));
  const button = screen.getByRole('button', { name: 'Impor' });
  await user.upload(screen.getByLabelText('File'), file('conversations.json'));
  await user.click(button);
  expect(await screen.findByText('3 chat diimpor')).toBeInTheDocument();
  const failures = screen.getByRole('list', { name: '4 tidak bisa diimpor' });
  expect(failures).toHaveTextContent('Percakapan ini tidak bisa dibaca.');
  expect(failures).toHaveTextContent('Ada folder yang tidak valid di dalam file, jadi dilewati.');
  expect(failures).toHaveTextContent('Tanpa judul');

  await user.upload(screen.getByLabelText('File'), file('dup.zip'));
  await user.click(button);
  expect(
    await screen.findByText(
      'Zip ini berisi lebih dari satu conversations.json, jadi tidak diimpor. Pilih zip persis seperti yang dikirim ChatGPT.',
    ),
  ).toBeInTheDocument();
  await user.upload(screen.getByLabelText('File'), file('busy.json'));
  await user.click(button);
  expect(
    await screen.findByText(
      'Ada impor lain yang sedang berjalan di server ini. Coba lagi setelah selesai.',
    ),
  ).toBeInTheDocument();
});

test('a NeoText file needs its passphrase, and known errors are explained', async () => {
  const { user } = renderWithClient(<ImportPanel />);
  expect(screen.getByRole('radio', { name: /NeoText/ })).toBeChecked();
  expect(screen.getByText(/choose a model for the imported chats/)).toBeInTheDocument();
  await user.upload(screen.getByLabelText('File'), file('neotext-export.ntxb'));
  const importButton = screen.getByRole('button', { name: 'Import' });
  await user.click(importButton);
  expect(
    await screen.findByText('Enter the passphrase this file was made with.'),
  ).toBeInTheDocument();
  expect(forms).toEqual([]);

  await user.type(screen.getByLabelText('Passphrase'), 'salah salah salah');
  await user.click(screen.getByRole('switch', { name: 'Also restore settings' }));
  await user.click(importButton);
  expect(
    await screen.findByText('That passphrase does not open this file. Check it and try again.'),
  ).toBeInTheDocument();
  expect(forms[0]).toEqual({
    source: 'neotext',
    file: 'file:neotext-export.ntxb',
    passphrase: 'salah salah salah',
    restoreSettings: 'true',
  });

  await user.clear(screen.getByLabelText('Passphrase'));
  await user.type(screen.getByLabelText('Passphrase'), 'kata sandi yang panjang');
  await user.click(importButton);
  await waitFor(() => expect(screen.getByText('3 chats imported')).toBeInTheDocument());
});

test('a file that is too large says so; unknown errors show the server message', async () => {
  const { user } = renderWithClient(<ImportPanel />);
  await user.click(screen.getByRole('radio', { name: 'Claude' }));
  expect(screen.getByText(/Settings → Privacy → Export data/)).toBeInTheDocument();
  await user.upload(screen.getByLabelText('File'), file('claude.zip'));
  await user.click(screen.getByRole('button', { name: 'Import' }));
  expect(
    await screen.findByText('This file is too large to import. The limit is 200 MB.'),
  ).toBeInTheDocument();
  await user.upload(screen.getByLabelText('File'), file('odd.json'));
  await user.click(screen.getByRole('button', { name: 'Import' }));
  expect(await screen.findByText('Something only the server can say.')).toBeInTheDocument();
});

test('says how many attachment notes the import wrote, in both languages', async () => {
  server.use(
    http.post('/api/import', () =>
      HttpResponse.json({ imported: 1, skipped: 0, failed: [], attachmentNotes: 2 }),
    ),
  );
  const { user } = renderWithClient(<ImportPanel />);
  await user.click(screen.getByRole('radio', { name: 'ChatGPT' }));
  await user.upload(screen.getByLabelText('File'), file('conversations.json'));
  await user.click(screen.getByRole('button', { name: 'Import' }));
  expect(
    await screen.findByText(
      '2 attached files were not in the import. Their messages show the file names instead.',
    ),
  ).toBeInTheDocument();
  setLocale('id');
  expect(
    await screen.findByText(
      '2 file lampiran tidak ada di file impor. Pesannya menampilkan nama file sebagai gantinya.',
    ),
  ).toBeInTheDocument();
});

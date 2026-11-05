import { afterEach, describe, expect, test } from 'vitest';
import { setLocale } from '../i18n';
import { ApiError } from './client';
import { attachmentErrorText, errorText } from './error-text';

afterEach(() => setLocale('en'));

const quota = (details?: unknown) =>
  new ApiError('quota_exceeded', "You've reached your daily budget of $0.50.", 402, details);

describe('error text', () => {
  test('a budget hard stop reads in Indonesian, with the period and the limit', () => {
    setLocale('id');
    expect(errorText(quota({ period: 'daily', limitUsd: 0.5 }), 'x')).toBe(
      'Kamu sudah mencapai anggaran harian sebesar $0,50. Naikkan di Pemakaian, atau tunggu periode berikutnya.',
    );
    expect(errorText(quota({ period: 'monthly', limitUsd: 20 }), 'x')).toContain(
      'anggaran bulanan sebesar $20,00',
    );
    // An older server sends no details: still Indonesian, without the numbers.
    expect(errorText(quota(), 'x')).toBe(
      'Kamu sudah mencapai anggaranmu. Naikkan di Pemakaian, atau tunggu periode berikutnya.',
    );
  });

  test('in English the budget reads like the server says it', () => {
    expect(errorText(quota({ period: 'daily', limitUsd: 0.5 }), 'x')).toBe(
      "You've reached your daily budget of $0.50. Raise it in Usage, or wait for the next period.",
    );
  });

  test('attachment refusals read in Indonesian', () => {
    setLocale('id');
    const big = new ApiError('payload_too_large', 'Files can be up to 20 MB.', 413);
    expect(attachmentErrorText(big, 'x')).toBe(
      'Berkas ini lebih dari 20 MB. Pilih berkas yang lebih kecil.',
    );
    const full = new ApiError('payload_too_large', 'Storage limit reached.', 413, {
      reason: 'attachment_quota',
      limitMb: 2048,
    });
    expect(attachmentErrorText(full, 'x')).toBe(
      'Berkasmu sudah mencapai batas penyimpanan 2048 MB. Hapus obrolan berisi berkas yang tidak kamu perlukan lagi dan kosongkan tempat sampah, lalu coba lagi.',
    );
    const type = new ApiError('unsupported_media_type', "This file type isn't supported.", 415);
    expect(attachmentErrorText(type, 'x')).toBe(
      'Jenis berkas ini tidak didukung. Lampirkan gambar, PDF, atau berkas teks.',
    );
    const mismatch = new ApiError('unsupported_media_type', "Doesn't match.", 415, {
      reason: 'content_mismatch',
    });
    expect(attachmentErrorText(mismatch, 'x')).toBe(
      'Isi berkas ini tidak sesuai dengan jenisnya. Periksa berkasnya lalu coba lagi.',
    );
  });

  test('other errors keep the server message; non-API errors get the fallback', () => {
    setLocale('id');
    const other = new ApiError('rate_limited', 'Too many requests.', 429);
    expect(errorText(other, 'cadangan')).toBe('Too many requests.');
    expect(attachmentErrorText(other, 'cadangan')).toBe('Too many requests.');
    expect(errorText(new Error('boom'), 'cadangan')).toBe('cadangan');
  });
});

test('the admin limit on shared models is worded from its period and amount', () => {
  const err = new ApiError('quota_exceeded', 'English text', 402, {
    period: 'monthly',
    amountUsd: 3,
  });
  expect(errorText(err, 'x')).toBe(
    "You've used your monthly budget on shared models ($3.00). It resets next month (UTC). You can also add your own key in Settings → Providers.",
  );
});

test('the shared-model limit reads in Indonesian', () => {
  setLocale('id');
  const err = new ApiError('quota_exceeded', 'English text', 402, {
    period: 'daily',
    amountUsd: 0.5,
  });
  expect(errorText(err, 'x')).toMatch(/anggaran harian untuk model bersama.*diatur ulang besok/);
});

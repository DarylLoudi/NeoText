import { expect, test } from 'vitest';
import {
  GIF_BYTES,
  JPEG_BYTES,
  PDF_BYTES,
  PNG_BYTES,
  WEBP_BYTES,
} from '../../test-support/attachment-bytes';
import { sniffContent } from './sniff';

test.each([
  ['png', PNG_BYTES, 'image/png'],
  ['jpeg', JPEG_BYTES, 'image/jpeg'],
  ['gif', GIF_BYTES, 'image/gif'],
  ['webp', WEBP_BYTES, 'image/webp'],
  ['pdf', PDF_BYTES, 'application/pdf'],
  ['utf-8 text', Buffer.from('halo'), 'text'],
  ['multi-byte text', Buffer.from('café ☕ 日本'), 'text'],
  ['binary', Buffer.from([0, 1, 2]), null],
  ['invalid utf-8', Buffer.from([0x68, 0xc3, 0x28]), null],
  ['empty', Buffer.alloc(0), null],
])('%s', (_, b, out) => expect(sniffContent(b)).toBe(out));

test('a multi-byte character cut at the 64 KiB edge still counts as text', () => {
  const head = Buffer.alloc(64 * 1024 - 1, 0x61);
  expect(sniffContent(Buffer.concat([head, Buffer.from('é')]))).toBe('text');
});

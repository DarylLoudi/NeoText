import { expect, test } from 'vitest';
import { DOCX_MIME, docxWithParagraphs, pdfWithPages } from '../../../test-support/knowledge-files';
import { extractText, KnowledgeError, knowledgeKind } from './extract';

const live = () => new AbortController().signal;

const reasonOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    if (err instanceof KnowledgeError) return err.reason;
    throw err;
  }
  throw new Error('expected a KnowledgeError');
};

test('a PDF gives its text page by page, skipping blank pages but counting them', async () => {
  const bytes = pdfWithPages(['Limit of a function', '', 'Derivative rules']);
  const out = await extractText('calc.pdf', 'application/pdf', bytes, live());
  expect(out.pageCount).toBe(3);
  expect(out.pages).toEqual([
    { n: 1, text: 'Limit of a function' },
    { n: 3, text: 'Derivative rules' },
  ]);
});

test('a PDF with no text fails as a scanned one; a broken one says it could not be read', async () => {
  const blank = pdfWithPages(['', '']);
  expect(await reasonOf(extractText('scan.pdf', 'application/pdf', blank, live()))).toBe(
    'No text found (scanned PDF?).',
  );
  const broken = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
  expect(await reasonOf(extractText('x.pdf', 'application/pdf', broken, live()))).toMatch(
    /could not be read/,
  );
  expect(await reasonOf(extractText('x.pdf', '', Buffer.from('hello'), live()))).toBe(
    'This is not a PDF.',
  );
});

test('a DOCX gives its paragraphs', async () => {
  const bytes = docxWithParagraphs(['Bab satu', 'Integral tentu']);
  const out = await extractText('notes.docx', DOCX_MIME, bytes, live());
  expect(out.pageCount).toBeNull();
  expect(out.pages).toHaveLength(1);
  expect(out.pages[0]?.text).toContain('Bab satu');
  expect(out.pages[0]?.text).toContain('Integral tentu');
});

test('a DOCX that unpacks past the cap is refused before mammoth reads it', async () => {
  const bomb = docxWithParagraphs(['x'], {
    'word/media/big.bin': new Uint8Array(65 * 1024 * 1024),
  });
  expect(await reasonOf(extractText('bomb.docx', DOCX_MIME, bomb, live()))).toBe(
    'This Word file is too large to open.',
  );
  expect(await reasonOf(extractText('x.docx', DOCX_MIME, Buffer.from('nope'), live()))).toBe(
    'This Word file could not be read.',
  );
});

test('text, Markdown and CSV are read as UTF-8 without a BOM; HTML loses its markup', async () => {
  const txt = await extractText('a.txt', 'text/plain', Buffer.from('﻿halo\r\ndunia'), live());
  expect(txt.pages).toEqual([{ n: null, text: 'halo\ndunia' }]);
  const md = await extractText('a.md', '', Buffer.from('# Judul\n\nIsi.'), live());
  expect(md.pages[0]?.text).toBe('# Judul\n\nIsi.');
  const csv = await extractText('a.csv', 'text/csv', Buffer.from('a,b\n1,2'), live());
  expect(csv.pages[0]?.text).toBe('a,b\n1,2');
  const html = await extractText(
    'a.html',
    'text/html',
    Buffer.from(
      '<html><body><p>Ohm law states <b>V = IR</b>.</p><script>x()</script></body></html>',
    ),
    live(),
  );
  expect(html.pages[0]?.text).toContain('Ohm law states V = IR.');
  expect(html.pages[0]?.text).not.toContain('<');
  expect(html.pages[0]?.text).not.toContain('x()');
});

test('an empty text file has no text; an unsupported type is rejected', async () => {
  expect(await reasonOf(extractText('a.txt', 'text/plain', Buffer.from('  \n '), live()))).toBe(
    'No text found.',
  );
  expect(await reasonOf(extractText('a.png', 'image/png', Buffer.from('x'), live()))).toBe(
    'This file type is not supported.',
  );
  expect(knowledgeKind('photo.png', 'image/png')).toBeNull();
  expect(knowledgeKind('Notes.MD', 'application/octet-stream')).toBe('text');
  expect(knowledgeKind('file', DOCX_MIME)).toBe('docx');
});

test('the deadline is honoured: an aborted signal ends the extraction with its reason', async () => {
  const timedOut = /took too long/;
  expect(
    await reasonOf(extractText('a.txt', 'text/plain', Buffer.from('x'), AbortSignal.abort())),
  ).toMatch(timedOut);
  // HTML is read in a child process, which takes far longer than 20 ms to start.
  const html = Buffer.from('<p>slow</p>');
  expect(await reasonOf(extractText('a.html', 'text/html', html, AbortSignal.timeout(20)))).toMatch(
    timedOut,
  );
});

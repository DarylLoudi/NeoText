import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { renderWithClient } from '../../test/renderWithClient';
import { AttachmentView, hasUsableFiles } from './AttachmentView';

const part = (attachmentId: string, name: string, mime: string) => ({
  type: 'attachment' as const,
  attachmentId,
  name,
  mime,
  size: 2048,
});

test('images are thumbnails, files download, and a missing file has no link', () => {
  renderWithClient(
    <AttachmentView
      parts={[
        part('att_1', 'cat.png', 'image/png'),
        part('att_2', 'report.pdf', 'application/pdf'),
        part('', 'gone.png', 'image/png'),
      ]}
    />,
  );
  expect(screen.getByRole('img', { name: 'cat.png' })).toHaveAttribute(
    'src',
    '/api/attachments/att_1',
  );
  expect(screen.getByRole('link', { name: 'Download report.pdf' })).toHaveAttribute(
    'href',
    '/api/attachments/att_2',
  );
  expect(screen.getByText('gone.png')).toBeInTheDocument();
  expect(screen.getByText('No longer available')).toBeInTheDocument();
  expect(screen.getAllByRole('link')).toHaveLength(2);
});

test('only files that still exist make an edit sendable without text', () => {
  expect(hasUsableFiles([part('att_1', 'a.png', 'image/png')])).toBe(true);
  expect(hasUsableFiles([part('', 'gone.png', 'image/png')])).toBe(false);
  expect(hasUsableFiles([{ type: 'text', text: 'hi' }])).toBe(false);
});

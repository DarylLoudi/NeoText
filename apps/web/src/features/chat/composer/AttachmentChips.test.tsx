import { screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { modelInfo } from '../../../test/model-fixtures';
import { renderWithClient } from '../../../test/renderWithClient';
import { AttachmentChips } from './AttachmentChips';
import type { PendingAttachment } from './attachments';

const item = (over: Partial<PendingAttachment>): PendingAttachment => ({
  key: 'k1',
  name: 'cat.png',
  mime: 'image/png',
  size: 2048,
  status: 'ready',
  progress: 1,
  id: 'att_1',
  error: null,
  ...over,
});

test('shows the warning and removes', async () => {
  const onRemove = vi.fn();
  const { user } = renderWithClient(
    <AttachmentChips
      items={[
        item({}),
        item({ key: 'k2', name: 'notes.txt', mime: 'text/plain', size: 10, id: 'att_2' }),
      ]}
      model={modelInfo({ id: 'plain', inputModalities: ['text'] })}
      onRemove={onRemove}
    />,
  );
  expect(screen.getByText('cat.png')).toBeInTheDocument();
  expect(screen.getByText('2 KB')).toBeInTheDocument();
  expect(screen.getAllByText("This model can't read images")).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'Remove notes.txt' }));
  expect(onRemove).toHaveBeenCalledWith('k2');
});

test('no warning for a model that reads images', () => {
  renderWithClient(
    <AttachmentChips
      items={[item({})]}
      model={modelInfo({ id: 'vision', inputModalities: ['text', 'image'] })}
      onRemove={() => {}}
    />,
  );
  expect(screen.queryByText("This model can't read images")).toBeNull();
});

test('shows upload progress and errors', () => {
  renderWithClient(
    <AttachmentChips
      items={[
        item({ status: 'uploading', progress: 0.4, id: null }),
        item({ key: 'k2', name: 'bad.png', status: 'error', id: null, error: 'Not an image' }),
      ]}
      model={null}
      onRemove={() => {}}
    />,
  );
  expect(screen.getByRole('progressbar', { name: 'Uploading cat.png' })).toHaveAttribute(
    'aria-valuenow',
    '40',
  );
  expect(screen.getByText('Not an image')).toBeInTheDocument();
});

test('nothing renders without items', () => {
  const { container } = renderWithClient(
    <AttachmentChips items={[]} model={null} onRemove={() => {}} />,
  );
  expect(container.querySelector('ul')).toBeNull();
});

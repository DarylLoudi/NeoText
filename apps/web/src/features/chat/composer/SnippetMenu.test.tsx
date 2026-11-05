import type { Snippet } from '@neotext/shared';
import { screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { expect, test, vi } from 'vitest';
import { renderWithClient } from '../../../test/renderWithClient';
import { SnippetMenu } from './SnippetMenu';

const SNIPPETS: Snippet[] = [
  { id: '1', trigger: 'sum', title: 'Summarise', body: 'Summarise this briefly.' },
  { id: '2', trigger: 'tr', title: 'Translate', body: 'Translate to {{language}}: {{text}}' },
];

function Harness({ onEnter }: { onEnter: () => void }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  return (
    <>
      <textarea
        ref={field}
        aria-label="Message"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEnter();
        }}
      />
      <SnippetMenu field={field} text={text} snippets={SNIPPETS} onChange={setText} />
    </>
  );
}

test('the menu opens on a slash and inserts the body', async () => {
  const onEnter = vi.fn();
  const { user } = renderWithClient(<Harness onEnter={onEnter} />);
  await user.type(screen.getByLabelText('Message'), '/su');
  expect(screen.getByRole('option', { name: /Summarise/ })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /Translate/ })).toBeNull();
  await user.keyboard('{Enter}');
  expect(screen.getByLabelText('Message')).toHaveValue('Summarise this briefly.');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(onEnter).not.toHaveBeenCalled();
});

test('arrows move and Tab selects', async () => {
  const { user } = renderWithClient(<Harness onEnter={() => {}} />);
  await user.type(screen.getByLabelText('Message'), '/');
  await user.keyboard('{ArrowDown}{Tab}');
  expect(screen.getByRole('textbox', { name: 'language' })).toBeInTheDocument();
});

test('Escape closes the menu and leaves the text', async () => {
  const { user } = renderWithClient(<Harness onEnter={() => {}} />);
  await user.type(screen.getByLabelText('Message'), '/su');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(screen.getByLabelText('Message')).toHaveValue('/su');
});

test('Enter reaches the field when the menu is closed', async () => {
  const onEnter = vi.fn();
  const { user } = renderWithClient(<Harness onEnter={onEnter} />);
  await user.type(screen.getByLabelText('Message'), 'hello{Enter}');
  expect(onEnter).toHaveBeenCalledTimes(1);
});

test('variables open a dialog first', async () => {
  const { user } = renderWithClient(<Harness onEnter={() => {}} />);
  await user.type(screen.getByLabelText('Message'), '/tr{Enter}');
  expect(screen.getByLabelText('Message')).toHaveValue('/tr');
  await user.type(screen.getByRole('textbox', { name: 'language' }), 'French');
  await user.type(screen.getByRole('textbox', { name: 'text' }), 'hello');
  await user.click(screen.getByRole('button', { name: 'Insert' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Message')).toHaveValue('Translate to French: hello'),
  );
});

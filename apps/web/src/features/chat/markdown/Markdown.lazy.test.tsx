import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { Markdown } from './Markdown';

// As on a first visit: the renderer's chunk has not arrived when the message first renders.
vi.mock('./engine', async (importOriginal) => {
  const original = await importOriginal<typeof import('./engine')>();
  return { ...original, markdownEngine: () => null };
});

test('shows the text as written until the renderer loads, then the markdown', async () => {
  render(<Markdown text={'Some **bold** words\n\nand a second line'} />);
  expect(screen.getByText(/Some \*\*bold\*\* words/)).toBeInTheDocument();
  expect(document.querySelector('strong')).toBeNull();

  expect(await screen.findByText('bold')).toHaveProperty('tagName', 'STRONG');
  expect(screen.queryByText(/\*\*bold\*\*/)).toBeNull();
});

import type { Source } from '@neotext/shared';
import { screen, waitFor } from '@testing-library/react';
import { useMemo } from 'react';
import { expect, test } from 'vitest';
import { renderWithClient } from '../../../test/renderWithClient';
import { Markdown } from '../markdown/Markdown';
import { CitationCard, useCitationCard } from './CitationCard';
import { citationLinks } from './citations';

const XSS = '<img src=x onerror=alert(1)> **bold**';

const sources: Source[] = [
  {
    n: 1,
    url: 'https://nodejs.org/en/learn',
    title: 'Learn Node.js',
    domain: 'nodejs.org',
    snippet: 'Guides for the runtime.',
  },
  { n: 2, url: 'https://web.dev/cache', title: XSS, domain: 'web.dev', snippet: XSS },
];

const TEXT = 'See [the guide](https://nodejs.org/en/learn/) and [caching](https://web.dev/cache).';

function Harness({ text = TEXT }: { text?: string }) {
  const linkClass = useMemo(() => citationLinks(sources), []);
  const card = useCitationCard();
  return (
    <>
      <Markdown text={text} linkClass={linkClass} onCitation={card.onCitation} />
      <button type="button">elsewhere</button>
      <CitationCard sources={sources} anchor={card.anchor} onClose={card.close} />
    </>
  );
}

const link = (name: string) => screen.getByRole('link', { name });

test('matching links become numbered citation chips', () => {
  renderWithClient(<Harness />);
  expect(link('Source 1: the guide')).toHaveClass('md-cite');
  expect(link('Source 1: the guide')).toHaveAttribute('data-source', '1');
  expect(link('Source 2: caching')).toHaveAttribute('data-source', '2');
});

test('the open card describes its chip', async () => {
  const { user } = renderWithClient(<Harness />);
  expect(link('Source 1: the guide')).not.toHaveAttribute('aria-describedby');
  await user.tab();
  expect(link('Source 1: the guide')).toHaveAccessibleDescription(
    expect.stringContaining('Guides for the runtime.'),
  );
  await user.keyboard('{Escape}');
  await waitFor(() => expect(link('Source 1: the guide')).not.toHaveAttribute('aria-describedby'));
});

test('a card dismissed with Escape stays closed when the pointer passes another chip', async () => {
  const { user } = renderWithClient(<Harness />);
  await user.tab();
  expect(screen.getByText('Guides for the runtime.')).toBeInTheDocument();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByText('Guides for the runtime.')).toBeNull());
  await user.hover(link('Source 2: caching'));
  expect(await screen.findByText('web.dev')).toBeInTheDocument();
  await user.unhover(link('Source 2: caching'));
  await waitFor(() => expect(screen.queryByText('web.dev')).toBeNull());
  // Give the close delay time to run: the first chip's card must not come back.
  await new Promise((r) => setTimeout(r, 300));
  expect(screen.queryByText('Guides for the runtime.')).toBeNull();
});

test('hovering a citation shows its source after a short delay', async () => {
  const { user } = renderWithClient(<Harness />);
  await user.hover(link('Source 1: the guide'));
  expect(screen.queryByText('Guides for the runtime.')).toBeNull();
  expect(await screen.findByText('Guides for the runtime.')).toBeInTheDocument();
  expect(screen.getByText('Learn Node.js')).toBeInTheDocument();
  await user.unhover(link('Source 1: the guide'));
  await waitFor(() => expect(screen.queryByText('Guides for the runtime.')).toBeNull());
});

test('focus opens it at once; Escape and blur close it', async () => {
  const { user } = renderWithClient(<Harness />);
  await user.tab();
  expect(link('Source 1: the guide')).toHaveFocus();
  expect(screen.getByText('Guides for the runtime.')).toBeInTheDocument();
  // The card never takes focus from the text.
  expect(link('Source 1: the guide')).toHaveFocus();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByText('Guides for the runtime.')).toBeNull());

  await user.tab();
  expect(link('Source 2: caching')).toHaveFocus();
  expect(await screen.findByText('web.dev')).toBeInTheDocument();
  await user.tab();
  await waitFor(() => expect(screen.queryByText('web.dev')).toBeNull());
});

test('snippets are plain text', async () => {
  const { user } = renderWithClient(<Harness />);
  await user.hover(link('Source 2: caching'));
  const card = await screen.findByRole('dialog');
  expect(card.textContent).toContain(XSS);
  expect(card.querySelector('img:not([data-favicon])')).toBeNull();
  expect(card.querySelector('strong')).toBeNull();
});

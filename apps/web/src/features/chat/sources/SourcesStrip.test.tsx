import type { Source } from '@neotext/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { renderWithClient } from '../../../test/renderWithClient';
import { TooltipProvider } from '../../../ui';
import { SourcesStrip } from './SourcesStrip';

const XSS = '<img src=x onerror=alert(1)> **bold**';

function source(n: number, over: Partial<Source> = {}): Source {
  return {
    n,
    url: `https://www.site${n}.test/page`,
    title: `Article number ${n}`,
    domain: `site${n}.test`,
    snippet: `Snippet for article ${n}`,
    ...over,
  };
}

const nine = Array.from({ length: 9 }, (_, i) => source(i + 1));

let width = 800;
beforeEach(() => {
  width = 800;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({ width, height: 100, top: 0, left: 0, right: width, bottom: 100, x: 0, y: 0 }) as DOMRect,
  );
});
afterEach(() => vi.restoreAllMocks());

const cardTitles = () =>
  within(screen.getByRole('list', { name: 'Sources on this page' }))
    .getAllByRole('link')
    .map((a) => a.textContent);

test('pages through sources', async () => {
  const { user } = renderWithClient(<SourcesStrip sources={nine} />);
  expect(screen.getByText('1–4 of 9')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous sources' })).toBeDisabled();
  expect(cardTitles()).toHaveLength(4);
  await user.click(screen.getByRole('button', { name: 'Next sources' }));
  expect(screen.getByText('5–8 of 9')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Next sources' }));
  expect(screen.getByText('9 of 9')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next sources' })).toBeDisabled();
  expect(cardTitles()).toHaveLength(1);
});

test('cards open the page in a new tab and show the number on a tag', () => {
  renderWithClient(<SourcesStrip sources={nine} />);
  const first = within(screen.getByRole('list', { name: 'Sources on this page' })).getAllByRole(
    'link',
  )[0];
  expect(first).toHaveAttribute('href', 'https://www.site1.test/page');
  expect(first).toHaveAttribute('target', '_blank');
  expect(first).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  expect(first).toHaveAttribute('title', 'Snippet for article 1');
  expect(first).toHaveTextContent('1');
  expect(first).toHaveTextContent('site1.test');
  expect(first).toHaveTextContent('Article number 1');
});

test('arrow keys change pages', async () => {
  const { user } = renderWithClient(<SourcesStrip sources={nine} />);
  const first = within(screen.getByRole('list', { name: 'Sources on this page' })).getAllByRole(
    'link',
  )[0];
  first?.focus();
  await user.keyboard('{ArrowRight}');
  expect(screen.getByText('5–8 of 9')).toBeInTheDocument();
  // Focus follows to the new page instead of falling back to the page body.
  expect(document.activeElement).toHaveTextContent('Article number 5');
  await user.keyboard('{ArrowLeft}');
  expect(screen.getByText('1–4 of 9')).toBeInTheDocument();
  await user.keyboard('{ArrowLeft}');
  expect(screen.getByText('1–4 of 9')).toBeInTheDocument();
});

test('page size follows the width', () => {
  width = 400;
  renderWithClient(<SourcesStrip sources={nine} />);
  expect(screen.getByText('1–2 of 9')).toBeInTheDocument();
});

test('the page is kept when more sources stream in', async () => {
  const user = userEvent.setup();
  const { rerender } = render(<SourcesStrip sources={nine.slice(0, 6)} />, {
    wrapper: TooltipProvider,
  });
  await user.click(screen.getByRole('button', { name: 'Next sources' }));
  expect(screen.getByText('5–6 of 6')).toBeInTheDocument();
  const live = document.querySelector('[aria-live="polite"]');
  expect(live).toHaveTextContent('Sources 5–6 of 6');
  rerender(<SourcesStrip sources={nine} />);
  expect(screen.getByText('5–8 of 9')).toBeInTheDocument();
  // Streamed sources update the range quietly; only paging is announced.
  expect(live).toHaveTextContent('Sources 5–6 of 6');
});

test('nothing is announced before the reader pages', () => {
  renderWithClient(<SourcesStrip sources={nine} />);
  expect(document.querySelector('[aria-live="polite"]')).toBeEmptyDOMElement();
});

test('one page needs no pager', () => {
  renderWithClient(<SourcesStrip sources={nine.slice(0, 3)} />);
  expect(screen.getByText('1–3 of 3')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Next sources' })).toBeNull();
});

test('drawer lists all and filters', async () => {
  const sources = [
    ...nine.slice(0, 8),
    source(9, { title: 'Caching in Node', domain: 'nodejs.org', snippet: 'Use a Map.' }),
  ];
  const { user } = renderWithClient(<SourcesStrip sources={sources} />);
  await user.click(screen.getByRole('button', { name: 'All sources' }));
  const dialog = screen.getByRole('dialog', { name: 'All sources' });
  expect(within(dialog).getAllByRole('listitem')).toHaveLength(9);

  const search = within(dialog).getByRole('searchbox', { name: 'Search sources' });
  await waitFor(() => expect(search).toHaveFocus());
  await user.type(search, 'NODEJS{ArrowLeft}{ArrowRight}');
  // Arrow keys in the search field move its caret, not the strip's page.
  expect(screen.getByText('1–4 of 9')).toBeInTheDocument();
  expect(within(dialog).getAllByRole('listitem')).toHaveLength(1);
  await user.clear(search);
  await user.type(search, 'use a map');
  expect(within(dialog).getByText('Caching in Node')).toBeInTheDocument();
  await user.clear(search);
  await user.type(search, 'article 3');
  expect(within(dialog).getAllByRole('listitem')).toHaveLength(1);
  await user.clear(search);
  await user.type(search, 'nothing like this');
  expect(within(dialog).queryAllByRole('listitem')).toHaveLength(0);
  expect(within(dialog).getByText('No sources match “nothing like this”.')).toBeInTheDocument();
});

test('snippets are plain text', async () => {
  const sources = [source(1, { title: XSS, snippet: XSS })];
  const { user } = renderWithClient(<SourcesStrip sources={sources} />);
  const strip = screen.getByRole('region', { name: 'Sources' });
  expect(strip.querySelector('img:not([data-favicon])')).toBeNull();
  expect(strip).toHaveTextContent(XSS);

  await user.click(screen.getByRole('button', { name: 'All sources' }));
  const dialog = screen.getByRole('dialog', { name: 'All sources' });
  expect(dialog.textContent).toContain(XSS);
  expect(dialog.querySelector('img:not([data-favicon])')).toBeNull();
  expect(dialog.querySelector('strong')).toBeNull();
});

test('favicon falls back to a letter', () => {
  renderWithClient(<SourcesStrip sources={[source(1, { domain: 'nodejs.org' })]} />);
  const img = screen.getByRole('region', { name: 'Sources' }).querySelector('img');
  expect(img).toHaveAttribute('src', '/api/favicon?host=www.site1.test');
  expect(img).toHaveAttribute('loading', 'lazy');
  act(() => {
    if (img) fireEvent.error(img);
  });
  const region = screen.getByRole('region', { name: 'Sources' });
  expect(region.querySelector('img')).toBeNull();
  expect(region.querySelector('[data-favicon-letter]')).toHaveTextContent('N');
});

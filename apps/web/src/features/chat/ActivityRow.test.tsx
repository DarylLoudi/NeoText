import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ActivityRow } from './ActivityRow';

test('says what the answer is doing while it streams', () => {
  const { rerender, container } = render(
    <ActivityRow activity="searching" streaming searches={0} />,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Searching the web…');
  rerender(<ActivityRow activity="processing" streaming searches={0} />);
  expect(screen.getByRole('status')).toHaveTextContent('Working…');
  rerender(<ActivityRow activity="idle" streaming searches={2} />);
  expect(container).toBeEmptyDOMElement();
});

test('after it finishes, one line counts the searches', () => {
  const { rerender, container } = render(
    <ActivityRow activity="idle" streaming={false} searches={3} />,
  );
  expect(screen.getByText('Searched the web 3 times')).toBeInTheDocument();
  rerender(<ActivityRow activity="idle" streaming={false} searches={1} />);
  expect(screen.getByText('Searched the web once')).toBeInTheDocument();
  rerender(<ActivityRow activity="idle" streaming={false} searches={0} />);
  expect(container).toBeEmptyDOMElement();
});

import { screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { mockBackend, renderApp } from '../test/renderApp';

vi.mock('../state/settings', () => import('../test/fake-settings'));

test('shows the wordmark', async () => {
  mockBackend();
  renderApp('/login');
  expect(await screen.findByText('neotext')).toBeInTheDocument();
});

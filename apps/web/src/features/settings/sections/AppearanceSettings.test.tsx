import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  getSettingsState,
  updateSettings as realUpdate,
  teardownSettings,
} from '../../../state/settings';
import { renderWithClient } from '../../../test/renderWithClient';
import { AppearanceSettings } from './AppearanceSettings';

// The real store, so a change reaches the document; the spy only records the calls.
vi.mock('../../../state/settings', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../state/settings')>();
  return { ...real, updateSettings: vi.fn(real.updateSettings) };
});

const root = document.documentElement;

beforeEach(() => {
  vi.mocked(realUpdate).mockClear();
});
afterEach(async () => {
  await teardownSettings();
  for (const a of [
    'data-theme',
    'data-accent',
    'data-ui-font',
    'data-reading-font',
    'data-code-font',
    'data-width',
    'data-density',
    'data-motion',
  ]) {
    root.removeAttribute(a);
  }
});

test('appearance changes apply at once', async () => {
  const { user } = renderWithClient(<AppearanceSettings />);
  await user.click(screen.getByRole('radio', { name: 'Light' }));
  expect(root.dataset.theme).toBe('light');
  expect(realUpdate).toHaveBeenCalledWith({ appearance: { theme: 'light' } });
  expect(getSettingsState().settings.appearance.theme).toBe('light');

  await user.click(screen.getByRole('radio', { name: 'Dark' }));
  expect(root.dataset.theme).toBe('dark');
});

test('accent swatches are named choices and apply at once', async () => {
  const { user } = renderWithClient(<AppearanceSettings />);
  expect(screen.getByRole('radio', { name: 'Neutral' })).toBeChecked();
  await user.click(screen.getByRole('radio', { name: 'Mint' }));
  expect(root.dataset.accent).toBe('mint');
  expect(realUpdate).toHaveBeenCalledWith({ appearance: { accent: 'mint' } });
});

test('fonts, width and density are choices that apply at once', async () => {
  const { user } = renderWithClient(<AppearanceSettings />);
  const reading = screen.getByRole('group', { name: 'Reading font' });
  await user.click(within(reading).getByRole('radio', { name: 'System' }));
  expect(root.dataset.readingFont).toBe('system');
  await user.click(screen.getByRole('radio', { name: 'Wide' }));
  expect(root.dataset.width).toBe('wide');
  await user.click(screen.getByRole('radio', { name: 'Compact' }));
  expect(root.dataset.density).toBe('compact');
});

test('text size is a slider and shows the percentage', async () => {
  renderWithClient(<AppearanceSettings />);
  const slider = screen.getByRole('slider', { name: 'Text size' });
  fireEvent.change(slider, { target: { value: '1.125' } });
  expect(root.style.getPropertyValue('--font-scale')).toBe('1.125');
  expect(screen.getByText('113%')).toBeInTheDocument();
});

test('a sample paragraph and a code line show the fonts being chosen', () => {
  renderWithClient(<AppearanceSettings />);
  const sample = screen.getByTestId('font-sample');
  expect(sample).toHaveTextContent(/Settings change the page as you pick them/);
  expect(within(sample).getByText(/const answer = 42/)).toBeInTheDocument();
});

test('switches save a boolean', async () => {
  const { user } = renderWithClient(<AppearanceSettings />);
  const cost = screen.getByRole('switch', { name: 'Show cost under answers' });
  expect(cost).toBeChecked();
  await user.click(cost);
  expect(realUpdate).toHaveBeenCalledWith({ appearance: { showCost: false } });
});

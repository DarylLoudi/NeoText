import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Dialog } from '../../ui/Dialog/Dialog';
import { ToastHost, toast } from '../../ui/Toast/Toast';
import { getLocale, initI18n, resolveLocale, setLocale, translate } from './index';

afterEach(() => {
  void initI18n('en');
  vi.unstubAllGlobals();
});

describe('i18n', () => {
  test('resolveLocale maps auto from navigator.language', () => {
    expect(resolveLocale('auto', 'id-ID')).toBe('id');
    expect(resolveLocale('auto', 'id')).toBe('id');
    expect(resolveLocale('auto', 'en-GB')).toBe('en');
    expect(resolveLocale('auto', 'fr')).toBe('en');
    expect(resolveLocale('id', 'en')).toBe('id');
  });

  test('initI18n(auto) reads navigator.language', () => {
    vi.stubGlobal('navigator', { language: 'id-ID' });
    void initI18n('auto');
    expect(getLocale()).toBe('id');
  });

  test('setLocale switches the active language', () => {
    void initI18n('en');
    expect(translate('common.close')).toBe('Close');
    setLocale('id');
    expect(translate('common.close')).toBe('Tutup');
  });

  test('a locale that is not loaded yet is fetched, then switched to', async () => {
    i18next.removeResourceBundle('id', 'translation');
    await initI18n('id');
    expect(getLocale()).toBe('id');
    expect(translate('common.close')).toBe('Tutup');
  });

  test('English stays until the other locale has arrived', async () => {
    i18next.removeResourceBundle('id', 'translation');
    const switching = initI18n('id');
    expect(getLocale()).toBe('en');
    await switching;
    expect(getLocale()).toBe('id');
  });

  test('Dialog close label follows the locale', () => {
    void initI18n('id');
    render(
      <Dialog open onOpenChange={() => {}} title="T">
        x
      </Dialog>,
    );
    expect(screen.getByRole('button', { name: 'Tutup' })).toBeInTheDocument();
  });

  test('ToastHost dismiss label follows the locale', () => {
    void initI18n('id');
    toast({ message: 'Hi' });
    render(<ToastHost />);
    expect(screen.getByRole('button', { name: 'Tutup pemberitahuan' })).toBeInTheDocument();
  });
});

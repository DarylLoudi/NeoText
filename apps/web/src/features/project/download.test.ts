import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadPage } from './download';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('downloadPage', () => {
  it('names the file after the chat and frees the link only after the download started', () => {
    vi.useFakeTimers();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    downloadPage('Kalkulator: v2 / final!', '<p>a</p>');
    expect(create).toHaveBeenCalledTimes(1);
    expect(names).toEqual(['Kalkulator v2  final.html']);
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:x');
  });

  it('falls back to project.html for a title with nothing usable', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:y');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    downloadPage('!!!', '<p>a</p>');
    expect(names).toEqual(['project.html']);
  });
});

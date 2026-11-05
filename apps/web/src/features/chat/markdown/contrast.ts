import type { ThemeRegistrationRaw } from 'shiki/core';

export type CardMode = 'light' | 'dark';

/** The code card sits on `--shelf` (tokens.css), which does not change with the accent. */
const CARD_BACKGROUND: Record<CardMode, string> = { light: '#f1f2ef', dark: '#16191c' };
const MIN_CONTRAST = 4.5;
const HEX = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/**
 * Makes one color opaque and, if it is under 4.5:1 on the card, pulls it toward black (light
 * card) or white (dark card) in 5% steps until it passes. Colors that already pass keep their hue.
 */
export function readableColor(color: string, mode: CardMode): string {
  if (!HEX.test(color)) return color;
  const base = toRgb(color);
  const background = toRgb(CARD_BACKGROUND[mode]);
  const target = mode === 'light' ? 0 : 255;
  for (let step = 0; step <= 20; step++) {
    const t = step / 20;
    // Rounded first, so the contrast checked is the contrast of the color that gets written.
    const rgb = base.map((c) => Math.round(c + (target - c) * t)) as Rgb;
    if (contrast(rgb, background) >= MIN_CONTRAST) return toHex(rgb);
  }
  return toHex([target, target, target]);
}

/**
 * Returns a copy of a Shiki theme whose every token color is opaque and readable on the code
 * card. The stock themes put comments and keywords at 1.6:1 to 4.3:1 on `--shelf`.
 */
export function withReadableColors(
  theme: ThemeRegistrationRaw,
  mode: CardMode,
): ThemeRegistrationRaw {
  const fixRules = <T extends { settings?: { foreground?: string } }>(rules: T[] | undefined) =>
    rules?.map((rule) =>
      rule.settings?.foreground
        ? {
            ...rule,
            settings: {
              ...rule.settings,
              foreground: readableColor(rule.settings.foreground, mode),
            },
          }
        : rule,
    );

  const next: { -readonly [K in keyof ThemeRegistrationRaw]: ThemeRegistrationRaw[K] } = {
    ...theme,
  };
  if (theme.tokenColors) next.tokenColors = fixRules(theme.tokenColors);
  if (theme.settings) next.settings = fixRules(theme.settings) ?? theme.settings;
  if (theme.fg) next.fg = readableColor(theme.fg, mode);
  const foreground = theme.colors?.['editor.foreground'];
  if (theme.colors && foreground) {
    next.colors = { ...theme.colors, 'editor.foreground': readableColor(foreground, mode) };
  }
  return next;
}

export interface NumberRule {
  min: number;
  max: number;
  integer?: boolean;
  /** `min` itself is not allowed, only numbers above it. */
  aboveMin?: boolean;
}

export type ParsedNumber = { ok: true; value: number | null } | { ok: false };

/** Empty text is "not set" (null); anything else must be a number inside the rule. */
export function parseNumber(text: string, rule: NumberRule): ParsedNumber {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < rule.min || n > rule.max) return { ok: false };
  if (rule.aboveMin && n === rule.min) return { ok: false };
  if (rule.integer && !Number.isInteger(n)) return { ok: false };
  return { ok: true, value: n };
}

export const toText = (value: number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value);

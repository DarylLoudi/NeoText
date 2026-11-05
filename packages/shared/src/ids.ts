import { monotonicFactory } from 'ulid';

export const ID_PREFIXES = [
  'usr',
  'cnv',
  'msg',
  'fld',
  'prv',
  'pst',
  'gen',
  'att',
  'mcp',
  'inv',
  'aud',
  'use',
  'agt',
  'akf',
  'akc',
] as const;

export type IdPrefix = (typeof ID_PREFIXES)[number];

const ulid = monotonicFactory();
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`;
}

export function isId(value: unknown, prefix: IdPrefix): value is string {
  if (typeof value !== 'string') return false;
  const head = `${prefix}_`;
  return value.startsWith(head) && ULID_PATTERN.test(value.slice(head.length));
}

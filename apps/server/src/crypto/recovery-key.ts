export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PREFIX = 'NTXR';
const KEY_BYTES = 32;
const KEY_CHARS = 52; // 256 bits / 5, rounded up

export function encodeRecoveryKey(bytes: Buffer): string {
  if (bytes.length !== KEY_BYTES) throw new Error('A recovery key must be exactly 32 bytes.');
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD_ALPHABET[(acc >> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += CROCKFORD_ALPHABET[(acc << (5 - bits)) & 31];
  const groups = out.match(/.{4}/g) ?? [];
  return `${PREFIX}-${groups.join('-')}`;
}

/** Maps the letters people mistake for digits: O to 0, I and L to 1. Expects upper case. */
export function foldConfusables(s: string): string {
  return s.replace(/O/g, '0').replace(/[IL]/g, '1');
}

/** Forgiving parser: ignores case, spaces, dashes and the prefix; maps O to 0 and I/L to 1. */
export function parseRecoveryKey(input: string): Buffer | null {
  let s = input.toUpperCase().replace(/[\s-]+/g, '');
  if (s.length === KEY_CHARS + PREFIX.length && s.startsWith(PREFIX)) s = s.slice(PREFIX.length);
  if (s.length !== KEY_CHARS) return null;
  s = foldConfusables(s);
  const out = Buffer.alloc(KEY_BYTES);
  let bits = 0;
  let acc = 0;
  let n = 0;
  for (const ch of s) {
    const v = CROCKFORD_ALPHABET.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out[n++] = (acc >> (bits - 8)) & 255;
      bits -= 8;
    }
    acc &= (1 << bits) - 1;
  }
  // The 4 leftover padding bits must be zero for a canonical key.
  return acc === 0 ? out : null;
}

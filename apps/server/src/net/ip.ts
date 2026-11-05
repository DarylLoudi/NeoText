import { isIP } from 'node:net';

type Cidr4 = readonly [base: number, bits: number];

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

const cidr4 = (s: string): Cidr4 => {
  const [ip, bits] = s.split('/');
  return [v4ToInt(ip as string) as number, Number(bits)];
};

const PRIVATE_V4: Cidr4[] = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '224.0.0.0/4',
  '240.0.0.0/4',
].map(cidr4);

function inCidr4(n: number, [base, bits]: Cidr4): boolean {
  const size = 2 ** (32 - bits);
  return Math.floor(n / size) === Math.floor(base / size);
}

/** Expand an IPv6 literal into eight 16-bit groups, or null if it is malformed. */
function parseV6(input: string): number[] | null {
  let ip = input;
  const pct = ip.indexOf('%');
  if (pct >= 0) ip = ip.slice(0, pct);
  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  if (tail.includes('.')) {
    const n = v4ToInt(tail);
    if (n === null) return null;
    ip = `${ip.slice(0, lastColon + 1)}${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`;
  }
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? (halves[1] as string).split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  const out = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? Number.parseInt(g, 16) : Number.NaN));
  return out.length === 8 && out.every((x) => !Number.isNaN(x)) ? out : null;
}

const embeddedV4 = (g: number[]): number => (g[6] as number) * 65536 + (g[7] as number);

/**
 * Returns the IPv4 an IPv6 address embeds, else null: IPv4-mapped (::ffff:0:0/96),
 * IPv4-compatible (::/96), NAT64 (64:ff9b::/96) and 6to4 (2002::/16).
 */
function embeddedFromV6(g: number[]): number | null {
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (zero(0, 5) && (g[5] === 0xffff || g[5] === 0)) return embeddedV4(g);
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return embeddedV4(g);
  if (g[0] === 0x2002) return (g[1] as number) * 65536 + (g[2] as number);
  return null;
}

/**
 * The IPv4 inside a local-use NAT64 address (64:ff9b:1::/48, RFC 6052 layout: the address skips
 * the reserved byte 8). Such addresses are private anyway; this keeps metadata detection exact.
 */
function localNat64V4(g: number[]): number | null {
  if (g[0] !== 0x64 || g[1] !== 0xff9b || g[2] !== 1) return null;
  return (g[3] as number) * 65536 + ((((g[4] as number) & 0xff) << 8) | ((g[5] as number) >> 8));
}

/**
 * Ranges that are never public hosts: translation and tunnels (local-use NAT64, SIIT, Teredo),
 * the discard prefix and documentation addresses.
 */
function isNeverPublicRange(g: number[]): boolean {
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true; // 64:ff9b:1::/48
  if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return true; // ::ffff:0:0:0/96
  if (g[0] === 0x100 && zero(1, 4)) return true; // 100::/64 discard
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // 2001:db8::/32 documentation
  return g[0] === 0x2001 && g[1] === 0; // 2001::/32
}

/** True for loopback, link-local, private, reserved and multicast addresses. Unparseable input fails closed. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const n = v4ToInt(ip) as number;
    return PRIVATE_V4.some((c) => inCidr4(n, c));
  }
  if (family === 6) {
    const g = parseV6(ip);
    if (!g) return true;
    if (isNeverPublicRange(g)) return true;
    const v4 = embeddedFromV6(g);
    if (v4 !== null) return PRIVATE_V4.some((c) => inCidr4(v4, c));
    if (g.every((x) => x === 0)) return true;
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;
    const first = g[0] as number;
    return (
      (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
      (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
      (first & 0xffc0) === 0xfec0 || // fec0::/10 site-local (deprecated, still routed in places)
      (first & 0xff00) === 0xff00 // ff00::/8 multicast
    );
  }
  return true;
}

const METADATA_V4 = new Set([v4ToInt('169.254.169.254'), v4ToInt('100.100.100.200')]);

/** Cloud metadata endpoints: blocked even when private networks are allowed. */
export function isMetadataAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return METADATA_V4.has(v4ToInt(ip));
  if (family === 6) {
    const g = parseV6(ip);
    if (!g) return false;
    const v4 = embeddedFromV6(g) ?? localNat64V4(g);
    if (v4 !== null) return METADATA_V4.has(v4);
    return g.join(':') === [0xfd00, 0xec2, 0, 0, 0, 0, 0, 0x254].join(':');
  }
  return false;
}

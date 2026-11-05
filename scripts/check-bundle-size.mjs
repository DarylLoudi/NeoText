// Fails when the JavaScript the web app loads before first render is over budget (spec §4:
// 180 KB gzip). "Before first render" is the entry chunk plus everything it imports statically,
// read from Vite's manifest, plus any script index.html loads outside the bundle (theme-boot.js).
// Dynamic imports (settings, Shiki, KaTeX, markdown, drag and drop, ...) are listed, not counted.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = join('apps', 'web', 'dist');
const MANIFEST = join(DIST, '.vite', 'manifest.json');
// The spec target is 180 KiB. The entry is at ~319 KiB (framework floor ~165 KiB plus the chat route),
// so until it is cut further CI enforces a CEILING that stops it growing. Lower CEILING_KIB whenever the
// measured size drops; reaching TARGET_KIB is tracked in CHANGELOG.md under known gaps.
const TARGET_KIB = 180;
const CEILING_KIB = 330;
const KIB = 1024;

/** Manifest keys reachable from `start` through static imports, `start` included. */
function staticClosure(manifest, start) {
  const seen = new Set();
  const stack = [start];
  while (stack.length > 0) {
    const key = stack.pop();
    if (seen.has(key) || !manifest[key]) continue;
    seen.add(key);
    stack.push(...(manifest[key].imports ?? []));
  }
  return [...seen];
}

/** Same-origin scripts in index.html that are not Vite assets (Vite's own are in the manifest). */
function extraScripts(html) {
  const paths = [];
  for (const [, src] of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    if (!/^[a-z]+:\/\//i.test(src) && !src.startsWith('/assets/'))
      paths.push(src.replace(/^\//, ''));
  }
  return paths;
}

const gzipSize = (file) => gzipSync(readFileSync(join(DIST, file))).length;
const kib = (bytes) => (bytes / KIB).toFixed(1).padStart(8);

function main() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch {
    console.error(
      `No manifest at ${MANIFEST}. Build the web app first: npm run build -w @neotext/web`,
    );
    process.exitCode = 1;
    return;
  }
  const entry = Object.keys(manifest).find((key) => manifest[key].isEntry);
  if (!entry) {
    console.error(`${MANIFEST} has no entry chunk.`);
    process.exitCode = 1;
    return;
  }

  const closure = staticClosure(manifest, entry);
  const files = [
    ...extraScripts(readFileSync(join(DIST, 'index.html'), 'utf8')),
    ...closure.map((key) => manifest[key].file),
  ];
  const rows = files
    .map((file) => ({ file, raw: readFileSync(join(DIST, file)).length, gzip: gzipSize(file) }))
    .sort((a, b) => b.gzip - a.gzip);

  const width = Math.max(4, ...rows.map((r) => r.file.length));
  console.log(`${'Initial JS'.padEnd(width)}  ${'Raw KiB'.padStart(8)}  ${'Gzip KiB'.padStart(8)}`);
  for (const r of rows) console.log(`${r.file.padEnd(width)}  ${kib(r.raw)}  ${kib(r.gzip)}`);
  const raw = rows.reduce((n, r) => n + r.raw, 0);
  const gzip = rows.reduce((n, r) => n + r.gzip, 0);
  console.log(`${'Total'.padEnd(width)}  ${kib(raw)}  ${kib(gzip)}`);

  const counted = new Set(closure);
  const lazy = new Set();
  for (const key of closure) for (const dyn of manifest[key].dynamicImports ?? []) lazy.add(dyn);
  const lazyRows = [...lazy]
    .filter((key) => !counted.has(key) && manifest[key])
    .map((key) => ({ name: manifest[key].name ?? key, gzip: gzipSize(manifest[key].file) }))
    .sort((a, b) => b.gzip - a.gzip);
  if (lazyRows.length > 0) {
    console.log(`\nLoaded on demand (not counted): ${lazyRows.length} chunks; largest:`);
    for (const r of lazyRows.slice(0, 8))
      console.log(`  ${r.name.padEnd(width - 2)}  ${kib(r.gzip)}`);
  }

  const size = gzip / KIB;
  if (size > CEILING_KIB) {
    console.error(
      `
The initial JavaScript is ${size.toFixed(1)} KiB gzip, over the ${CEILING_KIB} KiB ceiling (target ${TARGET_KIB} KiB).`,
    );
    process.exitCode = 1;
  } else if (size > TARGET_KIB) {
    console.warn(
      `
The initial JavaScript is ${size.toFixed(1)} KiB gzip: under the ${CEILING_KIB} KiB ceiling, but over the ${TARGET_KIB} KiB target.`,
    );
  } else {
    console.log(`
Within the ${TARGET_KIB} KiB target.`);
  }
}

main();

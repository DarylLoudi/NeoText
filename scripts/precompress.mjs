// Writes `.br` and `.gz` next to every built script and stylesheet, so the server can send them
// without compressing per request (apps/server/src/http/static.ts serves them precompressed).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const ASSETS = join(import.meta.dirname, '..', 'apps', 'web', 'dist', 'assets');

let names;
try {
  names = readdirSync(ASSETS).filter((name) => /\.(?:js|css)$/.test(name));
} catch {
  console.error(`No build found in ${ASSETS}. Build the web app first.`);
  process.exitCode = 1;
}

if (names) {
  let raw = 0;
  let br = 0;
  for (const name of names) {
    const file = join(ASSETS, name);
    const source = readFileSync(file);
    const brotli = brotliCompressSync(source, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
      },
    });
    writeFileSync(`${file}.br`, brotli);
    writeFileSync(`${file}.gz`, gzipSync(source, { level: 9 }));
    raw += source.length;
    br += brotli.length;
  }
  const kib = (n) => (n / 1024).toFixed(0);
  console.log(`Precompressed ${names.length} files: ${kib(raw)} KiB raw, ${kib(br)} KiB brotli.`);
}

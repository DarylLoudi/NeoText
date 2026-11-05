import { createRequire } from 'node:module';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const require = createRequire(import.meta.url);

/** The Phosphor weights the app draws. Any other weight renders nothing: add it here first. */
const ICON_WEIGHTS = new Set(['regular', 'bold', 'fill']);
const ICON_DEFS = /@phosphor-icons[\\/]react[\\/]dist[\\/]defs[\\/]\w+\.es\.js$/;
// One `["weight", <svg>]` entry of the generated Map; only its closing bracket sits at column 2.
const WEIGHT_ENTRY = /\n {2}\[\n {4}"(\w+)",[\s\S]*?\n {2}\],?/g;

/**
 * Every Phosphor icon carries all six weights; dropping the three the app never uses cuts each
 * icon's code by more than half.
 */
function phosphorWeights(): Plugin {
  return {
    name: 'neotext:phosphor-weights',
    transform(code, id) {
      if (!ICON_DEFS.test(id)) return null;
      const kept: string[] = [];
      const out = code.replace(WEIGHT_ENTRY, (entry, weight: string) => {
        if (!ICON_WEIGHTS.has(weight)) return '';
        kept.push(weight);
        return entry;
      });
      // A changed file layout must fail the build, not ship blank icons.
      if (kept.length !== ICON_WEIGHTS.size) {
        this.error(`Unexpected Phosphor icon layout in ${id}; update phosphorWeights().`);
      }
      return { code: out, map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), phosphorWeights()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(import.meta.dirname, 'src') },
      // markdown-it-texmath `require`s katex, which would bundle the CommonJS build next to the
      // ES build we import. Point both at one file so the math chunk carries KaTeX once.
      { find: /^katex$/, replacement: require.resolve('katex/dist/katex.mjs') },
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3420' },
  },
  // Never inline assets: the CSP has font-src 'self', which blocks fonts embedded as data: URIs
  // (KaTeX's stylesheet would otherwise inline its smallest font files).
  // The manifest lets scripts/check-bundle-size.mjs walk what the entry chunk loads.
  build: { target: 'es2022', assetsInlineLimit: 0, manifest: true },
});

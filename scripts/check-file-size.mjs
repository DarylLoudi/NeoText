import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const SKIP = new Set(['node_modules', 'dist', 'drizzle', 'locales']);
const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.css'];

function subdirs(dir) {
  try {
    return readdirSync(dir)
      .map((name) => join(dir, name))
      .filter((p) => statSync(p).isDirectory());
  } catch {
    return [];
  }
}

function* walk(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXTENSIONS.some((ext) => name.endsWith(ext))) yield full;
  }
}

const roots = [
  ...subdirs('apps').flatMap((app) => [join(app, 'src'), join(app, 'test-support')]),
  ...subdirs('packages').map((pkg) => join(pkg, 'src')),
  'scripts',
];

let count = 0;
for (const root of roots) {
  for (const file of walk(root)) {
    count += 1;
    const isTest = /\.(test|spec)\./.test(file);
    const limit = isTest ? 500 : 400;
    const text = readFileSync(file, 'utf8');
    const lines = text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
    if (lines > limit) {
      console.log(`file-size: ${file.split(sep).join('/')} has ${lines} lines (limit ${limit})`);
      process.exitCode = 1;
    }
  }
}
if (!process.exitCode) console.log(`file-size: ok (${count} files)`);

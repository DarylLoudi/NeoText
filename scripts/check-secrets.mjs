// Fails when something shaped like a real secret is found. Prints the file and line only,
// never the match, so the check itself cannot leak what it found.
//
//   node scripts/check-secrets.mjs            scans the files git tracks (part of `npm run lint`)
//   ... | node scripts/check-secrets.mjs --stdin   scans piped text, such as
//                                              git log -p --all | node scripts/check-secrets.mjs --stdin
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const PATTERNS = [
  /sk-or-v1-[0-9a-f]{64}/,
  /sk-ant-[A-Za-z0-9-]{20,}/,
  /sk-[A-Za-z0-9]{40,}/,
  /ghp_[A-Za-z0-9]{36}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const looksSecret = (line) => PATTERNS.some((p) => p.test(line));

/** Piped text, a line at a time (history can be far too big to hold). Lines of a patch are
 * reported by number, with the nearest `+++ b/<file>` header above them as the place. */
async function scanStdin() {
  let hits = 0;
  let lines = 0;
  let where = '(unknown file)';
  const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of reader) {
    lines += 1;
    if (line.startsWith('+++ b/')) where = line.slice(6);
    if (looksSecret(line)) {
      console.log(`secrets: stdin line ${lines} (${where}) looks like a secret`);
      hits += 1;
    }
  }
  if (hits > 0) process.exitCode = 1;
  else console.log(`secrets: ok (${lines} lines from stdin)`);
}

function scanTrackedFiles() {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\0')
    .filter(Boolean);

  let hits = 0;
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file);
    } catch {
      continue; // Deleted in the working tree but still in the index.
    }
    // Binary files (a NUL in the first 8 KiB) are skipped.
    if (text.subarray(0, 8192).includes(0)) continue;
    const lines = text.toString('utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (looksSecret(lines[i])) {
        console.log(`secrets: ${file}:${i + 1} looks like a secret`);
        hits += 1;
      }
    }
  }
  if (hits > 0) process.exitCode = 1;
  else console.log(`secrets: ok (${files.length} files)`);
}

if (process.argv.includes('--stdin')) await scanStdin();
else scanTrackedFiles();

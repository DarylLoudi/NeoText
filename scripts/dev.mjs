import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
process.env.NODE_ENV ??= 'development';

const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const children = [
  spawn(process.execPath, [tsxCli, 'watch', '--clear-screen=false', 'apps/server/src/index.ts'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  }),
  spawn(process.execPath, [viteCli, '--clearScreen', 'false'], {
    cwd: path.join(root, 'apps', 'web'),
    stdio: 'inherit',
    env: process.env,
  }),
];

let stopping = false;
function stop(signal) {
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill(signal);
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
for (const child of children) {
  child.on('exit', (code) => {
    // One child dying takes the other down so `npm run dev` never half-runs.
    if (!stopping) stop('SIGTERM');
    if (code && !process.exitCode) process.exitCode = code;
  });
}

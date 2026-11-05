import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Starts the server the way `npm start` does: production mode, tsx loader, repo root as cwd.
 * Shared with scripts/smoke-prod.mjs so the smoke test exercises the real start path.
 */
export function spawnServer({ env = process.env, stdio = 'inherit' } = {}) {
  return spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
    cwd: root,
    stdio,
    env: { ...env, NODE_ENV: env.NODE_ENV ?? 'production' },
  });
}

function main() {
  const envFile = path.join(root, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const child = spawnServer();
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  child.on('exit', (code) => {
    process.exitCode = code ?? 0;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

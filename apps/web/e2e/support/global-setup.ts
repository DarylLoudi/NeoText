import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import { CONTROL_URL } from './ports';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const runner = path.join('apps', 'web', 'e2e', 'support', 'e2e-server.ts');

/** The parent environment minus anything that could carry the developer's own configuration. */
function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k === 'OPENROUTER_API_KEY' || k.startsWith('NEOTEXT_')) continue;
    env[k] = v;
  }
  return env;
}

function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', () => resolve()));
}

async function stopChild(child: ChildProcess): Promise<void> {
  try {
    await fetch(`${CONTROL_URL}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(3000) });
  } catch {
    // The runner may already be gone; the kill below covers a stuck one.
  }
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  await exited(child);
  clearTimeout(timer);
}

/** Starts the e2e server and returns the function that stops it and removes its data. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const child = spawn(process.execPath, ['--import', 'tsx', runner], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    // The flag that lets the control server seed data; nothing outside this harness sets it.
    env: { ...cleanEnv(), NEOTEXT_E2E_HARNESS: '1' },
  });
  let stderr = '';
  child.stderr?.on('data', (part: Buffer) => {
    stderr += part.toString();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('The e2e server did not start in 60s.')),
        60_000,
      );
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`The e2e server exited early with code ${code}. ${stderr}`));
      });
      let seen = '';
      child.stdout?.on('data', (part: Buffer) => {
        seen += part.toString();
        if (seen.includes('e2e-ready')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  } catch (err) {
    await stopChild(child);
    throw err;
  }
  child.stdout?.resume();
  return () => stopChild(child);
}

import { type ChildProcess, spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SpawnedServer {
  baseUrl: string;
  kill(): Promise<void>;
  stop(): Promise<void>;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const entry = path.join('apps', 'server', 'src', 'index.ts');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

/** The parent env minus anything that could leak the developer's real configuration or key. */
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

/** Runs the real server entry point as a child process on a free local port. */
export async function spawnServer(opts: {
  dataDir: string;
  env?: Record<string, string>;
}): Promise<SpawnedServer> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', entry], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...cleanEnv(),
      NODE_ENV: 'production',
      NEOTEXT_PORT: String(port),
      NEOTEXT_PUBLIC_URL: baseUrl,
      NEOTEXT_LOG_LEVEL: 'info',
      NEOTEXT_ARGON2_MEMORY_KIB: '1024',
      NEOTEXT_ARGON2_PASSES: '1',
      NEOTEXT_DATA_DIR: opts.dataDir,
      ...opts.env,
    },
  });

  const kill = async (): Promise<void> => {
    child.kill('SIGKILL');
    await exited(child);
  };

  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  try {
    await new Promise<void>((resolve, reject) => {
      let buffered = '';
      const timer = setTimeout(() => reject(new Error('Server did not start within 30s.')), 30_000);
      child.once('exit', (code) =>
        reject(new Error(`Server exited early with code ${code}. ${stderr}`)),
      );
      child.stdout?.on('data', (chunk: Buffer) => {
        buffered += chunk.toString();
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        for (const line of lines) {
          try {
            if ((JSON.parse(line) as { msg?: string }).msg === 'listening') {
              clearTimeout(timer);
              resolve();
            }
          } catch {
            // not a JSON log line
          }
        }
      });
    });
  } catch (err) {
    await kill();
    throw err;
  }
  child.stdout?.resume();

  return {
    baseUrl,
    kill,
    stop: async () => {
      child.kill('SIGTERM');
      await exited(child);
    },
  };
}

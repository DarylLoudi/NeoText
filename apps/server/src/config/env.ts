import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  publicUrl: string;
  dataDir: string;
  allowedOrigins: string[];
  cookieSecure: boolean;
  trustProxy: boolean;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  argon2: { memoryKiB: number; passes: number };
  backup: { intervalHours: number; keepScheduled: number; keepPreMigration: number };
  instanceKeyB64: string | null;
  openrouterApiKey: string | null;
  webDistDir: string | null;
  /** Stored attachment bytes per user (`NEOTEXT_ATTACHMENT_QUOTA_MB`, default 2048 MB). */
  attachmentQuotaBytes: number;
  version: string;
}

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const int = (min: number) => z.coerce.number().int().min(min);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NEOTEXT_HOST: z.string().min(1).default('127.0.0.1'),
  NEOTEXT_PORT: int(0).max(65535).default(3420),
  NEOTEXT_PUBLIC_URL: z.url().optional(),
  NEOTEXT_DATA_DIR: z.string().min(1).default('./data'),
  NEOTEXT_ALLOWED_ORIGINS: z.string().optional(),
  NEOTEXT_COOKIE_SECURE: bool.optional(),
  NEOTEXT_TRUST_PROXY: bool.default(false),
  NEOTEXT_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .optional(),
  NEOTEXT_ARGON2_MEMORY_KIB: int(8).default(65536),
  NEOTEXT_ARGON2_PASSES: int(1).default(2),
  NEOTEXT_BACKUP_INTERVAL_HOURS: int(1).max(596).default(6),
  NEOTEXT_BACKUP_KEEP: int(1).default(10),
  NEOTEXT_BACKUP_KEEP_PREMIGRATION: int(1).default(5),
  NEOTEXT_INSTANCE_KEY: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  NEOTEXT_WEB_DIST: z.string().min(1).optional(),
  NEOTEXT_ATTACHMENT_QUOTA_MB: int(1).default(2048),
});

function readVersion(): string {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json');
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { version: string }).version;
}

function resolveWebDist(configured: string | undefined, cwd: string): string | null {
  if (configured) return path.resolve(cwd, configured);
  const fallback = path.resolve(cwd, 'apps', 'web', 'dist');
  return fs.existsSync(fallback) ? fallback : null;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): AppConfig {
  // Treat empty strings as unset so a blank line in .env falls back to the default.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const name = String(issue?.path[0] ?? 'environment');
    throw new Error(`Invalid environment variable ${name}: ${issue?.message ?? 'invalid value'}`);
  }
  const e = parsed.data;
  const publicUrl = (e.NEOTEXT_PUBLIC_URL ?? `http://localhost:${e.NEOTEXT_PORT}`).replace(
    /\/+$/,
    '',
  );
  const origins = [new URL(publicUrl).origin];
  for (const o of (e.NEOTEXT_ALLOWED_ORIGINS ?? '').split(',')) {
    const t = o.trim();
    if (t) origins.push(t.replace(/\/+$/, ''));
  }
  if (e.NODE_ENV === 'development') origins.push('http://localhost:5173');
  return {
    env: e.NODE_ENV,
    host: e.NEOTEXT_HOST,
    port: e.NEOTEXT_PORT,
    publicUrl,
    dataDir: path.resolve(cwd, e.NEOTEXT_DATA_DIR),
    allowedOrigins: [...new Set(origins)],
    cookieSecure: e.NEOTEXT_COOKIE_SECURE ?? publicUrl.startsWith('https:'),
    trustProxy: e.NEOTEXT_TRUST_PROXY,
    logLevel: e.NEOTEXT_LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : 'info'),
    argon2: { memoryKiB: e.NEOTEXT_ARGON2_MEMORY_KIB, passes: e.NEOTEXT_ARGON2_PASSES },
    backup: {
      intervalHours: e.NEOTEXT_BACKUP_INTERVAL_HOURS,
      keepScheduled: e.NEOTEXT_BACKUP_KEEP,
      keepPreMigration: e.NEOTEXT_BACKUP_KEEP_PREMIGRATION,
    },
    instanceKeyB64: e.NEOTEXT_INSTANCE_KEY ?? null,
    openrouterApiKey: e.OPENROUTER_API_KEY ?? null,
    webDistDir: resolveWebDist(e.NEOTEXT_WEB_DIST, cwd),
    attachmentQuotaBytes: e.NEOTEXT_ATTACHMENT_QUOTA_MB * 1024 * 1024,
    version: readVersion(),
  };
}

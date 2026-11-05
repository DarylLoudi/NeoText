import pino from 'pino';
import type { AppConfig } from '../config/env';

export type Logger = pino.Logger;

const REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.apiKey',
  '*.recoveryKey',
  '*.token',
];

/** `destination` replaces stdout (tests read the log back); it is ignored in development. */
export function createLogger(
  cfg: Pick<AppConfig, 'logLevel' | 'env'>,
  destination?: pino.DestinationStream,
): Logger {
  const opts: pino.LoggerOptions = {
    level: cfg.logLevel,
    redact: REDACT,
    ...(cfg.env === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  };
  return destination && cfg.env !== 'development' ? pino(opts, destination) : pino(opts);
}

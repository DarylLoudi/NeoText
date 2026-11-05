import { createApp } from './app';
import { loadConfig } from './config/env';
import { createContainer } from './container';
import { startServer } from './server';

async function main(): Promise<void> {
  const config = loadConfig();
  const c = await createContainer(config);
  const server = await startServer(c, createApp(c));
  c.log.info({ url: `http://${config.host}:${server.port}` }, 'listening');

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    c.log.info({ signal }, 'shutting down');
    try {
      await server.close();
      await c.close();
      process.exitCode = 0;
    } catch (err) {
      c.log.error({ err }, 'error during shutdown');
      process.exitCode = 1;
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    c.log.fatal({ err: reason }, 'unhandled rejection');
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import type { Container } from './container';
import type { AppEnv } from './http/env';

export function startServer(
  c: Container,
  app: Hono<AppEnv>,
): Promise<{ port: number; close(): Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = serve(
      { fetch: app.fetch, hostname: c.config.host, port: c.config.port },
      (info: AddressInfo) => {
        server.off('error', reject);
        resolve({
          port: info.port,
          close: () =>
            new Promise<void>((done, fail) => {
              server.close((err) => (err ? fail(err) : done()));
              server.closeAllConnections();
            }),
        });
      },
    ) as Server;
    server.once('error', reject);
  });
}

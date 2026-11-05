import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { adminRoutes } from './admin/routes';
import { knowledgeRoutes } from './agents/knowledge/routes';
import { agentRoutes } from './agents/routes';
import { attachmentRoutes } from './attachments/routes';
import { auditRoutes } from './audit/routes';
import { apiRateLimit, sessionMiddleware } from './auth/middleware';
import { authRoutes } from './auth/routes';
import { chatRoutes } from './chat/chat-routes';
import { conversationRoutes } from './chat/conversations-routes';
import { folderRoutes } from './chat/folders-routes';
import type { Container } from './container';
import { faviconRoutes } from './favicon/routes';
import { bodyLimits } from './http/body-limits';
import type { AppEnv } from './http/env';
import { errorHandler, notFoundHandler } from './http/errors';
import { originGuard } from './http/origin-guard';
import { requestId } from './http/request-id';
import { securityHeaders } from './http/security-headers';
import { serveWeb } from './http/static';
import { mcpRoutes } from './mcp/routes';
import { presetRoutes } from './presets/routes';
import { providerRoutes } from './providers/routes';
import { quotaRoutes } from './quotas/routes';
import { searchConversationsRoutes } from './search-conversations/routes';
import { settingsRoutes } from './settings/routes';
import { toolRoutes } from './tools/routes';
import { transferRoutes } from './transfer/routes';
import { usageRoutes } from './usage/routes';

export function createApp(c: Container): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(securityHeaders({ hsts: c.config.cookieSecure }));
  app.use(originGuard(c.config.allowedOrigins));
  // JSON only. Never `text/event-stream`: a compressor buffers, and each SSE frame must leave
  // as soon as it is written. The web app's files are compressed at build time (static.ts).
  app.use('/api/*', compress({ contentTypeFilter: /^application\/json\b/i }));
  app.use('/api/*', sessionMiddleware(c));
  app.use('/api/*', apiRateLimit(c));
  // After the session and the API limit: a large body is never read for a stranger.
  app.use(bodyLimits());
  app.get('/api/health', (ctx) => {
    try {
      c.db.raw.prepare('SELECT 1').get();
    } catch (err) {
      c.log.error({ err }, 'health check: database unreachable');
      return ctx.json({ ok: false, version: c.config.version, db: 'error' as const }, 503);
    }
    return ctx.json({ ok: true, version: c.config.version, db: 'ok' as const });
  });
  // First: later sub-apps add `Cache-Control: no-store` on '*', which would override SSE and
  // file caching headers.
  app.route('/api', chatRoutes(c));
  app.route('/api', faviconRoutes(c));
  app.route('/api', attachmentRoutes(c));
  app.route('/api', authRoutes(c));
  app.route('/api', adminRoutes(c));
  app.route('/api', auditRoutes(c));
  app.route('/api', settingsRoutes(c));
  app.route('/api', providerRoutes(c));
  app.route('/api', conversationRoutes(c));
  app.route('/api', folderRoutes(c));
  app.route('/api', presetRoutes(c));
  app.route('/api', knowledgeRoutes(c));
  app.route('/api', agentRoutes(c));
  app.route('/api', toolRoutes(c));
  app.route('/api', mcpRoutes(c));
  app.route('/api', searchConversationsRoutes(c));
  app.route('/api', usageRoutes(c));
  app.route('/api', quotaRoutes(c));
  app.route('/api', transferRoutes(c));
  if (c.config.webDistDir) serveWeb(app, c.config.webDistDir);
  app.notFound(notFoundHandler);
  app.onError(errorHandler(c));
  return app;
}

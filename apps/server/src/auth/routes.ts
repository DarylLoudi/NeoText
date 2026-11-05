import {
  ChangePasswordBodySchema,
  CreateInviteBodySchema,
  LoginBodySchema,
  newId,
  RecoverBodySchema,
  RegisterBodySchema,
  RotateRecoveryKeyBodySchema,
  SetupBodySchema,
} from '@neotext/shared';
import { Hono } from 'hono';
import type { Container } from '../container';
import type { AppEnv } from '../http/env';
import { AppError } from '../http/errors';
import { clientIp, enforceLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import { clearSessionCookie, setSessionCookie } from './cookies';
import { generateInviteCode, hashInviteCode } from './invites';
import { getAuth, requireAdmin, requireAuth } from './middleware';
import { register } from './register';
import { USER_AGENT_MAX } from './sessions';
import { normalizeUsername, validatePassword, validateUsername } from './username';

// The shared schemas stay structural; the server adds the password and username rules.
type Issues = { addIssue(issue: { code: 'custom'; message: string; path: string[] }): void };
const checkPassword = (ctx: Issues, password: string, field: string) => {
  const message = validatePassword(password);
  if (message) ctx.addIssue({ code: 'custom', message, path: [field] });
};

const SetupBody = SetupBodySchema.superRefine((v, ctx) => {
  const message = validateUsername(normalizeUsername(v.username));
  if (message) ctx.addIssue({ code: 'custom', message, path: ['username'] });
  checkPassword(ctx, v.password, 'password');
});
const ChangePasswordBody = ChangePasswordBodySchema.superRefine((v, ctx) =>
  checkPassword(ctx, v.newPassword, 'newPassword'),
);
const RecoverBody = RecoverBodySchema.superRefine((v, ctx) =>
  checkPassword(ctx, v.newPassword, 'newPassword'),
);

export function authRoutes(container: Container): Hono<AppEnv> {
  const { auth: service, config, limiters } = container;
  const routes = new Hono<AppEnv>();
  const ip = (c: Parameters<typeof clientIp>[0]) => clientIp(c, config.trustProxy);
  const userAgent = (c: { req: { header(n: string): string | undefined } }) =>
    (c.req.header('User-Agent') ?? '').slice(0, USER_AGENT_MAX) || null;

  /** Best effort: a failure here never fails setup. */
  const adoptEnvProvider = async (setup: {
    user: { id: string; username: string; role: 'admin' | 'member' };
    token: string;
  }) => {
    try {
      const session = container.sessions.resolve(setup.token);
      if (!session) return;
      await container.providers.createFromEnv({
        userId: setup.user.id,
        username: setup.user.username,
        role: setup.user.role,
        sessionId: session.sessionId,
        dek: session.dek,
      });
    } catch (err) {
      container.log.warn(
        { err: err instanceof Error ? err.name : 'unknown' },
        'could not add the OpenRouter provider from the environment',
      );
    }
  };

  routes.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  routes.get('/instance', (c) => c.json(service.instanceInfo()));

  routes.post('/setup', async (c) => {
    enforceLimit(c, limiters.sensitive, `setup:${ip(c)}`);
    const body = await readJson(c, SetupBody);
    const result = await service.setup(body, userAgent(c));
    if (body.useEnvProvider) await adoptEnvProvider(result);
    setSessionCookie(c, config, result.token, result.expiresAt, container.clock.now());
    return c.json({ user: result.user, recoveryKey: result.recoveryKey }, 201);
  });

  routes.post('/auth/login', async (c) => {
    enforceLimit(c, limiters.login, ip(c));
    const body = await readJson(c, LoginBodySchema);
    const userKey = normalizeUsername(body.username);
    enforceLimit(c, limiters.loginUser, userKey);
    const result = await service.login(body, userAgent(c));
    limiters.loginUser.reset(userKey);
    setSessionCookie(c, config, result.token, result.expiresAt, container.clock.now());
    return c.json({ user: result.user });
  });

  routes.post('/auth/register', async (c) => {
    // Wrong codes count too: the limit is what makes guessing a code impractical.
    enforceLimit(c, limiters.sensitive, `register:${ip(c)}`);
    const body = await readJson(c, RegisterBodySchema);
    const result = await register(container, body, userAgent(c));
    setSessionCookie(c, config, result.token, result.expiresAt, container.clock.now());
    return c.json({ user: result.user, recoveryKey: result.recoveryKey }, 201);
  });

  routes.get('/admin/invites', requireAdmin, (c) => c.json({ invites: container.invites.list() }));

  routes.post('/admin/invites', requireAdmin, async (c) => {
    const body = await readJson(c, CreateInviteBodySchema);
    const code = generateInviteCode();
    const id = newId('inv');
    const now = container.clock.now();
    const expiresAt = now + body.expiresInDays * 24 * 60 * 60 * 1000;
    container.invites.insert({
      id,
      codeHash: hashInviteCode(container.instanceKey, code),
      role: body.role,
      createdBy: getAuth(c).userId,
      expiresAt,
      createdAt: now,
    });
    container.audit.record('admin.invite.created', getAuth(c).userId, {
      inviteId: id,
      role: body.role,
    });
    const invite = {
      id,
      role: body.role,
      expiresAt,
      usedBy: null,
      usedByUsername: null,
      usedAt: null,
      createdAt: now,
    };
    return c.json({ invite, code }, 201);
  });

  routes.delete('/admin/invites/:id', requireAdmin, (c) => {
    const id = c.req.param('id');
    if (!container.invites.revoke(id)) {
      throw new AppError('not_found', 'That invite does not exist.', 404);
    }
    container.audit.record('admin.invite.revoked', getAuth(c).userId, { inviteId: id });
    return c.body(null, 204);
  });

  routes.post('/auth/logout', requireAuth, (c) => {
    const auth = getAuth(c);
    service.logout(auth.sessionId, auth.userId);
    clearSessionCookie(c, config);
    return c.body(null, 204);
  });

  routes.get('/auth/sessions', requireAuth, (c) => {
    const auth = getAuth(c);
    const now = container.clock.now();
    const items = container.sessions
      .listForUser(auth.userId)
      .filter((s) => s.expiresAt > now)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map((s) => ({ ...s, current: s.id === auth.sessionId }));
    return c.json({ items });
  });

  // Registered before `/:id` so that "revoke-others" is never read as a session id.
  routes.post('/auth/sessions/revoke-others', requireAuth, (c) => {
    const auth = getAuth(c);
    const count = container.sessions.revokeAllForUser(auth.userId, auth.sessionId);
    if (count > 0) container.audit.record('session.revoked', auth.userId, { count });
    return c.body(null, 204);
  });

  routes.delete('/auth/sessions/:id', requireAuth, (c) => {
    const auth = getAuth(c);
    const id = c.req.param('id');
    // Someone else's id looks exactly like one that does not exist.
    if (!container.sessions.listForUser(auth.userId).some((s) => s.id === id)) {
      throw new AppError('not_found', 'That session does not exist.', 404);
    }
    container.sessions.revoke(id);
    container.audit.record('session.revoked', auth.userId, { count: 1 });
    if (id === auth.sessionId) clearSessionCookie(c, config);
    return c.body(null, 204);
  });

  routes.get('/auth/me', requireAuth, (c) => {
    const user = service.getPublicUser(getAuth(c).userId);
    if (!user) {
      clearSessionCookie(c, config);
      throw new AppError('unauthorized', 'Sign in to continue.', 401);
    }
    return c.json({ user });
  });

  routes.post('/auth/password', requireAuth, async (c) => {
    enforceLimit(c, limiters.sensitive, `pw:${getAuth(c).userId}`);
    const body = await readJson(c, ChangePasswordBody);
    await service.changePassword(getAuth(c), body);
    return c.body(null, 204);
  });

  routes.post('/auth/recover', async (c) => {
    enforceLimit(c, limiters.sensitive, `recover:${ip(c)}`);
    const body = await readJson(c, RecoverBody);
    const result = await service.recover(body, userAgent(c));
    setSessionCookie(c, config, result.token, result.expiresAt, container.clock.now());
    return c.json({ user: result.user, recoveryKey: result.recoveryKey });
  });

  routes.post('/auth/recovery-key', requireAuth, async (c) => {
    enforceLimit(c, limiters.sensitive, `pw:${getAuth(c).userId}`);
    const body = await readJson(c, RotateRecoveryKeyBodySchema);
    return c.json(await service.rotateRecoveryKey(getAuth(c), body));
  });

  return routes;
}

import { type AgentCreate, type AgentPublic, type AgentUpdate, newId } from '@neotext/shared';
import type { AuthContext } from '../http/env';
import { AppError } from '../http/errors';
import type { Clock } from '../lib/clock';
import type { AgentsRepo } from './repo';

export const MAX_AGENTS_PER_USER = 50;

export interface AgentsService {
  list(auth: AuthContext): AgentPublic[];
  /** The agent, or null when it is missing or not the user's. */
  get(auth: AuthContext, id: string): AgentPublic | null;
  create(auth: AuthContext, body: AgentCreate): AgentPublic;
  update(auth: AuthContext, id: string, body: AgentUpdate): AgentPublic;
  remove(auth: AuthContext, id: string): void;
}

export function createAgentsService(deps: { repo: AgentsRepo; clock: Clock }): AgentsService {
  const { repo, clock } = deps;
  const get = (auth: AuthContext, id: string) => repo.get(auth.userId, id, auth.dek);
  const need = (auth: AuthContext, id: string): AgentPublic => {
    const found = get(auth, id);
    if (!found) throw new AppError('not_found', 'That agent does not exist.', 404);
    return found;
  };
  /** Names are unique per user, ignoring case: `delegate_tasks` picks agents by name. */
  const assertNameFree = (auth: AuthContext, name: string, self?: string) => {
    const wanted = name.trim().toLowerCase();
    const taken = repo
      .list(auth.userId, auth.dek)
      .some((a) => a.id !== self && a.name.trim().toLowerCase() === wanted);
    if (taken) {
      throw new AppError(
        'agent_name_taken',
        'You already have an agent with that name. Pick another name.',
        409,
      );
    }
  };
  return {
    list: (auth) => repo.list(auth.userId, auth.dek),
    get,
    create: (auth, body) => {
      // Synchronous, so the check is atomic with the insert (better-sqlite3).
      if (repo.count(auth.userId) >= MAX_AGENTS_PER_USER) {
        throw new AppError(
          'agent_limit',
          `You can have up to ${MAX_AGENTS_PER_USER} agents. Delete one to add another.`,
          400,
        );
      }
      assertNameFree(auth, body.name);
      const now = clock.now();
      const agent: AgentPublic = {
        id: newId('agt'),
        name: body.name,
        data: body.data,
        // New agents go last; ids break ties.
        position: String(now).padStart(16, '0'),
        createdAt: now,
        updatedAt: now,
      };
      repo.insert({ ...agent, userId: auth.userId }, auth.dek);
      return agent;
    },
    update: (auth, id, body) => {
      need(auth, id);
      if (body.name !== undefined) assertNameFree(auth, body.name, id);
      repo.update(auth.userId, id, body, clock.now(), auth.dek);
      return need(auth, id);
    },
    remove: (auth, id) => {
      if (!repo.remove(auth.userId, id)) need(auth, id);
    },
  };
}

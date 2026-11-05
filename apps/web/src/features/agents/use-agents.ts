import type { AgentCreate, AgentPublic, AgentUpdate } from '@neotext/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { agentsApi } from '../../lib/api/agents';
import { qk } from '../../lib/query';
import { toast } from '../../ui';
import { errorMessage } from '../sidebar/use-conversations';

export function useAgents() {
  return useQuery({ queryKey: qk.agents, queryFn: agentsApi.list });
}

export interface AgentMutations {
  /** True when saved, false after a toast explained the failure. */
  create(body: AgentCreate): Promise<boolean>;
  update(id: string, body: AgentUpdate): Promise<boolean>;
  remove(id: string): Promise<boolean>;
}

export function useAgentMutations(): AgentMutations {
  const qc = useQueryClient();
  return useMemo(() => {
    async function attempt(run: () => Promise<unknown>): Promise<boolean> {
      try {
        await run();
        return true;
      } catch (err) {
        toast({ message: errorMessage(err), tone: 'danger' });
        return false;
      } finally {
        void qc.invalidateQueries({ queryKey: qk.agents });
      }
    }
    return {
      create: (body) => attempt(() => agentsApi.create(body)),
      update: (id, body) => attempt(() => agentsApi.update(id, body)),
      remove: (id) => attempt(() => agentsApi.remove(id)),
    };
  }, [qc]);
}

export type { AgentPublic };

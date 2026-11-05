import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { agentsApi } from '../../lib/api/agents';
import { ApiError } from '../../lib/api/client';
import { useT } from '../../lib/i18n';
import { qk } from '../../lib/query';
import { toast } from '../../ui';
import { errorMessage } from '../sidebar/use-conversations';
import { KNOWLEDGE_EXTENSIONS, KNOWLEDGE_MAX_BYTES, KNOWLEDGE_MAX_FILES } from './knowledge-types';

export interface UploadingFile {
  key: string;
  name: string;
  progress: number;
}

export interface FileProblem {
  key: string;
  name: string;
  message: string;
}

let seq = 0;

const extensionOk = (name: string) =>
  (KNOWLEDGE_EXTENSIONS as readonly string[]).includes(name.split('.').pop()?.toLowerCase() ?? '');

/** The agent's knowledge files, plus uploads in flight and files the client or server refused. */
export function useAgentFiles(agentId: string | null) {
  const t = useT();
  const qc = useQueryClient();
  const queryKey = useMemo(() => [...qk.agents, agentId, 'files'], [agentId]);
  const query = useQuery({
    queryKey,
    queryFn: () => agentsApi.files(agentId as string),
    enabled: agentId !== null,
  });
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [problems, setProblems] = useState<FileProblem[]>([]);
  const controllers = useRef(new Map<string, AbortController>());

  useEffect(
    () => () => {
      for (const c of controllers.current.values()) c.abort();
    },
    [],
  );

  const count = query.data?.length ?? 0;

  const uploadError = useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError) {
        // Widened: these codes join the shared ErrorCode with the server task.
        const code: string = err.code;
        if (code === 'knowledge_type') return t('settings.agents.editor.knowledge.errors.type');
        if (code === 'knowledge_too_large')
          return t('settings.agents.editor.knowledge.errors.tooBig');
        if (code === 'knowledge_limit') {
          return t('settings.agents.editor.knowledge.errors.limit', { max: KNOWLEDGE_MAX_FILES });
        }
      }
      return errorMessage(err);
    },
    [t],
  );

  const add = useCallback(
    (files: File[]) => {
      if (agentId === null) return;
      const refused: FileProblem[] = [];
      const accepted: File[] = [];
      let room = KNOWLEDGE_MAX_FILES - count - controllers.current.size;
      for (const file of files) {
        seq += 1;
        const key = `kf_${seq}`;
        const fail = (message: string) => refused.push({ key, name: file.name, message });
        if (!extensionOk(file.name)) fail(t('settings.agents.editor.knowledge.errors.type'));
        else if (file.size > KNOWLEDGE_MAX_BYTES)
          fail(t('settings.agents.editor.knowledge.errors.tooBig'));
        else if (room <= 0) {
          fail(t('settings.agents.editor.knowledge.errors.limit', { max: KNOWLEDGE_MAX_FILES }));
        } else {
          room -= 1;
          accepted.push(file);
        }
      }
      setProblems(refused);
      for (const file of accepted) {
        seq += 1;
        const key = `kf_${seq}`;
        const controller = new AbortController();
        controllers.current.set(key, controller);
        setUploading((l) => [...l, { key, name: file.name, progress: 0 }]);
        agentsApi
          .uploadFile(agentId, file, {
            signal: controller.signal,
            onProgress: (progress) =>
              setUploading((l) => l.map((u) => (u.key === key ? { ...u, progress } : u))),
          })
          .catch((err: unknown) => {
            if (controller.signal.aborted) return;
            setProblems((l) => [...l, { key, name: file.name, message: uploadError(err) }]);
          })
          .finally(() => {
            controllers.current.delete(key);
            setUploading((l) => l.filter((u) => u.key !== key));
            void qc.invalidateQueries({ queryKey });
          });
      }
    },
    [agentId, count, qc, queryKey, t, uploadError],
  );

  const remove = useCallback(
    async (fileId: string) => {
      if (agentId === null) return;
      try {
        await agentsApi.removeFile(agentId, fileId);
      } catch (err) {
        toast({ message: errorMessage(err), tone: 'danger' });
      } finally {
        void qc.invalidateQueries({ queryKey });
      }
    },
    [agentId, qc, queryKey],
  );

  const dismissProblem = useCallback(
    (key: string) => setProblems((l) => l.filter((p) => p.key !== key)),
    [],
  );

  return { query, files: query.data ?? [], uploading, problems, add, remove, dismissProblem };
}

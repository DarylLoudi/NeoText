import type { MessagePublic, ProjectVersion } from '@neotext/shared';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

/** What the transcript needs of the visible branch's project. */
export interface ChatProject {
  /** By the assistant message that made each version. */
  versions: ReadonlyMap<string, ProjectVersion>;
  /** True when the latest version has an HTML page to preview. */
  hasPage: boolean;
}

export const NO_PROJECT: ChatProject = { versions: new Map(), hasPage: false };
export const ProjectContext = createContext<ChatProject>(NO_PROJECT);

export function useProjectVersion(messageId: string): ProjectVersion | undefined {
  return useContext(ProjectContext).versions.get(messageId);
}

type Compute = (path: MessagePublic[]) => ChatProject;
let compute: Compute | null = null;

/**
 * The project of `path`. The replay code is its own chunk, fetched after the first paint, so a
 * chat opens as fast as before; until it arrives the chat shows no project rows.
 */
export function useChatProject(path: MessagePublic[]): ChatProject {
  const [ready, setReady] = useState(compute !== null);
  useEffect(() => {
    if (compute) return;
    let live = true;
    void import('./project-compute').then((m) => {
      compute = m.chatProject;
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);
  return useMemo(() => (ready && compute ? compute(path) : NO_PROJECT), [ready, path]);
}

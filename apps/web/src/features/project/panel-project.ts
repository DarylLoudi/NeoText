import { type MessagePublic, type ReplayedProject, replayProject } from '@neotext/shared';
import { useRef } from 'react';

/**
 * What a message adds to the panel's project. A finished message by identity; one still being
 * written by its finished calls only, so prose streaming in changes nothing.
 */
function inputOf(m: MessagePublic): MessagePublic | string {
  if (m.status !== 'streaming') return m;
  const calls = m.parts.flatMap((p) => (p.type === 'tool_call' && p.status === 'ok' ? [p.id] : []));
  return `${m.id}\u0000${calls.join('\u0000')}`;
}

/** An answer still being written counts by its finished tool calls only, not its prose. */
const settled = (path: MessagePublic[]) =>
  path.map((m) =>
    m.status === 'streaming' ? { ...m, parts: m.parts.filter((p) => p.type !== 'text') } : m,
  );

/**
 * The project of the panel's branch. Replayed again only when a message's contribution
 * changes, not on every frame of an answer streaming in.
 */
export function usePanelProject(path: MessagePublic[]): ReplayedProject {
  const last = useRef<{ inputs: (MessagePublic | string)[]; project: ReplayedProject } | null>(
    null,
  );
  const inputs = path.map(inputOf);
  const prev = last.current;
  if (
    !prev ||
    prev.inputs.length !== inputs.length ||
    prev.inputs.some((x, i) => x !== inputs[i])
  ) {
    last.current = { inputs, project: replayProject(settled(path)) };
  }
  return (last.current as { project: ReplayedProject }).project;
}

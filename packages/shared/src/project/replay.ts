import type { MessagePublic, ToolCallPart } from '../chat';
import { opsFromText } from './code-blocks';
import { byteSize, normalizeProjectPath } from './paths';
import {
  type FileChange,
  PROJECT_LIMITS,
  PROJECT_TOOLS,
  type ProjectOp,
  type ProjectVersion,
  type ReplayedProject,
} from './types';

export const INVALID_PATH_ERROR =
  'Use a relative path such as index.html or css/style.css (letters, digits, . _ - and /; html, css, js, mjs, json, svg, txt or md).';

const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;
const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

function occurrences(text: string, part: string): number {
  if (part === '') return 0;
  let count = 0;
  for (let at = text.indexOf(part); at !== -1; at = text.indexOf(part, at + part.length)) count++;
  return count;
}

function totalBytes(files: ReadonlyMap<string, string>, without: string): number {
  let total = 0;
  for (const [path, content] of files) if (path !== without) total += byteSize(content);
  return total;
}

/** Checks the limits for `content` stored at `path`; null when it fits. */
function limitError(files: ReadonlyMap<string, string>, path: string, content: string) {
  if (!files.has(path) && files.size >= PROJECT_LIMITS.files) {
    return `The project already has ${PROJECT_LIMITS.files} files, the most it can hold.`;
  }
  const size = byteSize(content);
  if (size > PROJECT_LIMITS.fileBytes) {
    return `${path} would be larger than ${kb(PROJECT_LIMITS.fileBytes)}, the most one file can be.`;
  }
  if (totalBytes(files, path) + size > PROJECT_LIMITS.projectBytes) {
    return `The project would be larger than ${mb(PROJECT_LIMITS.projectBytes)}, the most it can be.`;
  }
  return null;
}

/**
 * Applies one operation to `files`, changing it only on success. The error sentences are what
 * the file tools return to the model, so the server and the web refuse the same operations.
 */
export function applyOp(
  files: Map<string, string>,
  op: ProjectOp,
): { ok: true; change: FileChange } | { ok: false; error: string } {
  const path = normalizeProjectPath(op.path);
  if (path === null) return { ok: false, error: INVALID_PATH_ERROR };
  const current = files.get(path);
  if (op.kind === 'write') {
    const error = limitError(files, path, op.content);
    if (error) return { ok: false, error };
    files.set(path, op.content);
    return { ok: true, change: { path, kind: current === undefined ? 'created' : 'edited' } };
  }
  if (current === undefined) {
    return { ok: false, error: `There is no file ${path} in the project.` };
  }
  if (op.kind === 'delete') {
    files.delete(path);
    return { ok: true, change: { path, kind: 'deleted' } };
  }
  const found = occurrences(current, op.oldText);
  if (found === 0) {
    return {
      ok: false,
      error: `The text to replace was not found in ${path}. Read the file and copy the exact text.`,
    };
  }
  if (found > 1) {
    return {
      ok: false,
      error: `The text to replace appears ${found} times in ${path}. Include more of the surrounding lines so it matches once.`,
    };
  }
  const next = current.replace(op.oldText, () => op.newText);
  const error = limitError(files, path, next);
  if (error) return { ok: false, error };
  files.set(path, next);
  return { ok: true, change: { path, kind: 'edited' } };
}

/**
 * The string fields of a call's JSON arguments, or null when any is missing or not text. Read by
 * hand: the web replays in a lazy chunk that should not pull the schema library out of the
 * first page's.
 */
function stringArgs<K extends string>(raw: string, keys: K[]): Record<K, string> | null {
  let args: unknown;
  try {
    args = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof args !== 'object' || args === null) return null;
  const record = args as Record<string, unknown>;
  const out = {} as Record<K, string>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'string') return null;
    out[key] = value;
  }
  return out;
}

/** The operation a project tool call asked for; null for other tools, `read_file` or bad args. */
export function opFromToolCall(part: ToolCallPart): ProjectOp | null {
  if (part.name === PROJECT_TOOLS.write) {
    const a = stringArgs(part.args, ['path', 'content']);
    return a ? { kind: 'write', path: a.path, content: a.content } : null;
  }
  if (part.name === PROJECT_TOOLS.edit) {
    const a = stringArgs(part.args, ['path', 'old_text', 'new_text']);
    return a ? { kind: 'edit', path: a.path, oldText: a.old_text, newText: a.new_text } : null;
  }
  if (part.name === PROJECT_TOOLS.remove) {
    const a = stringArgs(part.args, ['path']);
    return a ? { kind: 'delete', path: a.path } : null;
  }
  return null;
}

const CHANGING_TOOLS: ReadonlySet<string> = new Set([
  PROJECT_TOOLS.write,
  PROJECT_TOOLS.edit,
  PROJECT_TOOLS.remove,
]);

/** True when the message has a project tool call, whatever its outcome. */
export function hasProjectCall(message: MessagePublic): boolean {
  return message.parts.some((p) => p.type === 'tool_call' && CHANGING_TOOLS.has(p.name));
}

/**
 * The operations a message carries, in order; `null` marks one whose arguments were unusable.
 * A message with any project tool call ignores its code blocks: such models quote snippets in
 * prose. Without one, named code blocks in its text are the operations.
 */
function opsOf(message: MessagePublic): (ProjectOp | null)[] {
  if (!hasProjectCall(message)) {
    return message.parts.flatMap((p) => (p.type === 'text' ? opsFromText(p.text) : []));
  }
  return message.parts.flatMap((p) =>
    p.type === 'tool_call' && p.status === 'ok' && CHANGING_TOOLS.has(p.name)
      ? [opFromToolCall(p)]
      : [],
  );
}

/** Folds one message's changes so each file is listed once, by what it became overall. */
function merge(changes: Map<string, FileChange['kind']>, change: FileChange): void {
  const before = changes.get(change.path);
  if (before === undefined) changes.set(change.path, change.kind);
  else if (before === 'created' && change.kind === 'deleted') changes.delete(change.path);
  else if (before === 'created') return;
  else if (before === 'deleted') changes.set(change.path, 'edited');
  else changes.set(change.path, change.kind);
}

/**
 * The project of a branch, rebuilt from the file operations of its assistant messages, root to
 * leaf. The server runs this for the turn's tools and system line, the web for the panel.
 */
export function replayProject(path: MessagePublic[]): ReplayedProject {
  const files = new Map<string, string>();
  const versions: ProjectVersion[] = [];
  let skipped = 0;
  for (const message of path) {
    if (message.role !== 'assistant') continue;
    const changes = new Map<string, FileChange['kind']>();
    for (const op of opsOf(message)) {
      const result = op ? applyOp(files, op) : null;
      if (result?.ok) merge(changes, result.change);
      else skipped++;
    }
    if (changes.size === 0) continue;
    versions.push({
      messageId: message.id,
      number: versions.length + 1,
      changes: [...changes].map(([p, kind]) => ({ path: p, kind })),
      files: new Map(files),
    });
  }
  return { files, versions, skipped };
}

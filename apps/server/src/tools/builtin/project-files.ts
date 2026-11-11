import {
  applyOp,
  byteSize,
  normalizeProjectPath,
  PROJECT_TOOLS,
  type ProjectFiles,
  type ProjectOp,
} from '@neotext/shared';
import { z } from 'zod';
import type { ToolSource } from '../registry';
import type { ToolDefinition, ToolResult } from '../types';

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const lineCount = (text: string) => (text === '' ? 0 : text.split('\n').length);

const pathParam = {
  type: 'string',
  description: 'Relative path such as index.html or css/style.css.',
};

const writeArgs = z.object({ path: z.string(), content: z.string() });
const editArgs = z.object({ path: z.string(), old_text: z.string(), new_text: z.string() });
const pathArgs = z.object({ path: z.string() });
const readArgs = z.object({
  path: z.string(),
  start_line: z.number().int().optional(),
  end_line: z.number().int().optional(),
});

/** Room for one read_file answer, below the tool loop's 16,000-character cut. */
const READ_BUDGET = 14_000;

/**
 * Numbered lines of `content` from `start`, up to `end` or until the answer is full. When lines
 * are left after the shown ones, a last line says how to ask for the rest.
 */
function readLines(path: string, content: string, start = 1, end?: number): ToolResult {
  const lines = content.split('\n');
  const total = lines.length;
  if (start < 1 || start > total) {
    return {
      ok: false,
      error: `${path} has ${total} lines; start_line must be between 1 and ${total}.`,
    };
  }
  const last = Math.min(end ?? total, total);
  const shown: string[] = [];
  let size = 0;
  for (let n = start; n <= last; n++) {
    const line = `${n}| ${lines[n - 1] ?? ''}`;
    if (shown.length > 0 && size + line.length + 1 > READ_BUDGET) break;
    shown.push(line);
    size += line.length + 1;
  }
  const through = start + shown.length - 1;
  const more =
    through < total
      ? `\n\nShowing lines ${start}-${through} of ${total}. Call read_file with start_line=${through + 1} for more.`
      : '';
  return { ok: true, content: `${shown.join('\n')}${more}` };
}

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  run: (args: unknown) => ToolResult,
  required: string[] = Object.keys(properties),
): ToolDefinition {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
    source: 'app',
    defaultPolicy: 'auto',
    timeoutMs: 5_000,
    // They share the turn's files, so the order they run in is the order the replay applies.
    ordered: true,
    execute: async (args) => run(args),
  };
}

/**
 * The four tools over this turn's project files. They share `files`, so a later call in the turn
 * sees an earlier one; what they store is replayed from the saved calls on the next turn.
 */
export function createProjectTools(files: Map<string, string>): ToolDefinition[] {
  const apply = (op: ProjectOp, ok: (path: string, existed: boolean) => string): ToolResult => {
    const path = normalizeProjectPath(op.path);
    const existed = path !== null && files.has(path);
    const result = applyOp(files, op);
    return result.ok
      ? { ok: true, content: ok(result.change.path, existed) }
      : { ok: false, error: result.error };
  };

  return [
    tool(
      PROJECT_TOOLS.write,
      "Create or replace a file of this chat's web project, which the user sees running in a preview. Use the project tools only when the user wants a web page or browser app; answer other code in code blocks. The preview is offline: no CDN links, web fonts, remote images or fetch calls. Use index.html as the entry page and split larger projects into files.",
      { path: pathParam, content: { type: 'string', description: 'The whole file.' } },
      (raw) => {
        const a = writeArgs.safeParse(raw);
        if (!a.success) return { ok: false, error: 'Give "path" and "content" as text.' };
        const { path, content } = a.data;
        return apply(
          { kind: 'write', path, content },
          (p, existed) => `${existed ? 'Replaced' : 'Created'} ${p} (${kb(byteSize(content))}).`,
        );
      },
    ),
    tool(
      PROJECT_TOOLS.edit,
      'Replace one exact piece of text in a project file. Prefer this over write_file for small changes. old_text must match once, including spaces and line breaks.',
      {
        path: pathParam,
        old_text: { type: 'string', description: 'The exact text to replace.' },
        new_text: { type: 'string', description: 'The text to put in its place.' },
      },
      (raw) => {
        const a = editArgs.safeParse(raw);
        if (!a.success) {
          return { ok: false, error: 'Give "path", "old_text" and "new_text" as text.' };
        }
        const { path, old_text: oldText, new_text: newText } = a.data;
        const lines = Math.max(lineCount(oldText), lineCount(newText));
        return apply(
          { kind: 'edit', path, oldText, newText },
          (p) => `Edited ${p} (${lines} ${lines === 1 ? 'line' : 'lines'} changed).`,
        );
      },
    ),
    tool(PROJECT_TOOLS.remove, 'Delete a project file.', { path: pathParam }, (raw) => {
      const a = pathArgs.safeParse(raw);
      if (!a.success) return { ok: false, error: 'Give "path" as text.' };
      return apply({ kind: 'delete', path: a.data.path }, (p) => `Deleted ${p}.`);
    }),
    tool(
      PROJECT_TOOLS.read,
      'Read a project file with line numbers before editing it. A long file comes in parts: pass start_line (and end_line) to read on.',
      {
        path: pathParam,
        start_line: {
          type: 'integer',
          minimum: 1,
          description: 'First line to read; 1 by default.',
        },
        end_line: { type: 'integer', minimum: 1, description: 'Last line to read.' },
      },
      (raw) => {
        const a = readArgs.safeParse(raw);
        if (!a.success)
          return { ok: false, error: 'Give "path" as text, and line numbers as whole numbers.' };
        const path = normalizeProjectPath(a.data.path) ?? a.data.path;
        const content = files.get(path);
        if (content === undefined) {
          return { ok: false, error: `There is no file ${path} in the project.` };
        }
        return readLines(path, content, a.data.start_line, a.data.end_line);
      },
      ['path'],
    ),
  ];
}

/** The system line of a turn whose branch has a project: its files, never their contents. */
export function projectGuidance(files: ProjectFiles, version: number): string | null {
  // Named code blocks of an ordinary answer (a script, a config) are not a web page to work on.
  if (![...files.keys()].some((path) => /\.html?$/i.test(path))) return null;
  const listed = [...files]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([path, content]) => `${path} (${kb(byteSize(content))})`)
    .join(', ');
  return `This chat has a web project (version ${version}): ${listed}. Read a file with read_file before editing it. The preview runs offline: keep everything in the project (no CDN links, web fonts, remote images or fetch calls); use inline SVG or data: URIs for pictures.`;
}

/**
 * Lists the project tools in Settings → Tools so their policies can be changed. A turn gets the
 * real tools, bound to its branch's files, from the target run.
 */
export const projectListingSource: ToolSource = (_auth, turn) =>
  turn === null ? createProjectTools(new Map()) : [];

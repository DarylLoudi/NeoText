import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

export const DONE = 'data: [DONE]\n\n';

const frame = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`;

/** An OpenAI chunk frame with one choice holding `delta`, merged with `extra`. */
export function chunk(delta: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  return frame({
    id: 'gen-mock',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta, finish_reason: null }],
    ...extra,
  });
}

export function finish(reason: string): string {
  return frame({
    id: 'gen-mock',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: {}, finish_reason: reason }],
  });
}

export function usage(u: Record<string, unknown>): string {
  return frame({ id: 'gen-mock', object: 'chat.completion.chunk', choices: [], usage: u });
}

export function textFrames(...texts: string[]): string[] {
  return [
    ...texts.map((text) => chunk({ content: text })),
    finish('stop'),
    usage({ prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 }),
    DONE,
  ];
}

/** Reads `fixtures/<name>.sse` and returns its frames, each with its trailing blank line. */
export function fixtureFrames(name: string): string[] {
  const raw = readFileSync(join(dir, 'fixtures', `${name}.sse`), 'utf8').replace(/\r\n/g, '\n');
  return raw
    .split('\n\n')
    .filter((f) => f.trim() !== '')
    .map((f) => `${f.replace(/\n$/, '')}\n\n`);
}

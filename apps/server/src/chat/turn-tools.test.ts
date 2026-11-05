import type { ModelInfo } from '@neotext/shared';
import { defaultSettings } from '@neotext/shared';
import { describe, expect, test, vi } from 'vitest';
import type { AuthContext } from '../http/env';
import { createSemaphore } from '../lib/semaphore';
import type { ToolDefinition } from '../tools/types';
import { anyTargetMayUseTools, toolsPossible, turnText, turnToolFields } from './turn-tools';

const tool: ToolDefinition = {
  name: 'echo',
  description: 'Echo.',
  parameters: { type: 'object' },
  source: 'app',
  defaultPolicy: 'auto',
  execute: vi.fn(),
};
const withTools = (tools: boolean | null) => ({ supports: { tools } }) as unknown as ModelInfo;
const context = {
  userId: 'usr_1',
  timeZone: 'UTC',
  signal: new AbortController().signal,
  http: {} as never,
  log: {} as never,
  fetchSlots: createSemaphore(4),
};
/** The kind names the scenario; it does not change the outcome (ruling R9). */
const fields = (_kind: 'openrouter' | 'openai-compatible', model: ModelInfo | null) =>
  turnToolFields({
    available: [tool],
    settings: defaultSettings().tools,
    model,
    context,
  });

describe('toolsPossible', () => {
  test('only reported "no support" rules tools out, for every provider kind', () => {
    expect(toolsPossible(withTools(true))).toBe(true);
    expect(toolsPossible(withTools(null))).toBe(true);
    expect(toolsPossible(null)).toBe(true);
    expect(toolsPossible(withTools(false))).toBe(false);
  });
});

describe('turnToolFields', () => {
  test('a model without tool support gets no tools field', () => {
    expect(fields('openai-compatible', withTools(false))).toEqual({});
    expect(fields('openrouter', withTools(false))).toEqual({});
  });

  test('an OpenRouter model with unknown support, or missing from the cache, gets tools', () => {
    expect(fields('openrouter', withTools(null)).tools?.defs.map((d) => d.name)).toEqual(['echo']);
    expect(fields('openrouter', null).tools?.defs.map((d) => d.name)).toEqual(['echo']);
    expect(fields('openai-compatible', null).tools?.defs.map((d) => d.name)).toEqual(['echo']);
  });

  test('a model with tool support gets the set, the step limit and the context', () => {
    const r = fields('openrouter', withTools(true));
    expect(r.tools?.defs.map((d) => d.name)).toEqual(['echo']);
    expect(r.maxSteps).toBe(8);
    expect(r.toolContext).toBe(context);
  });

  test('no tools left after policies means no tools field', () => {
    const settings = { policies: { echo: 'off' as const }, maxSteps: 8 };
    expect(
      turnToolFields({
        available: [tool],
        settings,
        model: withTools(true),
        context,
      }),
    ).toEqual({});
  });
});

describe('turn helpers', () => {
  const auth = { userId: 'usr_1', dek: Buffer.alloc(32) } as AuthContext;
  const ref = (providerId: string) => ({ providerId, modelId: 'm' });
  const providers = (
    kinds: Record<string, 'openrouter' | 'openai-compatible'>,
    tools: boolean | null,
  ) => ({
    resolveEnabled: (_a: AuthContext, id: string) => {
      const kind = kinds[id];
      if (!kind) throw new Error('disabled');
      return { kind } as never;
    },
    cachedModel: () => withTools(tools),
  });

  test('tool lists are fetched only when some target may use tools', () => {
    expect(anyTargetMayUseTools(auth, [ref('or')], providers({ or: 'openrouter' }, null))).toBe(
      true,
    );
    expect(anyTargetMayUseTools(auth, [ref('or')], providers({ or: 'openrouter' }, true))).toBe(
      true,
    );
    expect(
      anyTargetMayUseTools(auth, [ref('x'), ref('c')], providers({ c: 'openai-compatible' }, null)),
    ).toBe(true);
    expect(
      anyTargetMayUseTools(auth, [ref('c')], providers({ c: 'openai-compatible' }, false)),
    ).toBe(false);
    expect(anyTargetMayUseTools(auth, [ref('gone')], providers({}, true))).toBe(false);
  });

  test('turn text is the new message, else the own parent being regenerated', () => {
    const parent = { userId: 'usr_1', parts: [{ type: 'text', text: 'see https://x.org' }] };
    const repo = (m: unknown) => ({ get: () => m as never });
    const body = (over: object) => ({ userMessage: null, parentId: 'msg_1', ...over }) as never;
    expect(turnText(auth, body({ userMessage: { text: 'hi' } }), repo(null))).toBe('hi');
    expect(turnText(auth, body({}), repo(parent))).toBe('see https://x.org');
    expect(turnText(auth, body({}), repo({ ...parent, userId: 'usr_2' }))).toBe('');
    expect(turnText(auth, body({ parentId: null }), repo(parent))).toBe('');
    const broken = {
      get: () => {
        throw new Error('cannot open');
      },
    };
    expect(turnText(auth, body({}), broken)).toBe('');
  });
});

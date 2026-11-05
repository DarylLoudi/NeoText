import { afterEach, describe, expect, test, vi } from 'vitest';
import type { AuthContext } from '../http/env';
import { assembleToolSet, createToolCatalog, TOOL_SOURCE_WAIT_MS } from './registry';
import type { ToolDefinition } from './types';

const def = (name: string, over: Partial<ToolDefinition> = {}): ToolDefinition => ({
  name,
  description: `${name} tool`,
  parameters: { type: 'object', properties: {} },
  source: 'app',
  defaultPolicy: 'auto',
  execute: async () => ({ ok: true, content: name }),
  ...over,
});
const auth = { userId: 'usr_1' } as AuthContext;
const warn = vi.fn();
const log = { error: vi.fn(), warn, info: vi.fn() } as never;

describe('assembleToolSet', () => {
  test('off tools are not offered', () => {
    const set = assembleToolSet([def('x'), def('y')], { x: 'off' });
    expect(set.defs.map((d) => d.name)).toEqual(['y']);
    expect(set.get('x')).toBeUndefined();
    expect(set.policy('x')).toBe('off');
    expect(set.get('y')?.name).toBe('y');
  });

  test('user policy wins over the default; the default applies otherwise', () => {
    const set = assembleToolSet([def('a'), def('m', { source: 'mcp', defaultPolicy: 'ask' })], {
      a: 'ask',
    });
    expect(set.policy('a')).toBe('ask');
    expect(set.policy('m')).toBe('ask');
    expect(assembleToolSet([def('m', { defaultPolicy: 'off' })], { m: 'auto' }).defs).toHaveLength(
      1,
    );
  });

  test('defs carry only what the provider needs', () => {
    expect(assembleToolSet([def('a')], {}).defs).toEqual([
      { name: 'a', description: 'a tool', parameters: { type: 'object', properties: {} } },
    ]);
  });

  test('unknown names have no tool', () => {
    const set = assembleToolSet([], {});
    expect(set.get('nope')).toBeUndefined();
    expect(set.defs).toEqual([]);
  });
});

describe('tool catalog', () => {
  test('is empty until a source is added', async () => {
    const catalog = createToolCatalog({ log });
    expect(await catalog.forTurn(auth, { userText: 'hi', webSearch: false })).toEqual([]);
    expect(await catalog.list(auth)).toEqual([]);
  });

  test('combines sources, first name wins, a failing source is skipped', async () => {
    const catalog = createToolCatalog({ log });
    const seen: unknown[] = [];
    catalog.add((_a, turn) => {
      seen.push(turn);
      return [def('a'), def('b')];
    });
    catalog.add(async () => {
      throw new Error('mcp down');
    });
    catalog.add(async () => [def('a', { description: 'shadowed' }), def('c')]);
    const tools = await catalog.forTurn(auth, { userText: 'hi', webSearch: true });
    expect(tools.map((t) => [t.name, t.description])).toEqual([
      ['a', 'a tool'],
      ['b', 'b tool'],
      ['c', 'c tool'],
    ]);
    expect((await catalog.list(auth)).map((t) => t.name)).toEqual(['a', 'b', 'c']);
    expect(seen).toEqual([{ userText: 'hi', webSearch: true }, null]);
    expect(warn).toHaveBeenCalled();
  });

  test('a slow source is skipped for this turn without holding it up', async () => {
    vi.useFakeTimers();
    warn.mockClear();
    const catalog = createToolCatalog({ log });
    catalog.add(() => [def('fast')]);
    catalog.add(() => new Promise<ToolDefinition[]>(() => {}));
    const pending = catalog.forTurn(auth, { userText: 'secret text', webSearch: false });
    await vi.advanceTimersByTimeAsync(TOOL_SOURCE_WAIT_MS);
    expect((await pending).map((t) => t.name)).toEqual(['fast']);
    expect(TOOL_SOURCE_WAIT_MS).toBe(2_000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret text');
  });
});

afterEach(() => {
  vi.useRealTimers();
});

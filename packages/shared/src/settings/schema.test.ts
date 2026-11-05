import { describe, expect, test } from 'vitest';
import { modelKey, parseModelKey } from '../model-ref';
import {
  defaultSettings,
  engineMode,
  parseSettings,
  SidebarSectionSchema,
  SidebarSectionsSchema,
  WEB_SEARCH_ENGINE_MODES,
  WEB_SEARCH_ENGINES,
} from './schema';

describe('parseSettings', () => {
  test('empty input gives defaults with nothing reset', () => {
    expect(parseSettings({})).toEqual({ settings: defaultSettings(), resetPaths: [] });
    expect(defaultSettings().sidebar.sections.map((s) => s.id)).toEqual([
      'pinned',
      'folders',
      'recent',
      'presets',
      'archived',
    ]);
    expect(defaultSettings().sidebar.sections.at(-1)?.visible).toBe(false);
  });
  test('an invalid leaf resets alone', () => {
    const { settings, resetPaths } = parseSettings({
      appearance: { theme: 'neon', accent: 'mint' },
    });
    expect(settings.appearance.theme).toBe('system');
    expect(settings.appearance.accent).toBe('mint');
    expect(resetPaths).toEqual(['appearance.theme']);
  });
  test('an invalid object resets that object', () => {
    expect(parseSettings({ appearance: 'x' }).resetPaths).toEqual(['appearance']);
  });
  test('out of range numbers reset', () => {
    const { settings } = parseSettings({ appearance: { fontScale: 3 }, sidebar: { width: 1000 } });
    expect(settings.appearance.fontScale).toBe(1);
    expect(settings.sidebar.width).toBe(288);
  });
  test('keeps unknown keys', () => {
    const { settings } = parseSettings({
      futureFeature: { a: 1 },
      appearance: { theme: 'dark', newKnob: true },
    });
    expect((settings as Record<string, unknown>).futureFeature).toEqual({ a: 1 });
    expect((settings.appearance as Record<string, unknown>).newKnob).toBe(true);
  });
  test('keeps unknown sidebar section kinds', () => {
    const sections = [{ id: 'cal', kind: 'calendar', visible: true, collapsed: false }];
    expect(parseSettings({ sidebar: { sections } }).settings.sidebar.sections).toEqual(sections);
  });
  test('drops non-object sections and falls back when none are left', () => {
    const { settings } = parseSettings({ sidebar: { sections: [1, 'x', null] } });
    expect(settings.sidebar.sections).toEqual(defaultSettings().sidebar.sections);
    const kept = parseSettings({
      sidebar: { sections: [7, { id: 'a', kind: 'pinned' }] },
    }).settings.sidebar.sections;
    expect(kept).toEqual([{ id: 'a', kind: 'pinned', visible: true, collapsed: false }]);
  });
  test('absent paths are never reported, only replaced values', () => {
    const r = parseSettings({ sidebar: { sections: [{ id: 'a', kind: 'pinned' }] } });
    expect(r.resetPaths).toEqual([]);
    const bad = parseSettings({ sidebar: { sections: [{ id: 'a', kind: 'pinned', visible: 3 }] } });
    expect(bad.resetPaths).toEqual(['sidebar.sections.0.visible']);
  });
  test('chat and models fields validate', () => {
    const ref = { providerId: 'p', modelId: 'm' };
    const { settings, resetPaths } = parseSettings({
      chat: {
        defaultModel: ref,
        titleModel: { providerId: '' },
        temperature: 0.5,
        defaultSystemPrompt: 'x'.repeat(20001),
        reasoningEffort: 'max',
      },
      models: { favorites: ['p|m', 4], overrides: { 'p|m': { contextLength: 1000 } } },
    });
    expect(settings.chat.defaultModel).toEqual(ref);
    expect(settings.chat.titleModel).toBeNull();
    expect(settings.chat.temperature).toBe(0.5);
    expect(settings.chat.defaultSystemPrompt).toBe('');
    expect(settings.chat.reasoningEffort).toBe('max');
    expect(settings.models.favorites).toEqual(['p|m']);
    expect(settings.models.overrides['p|m']?.contextLength).toBe(1000);
    expect(resetPaths).toEqual(['chat.titleModel', 'chat.defaultSystemPrompt', 'models.favorites']);
  });
  test('array leaves drop only the invalid elements', () => {
    const { settings, resetPaths } = parseSettings({
      sidebar: { quickActions: ['usage', 'warp', 3, 'search'] },
      models: { favorites: ['a|b', null, 'c|d'], hidden: [{}, 'x|y'] },
    });
    expect(settings.sidebar.quickActions).toEqual(['usage', 'search']);
    expect(settings.models.favorites).toEqual(['a|b', 'c|d']);
    expect(settings.models.hidden).toEqual(['x|y']);
    expect(resetPaths).toEqual(['sidebar.quickActions', 'models.favorites', 'models.hidden']);
  });
  test('an intentionally empty list stays empty; a non-array falls back', () => {
    const { settings } = parseSettings({
      sidebar: { quickActions: [] },
      models: { favorites: 'nope' },
    });
    expect(settings.sidebar.quickActions).toEqual([]);
    expect(settings.models.favorites).toEqual([]);
  });
  test('smart filter id lists drop only invalid ids', () => {
    const sections = [{ id: 's', kind: 'smart', filter: { modelIds: ['p|m', 5], folderIds: 'x' } }];
    const [first] = parseSettings({ sidebar: { sections } }).settings.sidebar.sections;
    expect(first?.filter?.modelIds).toEqual(['p|m']);
    expect(first?.filter?.folderIds).toBeUndefined();
  });
  test('shortcuts default to none and keep only combos written as text', () => {
    expect(defaultSettings().shortcuts).toEqual({});
    const { settings, resetPaths } = parseSettings({
      shortcuts: { palette: '$mod+KeyP', 'new-chat': 4, settings: null },
    });
    expect(settings.shortcuts).toEqual({ palette: '$mod+KeyP' });
    expect(resetPaths).toEqual(['shortcuts.new-chat', 'shortcuts.settings']);
    expect(parseSettings({ shortcuts: 'nope' }).settings.shortcuts).toEqual({});
  });
  test('snippets default to empty and survive unknown fields', () => {
    expect(defaultSettings().snippets).toEqual([]);
    const good = {
      id: 'a',
      trigger: 'sum',
      title: 'Summarise',
      body: 'Summarise {{topic}}',
      extra: 1,
    };
    const { settings } = parseSettings({
      snippets: [good, { id: 'b', trigger: 5 }, 'junk', { ...good, id: 'c' }],
    });
    expect(settings.snippets.map((s) => s.id)).toEqual(['a', 'c']);
    expect(settings.snippets[0]).toMatchObject({ extra: 1 });
    expect(parseSettings({ snippets: 'nope' }).settings.snippets).toEqual([]);
  });
  test('web search and tools defaults', () => {
    const d = defaultSettings();
    expect(d.webSearch).toEqual({
      defaultOn: false,
      engine: 'parallel',
      mode: 'fast',
      maxResults: 5,
      maxSearchesPerTurn: 3,
      contextSize: null,
      backendProviderId: null,
    });
    expect(d.tools).toEqual({ policies: {}, maxSteps: 8 });
  });
  test('web search fields reset one by one and keep unknown keys', () => {
    const { settings, resetPaths } = parseSettings({
      webSearch: {
        defaultOn: true,
        engine: 'bing',
        mode: null,
        maxResults: 11,
        maxSearchesPerTurn: 2,
        contextSize: 'high',
        backendProviderId: 'prv_1',
        future: 1,
      },
    });
    expect(settings.webSearch).toMatchObject({
      defaultOn: true,
      engine: 'parallel',
      mode: null,
      maxResults: 5,
      maxSearchesPerTurn: 2,
      contextSize: 'high',
      backendProviderId: 'prv_1',
    });
    expect((settings.webSearch as Record<string, unknown>).future).toBe(1);
    expect(resetPaths).toEqual(['webSearch.engine', 'webSearch.maxResults']);
    expect(parseSettings({ webSearch: 'x' }).resetPaths).toEqual(['webSearch']);
  });
  test('tool policies drop only invalid entries; maxSteps stays in range', () => {
    const { settings, resetPaths } = parseSettings({
      tools: {
        policies: { fetch_url: 'off', mcp_a_b: 'ask', bad: 'sometimes', n: 3 },
        maxSteps: 21,
      },
    });
    expect(settings.tools.policies).toEqual({ fetch_url: 'off', mcp_a_b: 'ask' });
    expect(settings.tools.maxSteps).toBe(8);
    expect(resetPaths).toEqual(['tools.policies.bad', 'tools.policies.n', 'tools.maxSteps']);
    expect(parseSettings({ tools: { policies: [], maxSteps: 20 } }).settings.tools).toEqual({
      policies: {},
      maxSteps: 20,
    });
  });
  test('budget defaults, and a bad field resets alone', () => {
    expect(defaultSettings().budget).toEqual({
      dailyUsd: null,
      monthlyUsd: null,
      warnAtPercent: 80,
      hardStop: false,
    });
    const { settings, resetPaths } = parseSettings({
      appearance: { theme: 'dark' },
      budget: { dailyUsd: 0.5, monthlyUsd: -1, warnAtPercent: 40, hardStop: true },
    });
    expect(settings.appearance.theme).toBe('dark');
    expect(settings.budget).toEqual({
      dailyUsd: 0.5,
      monthlyUsd: null,
      warnAtPercent: 80,
      hardStop: true,
    });
    expect(resetPaths).toEqual(['budget.monthlyUsd', 'budget.warnAtPercent']);
    expect(parseSettings({ budget: 'x' }).resetPaths).toEqual(['budget']);
  });
  test('defaults are fresh objects each call', () => {
    const a = defaultSettings();
    const first = a.sidebar.sections[0];
    if (first) first.visible = false;
    a.models.favorites.push('x');
    a.sidebar.quickActions.push('usage');
    const b = defaultSettings();
    expect(b.sidebar.sections[0]?.visible).toBe(true);
    expect(b.models.favorites).toEqual([]);
    expect(b.sidebar.quickActions).toEqual(['new-chat', 'search']);
  });
  test('parsed defaults are not shared between calls either', () => {
    const a = parseSettings({}).settings;
    const first = a.sidebar.sections[0];
    if (first) first.visible = false;
    expect(parseSettings({}).settings.sidebar.sections[0]?.visible).toBe(true);
  });
  test('non-object root yields defaults', () => {
    expect(parseSettings(null).settings).toEqual(defaultSettings());
  });
});

describe('sidebar section schemas', () => {
  test('the element schema validates one section and keeps unknown keys', () => {
    expect(SidebarSectionSchema.safeParse({ id: 'a', kind: 'pinned', extra: 1 }).data).toEqual({
      id: 'a',
      kind: 'pinned',
      visible: true,
      collapsed: false,
      extra: 1,
    });
    expect(SidebarSectionSchema.safeParse({ kind: 'pinned' }).success).toBe(false);
  });
  test('the array schema drops invalid elements', () => {
    expect(SidebarSectionsSchema.parse([{ id: 'a', kind: 'recent' }, 'x'])).toEqual([
      { id: 'a', kind: 'recent', visible: true, collapsed: false },
    ]);
  });
});

describe('model keys', () => {
  test('round trip', () => {
    expect(modelKey({ providerId: 'p', modelId: 'a/b|c' })).toBe('p|a/b|c');
    expect(parseModelKey('p|a/b|c')).toEqual({ providerId: 'p', modelId: 'a/b|c' });
    expect(parseModelKey('nope')).toBeNull();
    expect(parseModelKey('|m')).toBeNull();
    expect(parseModelKey('p|')).toBeNull();
  });
});

describe('web search engine modes', () => {
  test('every engine lists its modes', () => {
    expect(Object.keys(WEB_SEARCH_ENGINE_MODES).sort()).toEqual([...WEB_SEARCH_ENGINES].sort());
  });

  test('a mode counts only for the engine that has it', () => {
    expect(engineMode('exa', 'deep')).toBe('deep');
    expect(engineMode('parallel', 'fast')).toBe('fast');
    expect(engineMode('perplexity', 'fast')).toBeNull();
    expect(engineMode('exa', 'fast')).toBeNull();
    expect(engineMode('exa', null)).toBeNull();
    expect(engineMode('constructor', 'name')).toBeNull();
  });
});

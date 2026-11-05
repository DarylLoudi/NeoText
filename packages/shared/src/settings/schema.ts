import { z } from 'zod';
import { ModelRefSchema } from '../model-ref';
import { findResetPaths } from './lenient';
import { isJsonObject } from './merge-patch';

export const SETTINGS_SCHEMA_VERSION = 1;

/** Leaf that falls back to its default alone when invalid. */
const leaf = <T extends z.ZodType>(schema: T, def: z.output<T>) => schema.catch(def);
/** Optional leaf: an invalid value is dropped. */
const opt = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);
/** Keeps the elements of `value` that `item` accepts; null when `value` is not an array. */
function keepValid<T extends z.ZodType>(item: T, value: unknown): z.output<T>[] | null {
  if (!Array.isArray(value)) return null;
  const kept: z.output<T>[] = [];
  for (const el of value) {
    const r = item.safeParse(el);
    if (r.success) kept.push(r.data);
  }
  return kept;
}
/**
 * Array leaf: invalid elements are dropped one by one (the rest of the user's list survives);
 * a non-array falls back to a fresh default.
 */
const list = <T extends z.ZodType>(item: T, def: () => z.output<T>[]) =>
  z
    .unknown()
    .transform((value): z.output<T>[] => keepValid(item, value) ?? def())
    .catch(() => def());
/** Optional array leaf: invalid elements are dropped; a non-array is dropped. */
const optList = <T extends z.ZodType>(item: T) =>
  z
    .unknown()
    .transform((value): z.output<T>[] | undefined => keepValid(item, value) ?? undefined)
    .catch(undefined);
/** Nested object: loose (unknown keys survive); a non-object falls back to its defaults. */
const section = <S extends z.ZodRawShape>(shape: S) => {
  const obj = z.looseObject(shape);
  return obj.catch(() => obj.parse({}));
};

const SIDEBAR_KINDS = ['pinned', 'folders', 'recent', 'presets', 'archived', 'smart'] as const;

export const SmartFilterSchema = z.looseObject({
  modelIds: optList(z.string()),
  folderIds: optList(z.string()),
  titleContains: opt(z.string()),
  updatedWithinDays: opt(z.number()),
});
export type SmartFilter = z.infer<typeof SmartFilterSchema>;

// `kind` is a plain string on purpose: kinds from newer versions are kept, the UI skips them.
export const SidebarSectionSchema = z.looseObject({
  id: z.string().min(1).max(64),
  kind: z.string(),
  visible: z.boolean().catch(true),
  collapsed: z.boolean().catch(false),
  title: opt(z.string()),
  groupBy: opt(z.enum(['date', 'none'])),
  includeFoldered: opt(z.boolean()),
  filter: opt(SmartFilterSchema),
});
export type SidebarSection = z.infer<typeof SidebarSectionSchema>;
export const KNOWN_SIDEBAR_KINDS: readonly string[] = SIDEBAR_KINDS;

export const DEFAULT_SIDEBAR_SECTIONS: readonly SidebarSection[] = [
  { id: 'pinned', kind: 'pinned', visible: true, collapsed: false },
  { id: 'folders', kind: 'folders', visible: true, collapsed: false },
  { id: 'recent', kind: 'recent', visible: true, collapsed: false, groupBy: 'date' },
  { id: 'presets', kind: 'presets', visible: true, collapsed: false },
  { id: 'archived', kind: 'archived', visible: false, collapsed: false },
];
const defaultSections = (): SidebarSection[] => structuredClone([...DEFAULT_SIDEBAR_SECTIONS]);

/** Non-object elements and elements without a valid id/kind are dropped; empty falls back. */
export const SidebarSectionsSchema = z
  .unknown()
  .transform((value): SidebarSection[] => {
    const kept = keepValid(SidebarSectionSchema, value);
    return kept && kept.length > 0 ? kept : defaultSections();
  })
  .catch(() => defaultSections());

const ModelOverrideSchema = z.looseObject({
  contextLength: opt(z.number()),
  maxOutputTokens: opt(z.number()),
  temperature: opt(z.number()),
  supportsTools: opt(z.boolean()),
  supportsVision: opt(z.boolean()),
  inputPricePerM: opt(z.number()),
  outputPricePerM: opt(z.number()),
});

const QuickActionSchema = z.enum(['new-chat', 'search', 'compare', 'presets', 'usage']);
type QuickAction = z.infer<typeof QuickActionSchema>;
const modelRefOrNull = () => ModelRefSchema.nullable().catch(null);

const AppearanceSchema = section({
  theme: leaf(z.enum(['system', 'light', 'dark']), 'dark'),
  accent: leaf(z.enum(['marker', 'mint', 'sky', 'rose', 'graphite']), 'marker'),
  uiFont: leaf(z.enum(['atkinson', 'system']), 'atkinson'),
  readingFont: leaf(z.enum(['atkinson', 'literata', 'system']), 'atkinson'),
  codeFont: leaf(z.enum(['atkinson-mono', 'system-mono']), 'atkinson-mono'),
  fontScale: leaf(z.number().min(0.875).max(1.25), 1),
  messageWidth: leaf(z.enum(['narrow', 'normal', 'wide']), 'normal'),
  density: leaf(z.enum(['comfortable', 'compact']), 'comfortable'),
  reduceMotion: leaf(z.enum(['system', 'on', 'off']), 'system'),
  showCost: leaf(z.boolean(), true),
  codeTheme: leaf(z.enum(['auto', 'vitesse', 'min']), 'auto'),
});

const SidebarSchema = section({
  position: leaf(z.enum(['left', 'right']), 'left'),
  width: leaf(z.number().min(240).max(420), 288),
  collapsed: leaf(z.boolean(), false),
  sections: SidebarSectionsSchema,
  quickActions: list(
    QuickActionSchema,
    () => ['new-chat', 'search'] as const satisfies QuickAction[],
  ),
});

const ChatSchema = section({
  defaultModel: modelRefOrNull(),
  defaultSystemPrompt: leaf(z.string().max(20000), ''),
  includeDate: leaf(z.boolean(), true),
  sendKey: leaf(z.enum(['enter', 'mod-enter']), 'enter'),
  autoTitle: leaf(z.boolean(), true),
  titleModel: modelRefOrNull(),
  continueInBackground: leaf(z.boolean(), true),
  reasoningEffort: leaf(
    z.enum(['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
    'auto',
  ),
  temperature: leaf(z.number().nullable(), null),
  maxOutputTokens: leaf(z.number().int().nullable(), null),
  contextStrategy: leaf(z.enum(['trim-oldest', 'none']), 'trim-oldest'),
});

/** Record leaf: entries whose value `item` rejects are dropped one by one; a non-object is {}. */
const recordOf = <T extends z.ZodType>(item: T) =>
  z
    .unknown()
    .transform((value): Record<string, z.output<T>> => {
      if (!isJsonObject(value)) return {};
      const kept: [string, z.output<T>][] = [];
      for (const [key, el] of Object.entries(value)) {
        const r = item.safeParse(el);
        if (r.success) kept.push([key, r.data]);
      }
      return Object.fromEntries(kept);
    })
    .catch(() => ({}));

/** Action id to key combo (tinykeys syntax). Entries that are not text are dropped one by one. */
const ShortcutsSchema = recordOf(z.string());

export const ToolPolicySchema = z.enum(['auto', 'ask', 'off']);
export type ToolPolicy = z.infer<typeof ToolPolicySchema>;

export const WEB_SEARCH_ENGINES = [
  'auto',
  'native',
  'exa',
  'parallel',
  'perplexity',
  'firecrawl',
] as const;

/** The modes each engine offers; an engine with none takes no `mode` at all. */
export const WEB_SEARCH_ENGINE_MODES = {
  auto: [],
  native: [],
  exa: ['auto', 'deep'],
  parallel: ['fast', 'basic'],
  perplexity: [],
  firecrawl: [],
} as const satisfies Record<(typeof WEB_SEARCH_ENGINES)[number], readonly string[]>;

/** The mode, when this engine has it; else null, so a stale saved mode is never used. */
export function engineMode(engine: string, mode: string | null): string | null {
  if (mode === null || !Object.hasOwn(WEB_SEARCH_ENGINE_MODES, engine)) return null;
  const modes: readonly string[] =
    WEB_SEARCH_ENGINE_MODES[engine as keyof typeof WEB_SEARCH_ENGINE_MODES];
  return modes.includes(mode) ? mode : null;
}

const WebSearchSchema = section({
  defaultOn: leaf(z.boolean(), false),
  engine: leaf(z.enum(WEB_SEARCH_ENGINES), 'parallel'),
  mode: leaf(z.string().max(64).nullable(), 'fast'),
  maxResults: leaf(z.number().int().min(1).max(10), 5),
  maxSearchesPerTurn: leaf(z.number().int().min(1).max(10), 3),
  contextSize: leaf(z.enum(['low', 'medium', 'high']).nullable(), null),
  backendProviderId: leaf(z.string().nullable(), null),
});

const ToolsSchema = section({
  policies: recordOf(ToolPolicySchema),
  maxSteps: leaf(z.number().int().min(1).max(20), 8),
  subagentModel: modelRefOrNull(),
  maxSubagents: leaf(z.number().int().min(2).max(6), 4),
});

const ModelsSchema = section({
  favorites: list(z.string(), () => []),
  hidden: list(z.string(), () => []),
  overrides: z
    .record(
      z.string(),
      ModelOverrideSchema.catch(() => ({})),
    )
    .catch(() => ({})),
});

/** Spending limits in USD; null is no limit. */
const BudgetSchema = section({
  dailyUsd: leaf(z.number().positive().nullable(), null),
  monthlyUsd: leaf(z.number().positive().nullable(), null),
  warnAtPercent: leaf(z.number().int().min(50).max(100), 80),
  hardStop: leaf(z.boolean(), false),
});

export const SnippetSchema = z.looseObject({
  id: z.string().min(1).max(64),
  trigger: z.string().regex(/^[a-z0-9-]{1,32}$/),
  title: z.string().max(200),
  body: z.string().max(20000),
});
export type Snippet = z.infer<typeof SnippetSchema>;

export const UserSettingsSchema = z.looseObject({
  locale: leaf(z.enum(['auto', 'en', 'id']), 'auto'),
  appearance: AppearanceSchema,
  sidebar: SidebarSchema,
  chat: ChatSchema,
  models: ModelsSchema,
  webSearch: WebSearchSchema,
  tools: ToolsSchema,
  shortcuts: ShortcutsSchema,
  snippets: list(SnippetSchema, () => []),
  budget: BudgetSchema,
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;

/** A fresh object on every call; callers may mutate it freely. */
export function defaultSettings(): UserSettings {
  return UserSettingsSchema.parse({});
}

export function parseSettings(raw: unknown): { settings: UserSettings; resetPaths: string[] } {
  const settings = UserSettingsSchema.catch(() => defaultSettings()).parse(raw);
  return { settings, resetPaths: findResetPaths(raw, settings) };
}

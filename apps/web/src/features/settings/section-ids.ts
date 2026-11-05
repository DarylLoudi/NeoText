export const SECTIONS = [
  'general',
  'appearance',
  'sidebar',
  'shortcuts',
  'snippets',
  'providers',
  'mcp',
  'models',
  'tools',
  'agents',
  'data',
  'security',
  'about',
] as const;
export type SectionId = (typeof SECTIONS)[number];

export const isSection = (value: string): value is SectionId =>
  (SECTIONS as readonly string[]).includes(value);

import { Navigate, useParams } from '@tanstack/react-router';
import type { ComponentType } from 'react';
import { SettingsLayout } from './SettingsLayout';
import { isSection, type SectionId } from './section-ids';
import { AboutSettings } from './sections/AboutSettings';
import { AppearanceSettings } from './sections/AppearanceSettings';
import { DataSettings } from './sections/DataSettings';
import { GeneralSettings } from './sections/GeneralSettings';
import { McpSettings } from './sections/McpSettings';
import { ModelsSettings } from './sections/ModelsSettings';
import { ProvidersSettings } from './sections/ProvidersSettings';
import { SecuritySettings } from './sections/SecuritySettings';
import { ShortcutsSettings } from './sections/ShortcutsSettings';
import { SidebarSettings } from './sections/SidebarSettings';
import { SnippetsSettings } from './sections/SnippetsSettings';
import { ToolsSettings } from './sections/ToolsSettings';

const PAGES: Record<SectionId, ComponentType> = {
  general: GeneralSettings,
  appearance: AppearanceSettings,
  sidebar: SidebarSettings,
  shortcuts: ShortcutsSettings,
  snippets: SnippetsSettings,
  providers: ProvidersSettings,
  mcp: McpSettings,
  models: ModelsSettings,
  tools: ToolsSettings,
  data: DataSettings,
  security: SecuritySettings,
  about: AboutSettings,
};

/** The whole settings area. The route loads this file on demand, so none of it is in the chat chunk. */
export function SettingsPage() {
  const { section } = useParams({ strict: false });
  if (!section || !isSection(section)) {
    return <Navigate to="/settings/$section" params={{ section: 'general' }} replace />;
  }
  const Page = PAGES[section];
  return (
    <SettingsLayout>
      <Page />
    </SettingsLayout>
  );
}

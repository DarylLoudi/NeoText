import { Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { useT } from '../../../lib/i18n';
import { Button } from '../../../ui';
import { LayoutControls, SectionList } from '../../sidebar/SidebarCustomizer';
import { AddSmartSectionDialog, ResetSidebarDialog } from '../../sidebar/SidebarDialogs';
import { Group, SectionHeader } from '../SettingsParts';
import styles from './SidebarSettings.module.css';

/** The same controls as "Customize sidebar" in the sidebar menu, laid out as a page. */
export function SidebarSettings() {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  return (
    <>
      <SectionHeader title={t('settings.sections.sidebar')} intro={t('settings.sidebar.intro')} />
      <Group title={t('sidebar.customizer.sections')}>
        <div className={styles.list}>
          <SectionList />
        </div>
        <Button size="sm" className={styles.add} onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          {t('sidebar.smart.title')}
        </Button>
      </Group>
      <Group title={t('sidebar.customizer.layout')}>
        <LayoutControls />
      </Group>
      <div className={styles.reset}>
        <Button onClick={() => setConfirmingReset(true)}>{t('settings.sidebar.reset')}</Button>
      </div>
      <AddSmartSectionDialog open={adding} onOpenChange={setAdding} />
      <ResetSidebarDialog open={confirmingReset} onOpenChange={setConfirmingReset} />
    </>
  );
}

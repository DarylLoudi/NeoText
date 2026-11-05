import { useQuery } from '@tanstack/react-query';
import { useT } from '../../../lib/i18n';
import { instanceQuery } from '../../../state/session';
import { Group, SectionHeader } from '../SettingsParts';
import styles from './AboutSettings.module.css';

export function AboutSettings() {
  const t = useT();
  const instance = useQuery(instanceQuery);
  return (
    <>
      <SectionHeader title={t('settings.sections.about')} intro={t('settings.about.intro')} />
      <Group title={t('settings.about.version')}>
        <p className={styles.fact}>{instance.data?.version ?? t('common.unknown')}</p>
      </Group>
      <Group title={t('settings.about.license')}>
        <p className={styles.fact}>{t('settings.about.licenseValue')}</p>
        <p className={styles.note}>{t('settings.about.licenseNote')}</p>
      </Group>
      <Group title={t('settings.about.where')}>
        <p className={styles.note}>{t('settings.about.whereBody')}</p>
      </Group>
    </>
  );
}

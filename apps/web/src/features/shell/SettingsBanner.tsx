import { WarningCircle, X } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useT } from '../../lib/i18n';
import { useSettings } from '../../state/settings';
import { IconButton } from '../../ui';
import styles from './SettingsBanner.module.css';

/** Shown when the server had to fall back to defaults for some saved settings. */
export function SettingsBanner() {
  const t = useT();
  const affected = useSettings((s) => s.recovered || s.resetPaths.length > 0);
  const [hidden, setHidden] = useState(false);
  if (!affected || hidden) return null;
  return (
    <div className={styles.banner} role="status">
      <WarningCircle className={styles.icon} aria-hidden />
      <p className={styles.text}>
        {t('shell.settingsRecovered')}{' '}
        <Link to="/settings/$section" params={{ section: 'data' }} className={styles.link}>
          {t('shell.openDataSettings')}
        </Link>
      </p>
      <IconButton
        size="sm"
        label={t('shell.dismissBanner')}
        icon={<X />}
        onClick={() => setHidden(true)}
      />
    </div>
  );
}

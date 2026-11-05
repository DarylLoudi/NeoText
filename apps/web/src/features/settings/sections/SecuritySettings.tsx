import { useState } from 'react';
import { useT } from '../../../lib/i18n';
import { useInstance } from '../../../state/session';
import { RecoveryKeyPanel } from '../../auth/RecoveryKeyPanel';
import { Group, SectionHeader } from '../SettingsParts';
import { ChangePasswordForm } from './ChangePasswordForm';
import { RotateRecoveryKey } from './RotateRecoveryKey';
import styles from './SecuritySettings.module.css';
import { SessionsPanel } from './SessionsPanel';

const SEALED = ['messages', 'folders', 'settings', 'files', 'keys'] as const;
const OPEN = ['times', 'costs', 'models', 'flags'] as const;

export function SecuritySettings() {
  const t = useT();
  const [newKey, setNewKey] = useState<string | null>(null);
  const escrow = useInstance().data?.escrow === true;

  // The new key is the whole page until it is saved: it is shown once.
  if (newKey) {
    return (
      <RecoveryKeyPanel
        recoveryKey={newKey}
        title={t('settings.security.newKeyTitle')}
        body={t('settings.security.newKeyBody')}
        onContinue={() => setNewKey(null)}
      />
    );
  }

  return (
    <>
      <SectionHeader title={t('settings.sections.security')} intro={t('settings.security.intro')} />
      <Group title={t('settings.security.password')}>
        {escrow ? <p className={styles.note}>{t('auth.escrowNote')}</p> : null}
        <ChangePasswordForm />
      </Group>
      <Group title={t('settings.security.recovery')} intro={t('settings.security.recoveryBody')}>
        <RotateRecoveryKey onKey={setNewKey} />
      </Group>
      <Group
        title={t('settings.security.sessions.title')}
        intro={t('settings.security.sessions.intro')}
      >
        <SessionsPanel />
      </Group>
      <Group title={t('settings.security.encrypted')} intro={t('settings.security.encryptedBody')}>
        <div className={styles.lists}>
          <div>
            <h3 className={styles.listTitle} id="sealed-title">
              {t('settings.security.sealedLabel')}
            </h3>
            <ul className={styles.list} aria-labelledby="sealed-title">
              {SEALED.map((k) => (
                <li key={k}>{t(`settings.security.sealed.${k}`)}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className={styles.listTitle} id="open-title">
              {t('settings.security.openLabel')}
            </h3>
            <ul className={styles.list} aria-labelledby="open-title">
              {OPEN.map((k) => (
                <li key={k}>{t(`settings.security.open.${k}`)}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className={styles.honest}>{t('settings.security.providerNote')}</p>
        <p className={styles.note}>{t('settings.security.operatorNote')}</p>
      </Group>
    </>
  );
}

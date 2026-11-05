import type { SettingsHistoryItem } from '@neotext/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../../lib/api/client';
import { settingsApi } from '../../../lib/api/settings';
import { getLocale, useT } from '../../../lib/i18n';
import { qk } from '../../../lib/query';
import { restoreSettingsVersion, useSettings } from '../../../state/settings';
import { Button, Dialog, Spinner, toast } from '../../../ui';
import { Group, SectionHeader } from '../SettingsParts';
import styles from './DataSettings.module.css';
import { ExportPanel } from './ExportPanel';
import { ImportPanel } from './ImportPanel';
import { TrashPanel } from './TrashPanel';

function formatSaved(ts: number): string {
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(ts),
  );
}

function History() {
  const t = useT();
  const queryClient = useQueryClient();
  const history = useQuery({ queryKey: qk.settingsHistory, queryFn: settingsApi.history });
  const [picked, setPicked] = useState<SettingsHistoryItem | null>(null);
  const [busy, setBusy] = useState(false);

  async function restore(item: SettingsHistoryItem) {
    setBusy(true);
    try {
      await restoreSettingsVersion(item.version);
      toast({ message: t('settings.data.restored'), tone: 'success' });
    } catch (err) {
      toast({
        message: err instanceof ApiError ? err.message : t('common.genericError'),
        tone: 'danger',
      });
    } finally {
      setBusy(false);
      setPicked(null);
      // Restoring keeps the settings it replaced as a new entry.
      void queryClient.invalidateQueries({ queryKey: qk.settingsHistory });
    }
  }

  if (history.isPending) return <Spinner />;
  if (history.isError) {
    return (
      <div className={styles.failed}>
        <p>{t('settings.data.historyFailed')}</p>
        <Button size="sm" onClick={() => void history.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }
  if (history.data.length === 0) {
    return <p className={styles.empty}>{t('settings.data.historyEmpty')}</p>;
  }
  return (
    <>
      <ul className={styles.list}>
        {history.data.map((item) => (
          <li key={item.version} className={styles.row}>
            <div className={styles.text}>
              <span className={styles.when}>
                {t('settings.data.savedAt', { time: formatSaved(item.createdAt) })}
              </span>
              <span className={styles.reason}>{t(`settings.data.reasons.${item.reason}`)}</span>
            </div>
            <Button size="sm" onClick={() => setPicked(item)}>
              {t('settings.data.restore')}
            </Button>
          </li>
        ))}
      </ul>
      <Dialog
        open={picked !== null}
        onOpenChange={(open) => !open && !busy && setPicked(null)}
        size="sm"
        title={t('settings.data.restoreTitle')}
        description={t('settings.data.restoreBody')}
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setPicked(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => picked && void restore(picked)}>
              {t('settings.data.restore')}
            </Button>
          </>
        }
      >
        {picked ? (
          <p className={styles.picked}>
            {t('settings.data.savedAt', { time: formatSaved(picked.createdAt) })}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}

export function DataSettings() {
  const t = useT();
  const recovered = useSettings((s) => s.recovered);
  return (
    <>
      <SectionHeader title={t('settings.sections.data')} intro={t('settings.data.intro')} />
      {recovered ? (
        <p className={styles.recovered} role="status">
          {t('settings.data.recovered')}
        </p>
      ) : null}
      <Group title={t('settings.data.history')} intro={t('settings.data.historyIntro')}>
        <History />
      </Group>
      <Group title={t('settings.data.trash.title')} intro={t('settings.data.trash.intro')}>
        <TrashPanel />
      </Group>
      <Group title={t('settings.data.backups')}>
        <p className={styles.body}>{t('settings.data.backupsBody')}</p>
      </Group>
      <Group title={t('settings.data.export.title')} intro={t('settings.data.export.intro')}>
        <ExportPanel />
      </Group>
      <Group title={t('settings.data.import.title')} intro={t('settings.data.import.intro')}>
        <ImportPanel />
      </Group>
    </>
  );
}

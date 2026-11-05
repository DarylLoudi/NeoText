import { Link, useParams } from '@tanstack/react-router';
import { type ReactNode, useEffect, useRef } from 'react';
import { useT } from '../../lib/i18n';
import { useSettings } from '../../state/settings';
import { Button } from '../../ui';
import styles from './SettingsLayout.module.css';
import { SECTIONS } from './section-ids';
import { useRejectedChanges } from './use-rejected-changes';

/** What the server did not accept, as a list with a way to send each change again. */
function RejectedList() {
  const t = useT();
  const { items, retry, dismiss } = useRejectedChanges();
  if (items.length === 0) return null;
  return (
    <section className={styles.rejected} aria-labelledby="rejected-title">
      <h2 id="rejected-title" className={styles.rejectedTitle}>
        {t('settings.notices.rejectedTitle')}
      </h2>
      <p className={styles.rejectedBody}>{t('settings.notices.rejectedBody')}</p>
      <ul className={styles.rejectedList}>
        {items.map((item) => (
          <li key={`${item.at}:${JSON.stringify(item.patch)}`} className={styles.rejectedItem}>
            <p className={styles.rejectedMessage}>{item.message}</p>
            <div className={styles.rejectedActions}>
              <Button size="sm" onClick={() => retry(item)}>
                {t('common.retry')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => dismiss(item)}>
                {t('settings.notices.dismiss')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SettingsLayout({ children }: { children: ReactNode }) {
  const t = useT();
  const durable = useSettings((s) => s.durable);
  const navRef = useRef<HTMLElement>(null);
  const current = useParams({ strict: false }).section;
  // In the phone strip the current link may sit past the edge: bring it into view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the section changes
  useEffect(() => {
    navRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [current]);
  return (
    <div className={styles.page}>
      <nav ref={navRef} className={styles.nav} aria-label={t('settings.navLabel')}>
        <ul className={styles.navList}>
          {SECTIONS.map((id) => (
            <li key={id}>
              <Link
                to="/settings/$section"
                params={{ section: id }}
                className={styles.link}
                activeOptions={{ exact: true }}
              >
                {t(`settings.sections.${id}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className={styles.content}>
        <div className={styles.column}>
          {durable ? null : (
            <p className={styles.notice} role="status">
              {t('settings.notices.notDurable')}
            </p>
          )}
          <RejectedList />
          {children}
        </div>
      </main>
    </div>
  );
}

import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useT } from '../../lib/i18n';
import styles from './AdminLayout.module.css';

export const ADMIN_SECTIONS = ['users', 'invites', 'instance', 'audit'] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export const isAdminSection = (value: string): value is AdminSection =>
  (ADMIN_SECTIONS as readonly string[]).includes(value);

/** Section links beside the page, like Settings. */
export function AdminLayout({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <div className={styles.page}>
      <nav className={styles.nav} aria-label={t('admin.navLabel')}>
        <p className={styles.heading}>{t('admin.title')}</p>
        <ul className={styles.navList}>
          {ADMIN_SECTIONS.map((id) => (
            <li key={id}>
              <Link
                to="/admin/$section"
                params={{ section: id }}
                className={styles.link}
                activeOptions={{ exact: true }}
              >
                {t(`admin.sections.${id}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className={styles.content}>{children}</main>
    </div>
  );
}

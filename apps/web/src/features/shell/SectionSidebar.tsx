import { ArrowLeft } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { useT } from '../../lib/i18n';
import { ADMIN_SECTIONS } from '../admin/AdminLayout';
import { SECTIONS } from '../settings/section-ids';
import styles from './SectionSidebar.module.css';

export type SectionArea = 'settings' | 'admin';

/** Which page area owns the sidebar, if any: settings and admin show their sections there. */
export function sectionArea(pathname: string): SectionArea | null {
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/admin')) return 'admin';
  return null;
}

/**
 * The sidebar while in Settings or Admin: a way back to the chats, then the area's sections,
 * so the page does not carry a second list of links beside the first.
 */
export function SectionSidebar({ area }: { area: SectionArea }) {
  const t = useT();
  return (
    <nav
      className={styles.sidebar}
      aria-label={area === 'settings' ? t('settings.title') : t('admin.title')}
    >
      <Link to="/" className={styles.back}>
        <ArrowLeft aria-hidden className={styles.backIcon} />
        {t('shell.backToChats')}
      </Link>
      <p className={styles.heading}>
        {area === 'settings' ? t('settings.title') : t('admin.title')}
      </p>
      <ul className={styles.list}>
        {area === 'settings'
          ? SECTIONS.map((id) => (
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
            ))
          : ADMIN_SECTIONS.map((id) => (
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
  );
}

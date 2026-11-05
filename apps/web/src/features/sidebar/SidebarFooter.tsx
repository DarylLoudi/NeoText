import { GearSix, ShieldCheck, Sidebar as SidebarIcon, SignOut } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useT } from '../../lib/i18n';
import { useSession, useSignOut } from '../../state/session';
import { Menu, type MenuItem, toast } from '../../ui';
import styles from './SidebarFooter.module.css';
import { errorMessage } from './use-conversations';

export interface SidebarFooterProps {
  /** Opens sidebar customization; the item is unavailable until it is wired. */
  onCustomize?: () => void;
}

export function SidebarFooter({ onCustomize }: SidebarFooterProps) {
  const t = useT();
  const endSession = useSignOut();
  const navigate = useNavigate();
  const user = useSession().data;
  if (!user) return null;
  const name = user.displayName || user.username;

  const signOut = async () => {
    try {
      await endSession.mutateAsync();
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'danger' });
      return;
    }
    await navigate({ to: '/login' });
  };

  // Only admins see the way in; the admin routes refuse everyone else anyway.
  const admin: MenuItem[] =
    user.role === 'admin'
      ? [
          {
            label: t('sidebar.admin'),
            icon: <ShieldCheck />,
            onSelect: () => void navigate({ to: '/admin/$section', params: { section: 'users' } }),
          },
        ]
      : [];

  return (
    <footer className={styles.footer}>
      <Menu
        side="top"
        align="start"
        items={[
          {
            label: t('sidebar.settings'),
            icon: <GearSix />,
            onSelect: () =>
              void navigate({ to: '/settings/$section', params: { section: 'general' } }),
          },
          ...admin,
          {
            label: t('sidebar.customize'),
            icon: <SidebarIcon />,
            disabled: !onCustomize,
            onSelect: () => onCustomize?.(),
          },
          { separator: true },
          { label: t('auth.signOut'), icon: <SignOut />, onSelect: () => void signOut() },
        ]}
        trigger={
          <button
            type="button"
            className={styles.account}
            aria-label={t('sidebar.account', { name })}
          >
            <span className={styles.name} dir="auto">
              {name}
            </span>
            <GearSix className={styles.icon} aria-hidden />
          </button>
        }
      />
    </footer>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi } from '../../../lib/api/auth';
import { errorText } from '../../../lib/api/error-text';
import { getLocale, useT } from '../../../lib/i18n';
import { qk } from '../../../lib/query';
import { Button, Spinner, toast } from '../../../ui';
import { describeUserAgent } from './describe-user-agent';
import styles from './SessionsPanel.module.css';

function formatSeen(ts: number): string {
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(ts),
  );
}

/** The devices signed in to this account, and a way to sign out any of them. */
export function SessionsPanel() {
  const t = useT();
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: qk.sessions, queryFn: authApi.sessions });
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.sessions });
  const onError = (err: unknown) =>
    toast({ message: errorText(err, t('common.genericError')), tone: 'danger' });
  const revoke = useMutation({
    mutationFn: (id: string) => authApi.revokeSession(id),
    onSuccess: () => {
      toast({ message: t('settings.security.sessions.signedOut') });
      void refresh();
    },
    onError,
  });
  const revokeOthers = useMutation({
    mutationFn: () => authApi.revokeOtherSessions(),
    onSuccess: () => {
      toast({ message: t('settings.security.sessions.signedOutOthers') });
      void refresh();
    },
    onError,
  });

  if (sessions.isPending) return <Spinner label={t('common.loading')} />;
  if (sessions.isError) {
    return (
      <p role="alert" className={styles.error}>
        {t('settings.security.sessions.loadFailed')}
      </p>
    );
  }
  const hasOthers = sessions.data.some((s) => !s.current);

  return (
    <>
      <ul className={styles.list}>
        {sessions.data.map((s) => {
          const device = describeUserAgent(s.userAgent);
          return (
            <li key={s.id} className={styles.row}>
              <span className={styles.text}>
                <span className={styles.device}>{device}</span>
                <span className={styles.meta}>
                  {s.current ? (
                    <span className={styles.here}>
                      {t('settings.security.sessions.thisDevice')}
                    </span>
                  ) : null}
                  <span>
                    {t('settings.security.sessions.lastActive', { when: formatSeen(s.lastSeenAt) })}
                  </span>
                </span>
              </span>
              {s.current ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('settings.security.sessions.signOutLabel', { device })}
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(s.id)}
                >
                  {t('settings.security.sessions.signOut')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <div>
        <Button
          disabled={!hasOthers}
          loading={revokeOthers.isPending}
          onClick={() => revokeOthers.mutate()}
        >
          {t('settings.security.sessions.signOutOthers')}
        </Button>
      </div>
    </>
  );
}

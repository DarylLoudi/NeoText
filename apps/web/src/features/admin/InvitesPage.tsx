import type { CreateInviteBody, InvitePublic } from '@neotext/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { adminApi } from '../../lib/api/admin';
import { errorText } from '../../lib/api/error-text';
import { getLocale, useT } from '../../lib/i18n';
import { qk } from '../../lib/query';
import { Button, Spinner, toast } from '../../ui';
import { Select } from '../../ui/Select/Select';
import { Group, SectionHeader } from '../settings/SettingsParts';
import styles from './AdminPages.module.css';
import { OnceSecret } from './OnceSecret';

const EXPIRY_DAYS = [1, 7, 14, 30, 90] as const;

function formatDate(ts: number): string {
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(new Date(ts));
}

/** Create an invite (its code is shown once), see who used each, revoke unused ones. */
export function InvitesPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const invites = useQuery({ queryKey: qk.adminInvites, queryFn: adminApi.invites });
  const [role, setRole] = useState<CreateInviteBody['role']>('member');
  const [days, setDays] = useState(14);
  const [code, setCode] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.adminInvites });
  const onError = (err: unknown) =>
    toast({ message: errorText(err, t('common.genericError')), tone: 'danger' });
  const create = useMutation({
    mutationFn: () => adminApi.createInvite({ role, expiresInDays: days }),
    onSuccess: (res) => {
      setCode(res.code);
      void refresh();
    },
    onError,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => adminApi.revokeInvite(id),
    onSuccess: () => {
      toast({ message: t('admin.invites.revoked') });
      void refresh();
    },
    onError,
  });

  const statusOf = (invite: InvitePublic, now: number) => {
    if (invite.usedAt !== null) {
      const name = invite.usedByUsername ?? t('admin.invites.removedUser');
      return t('admin.invites.statuses.used', { name });
    }
    return invite.expiresAt <= now
      ? t('admin.invites.statuses.expired')
      : t('admin.invites.statuses.open');
  };

  let list: ReactNode;
  if (invites.isPending) {
    list = <Spinner label={t('common.loading')} />;
  } else if (invites.isError) {
    list = (
      <p role="alert" className={styles.error}>
        {t('admin.invites.loadFailed')}
      </p>
    );
  } else if (invites.data.length === 0) {
    list = <p className={styles.muted}>{t('admin.invites.empty')}</p>;
  } else {
    const now = Date.now();
    list = (
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t('admin.invites.created')}</th>
              <th scope="col">{t('admin.invites.role')}</th>
              <th scope="col">{t('admin.invites.status')}</th>
              <th scope="col">{t('admin.invites.expires')}</th>
              <th scope="col">
                <span className={styles.srOnly}>{t('admin.invites.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invites.data.map((invite) => (
              <tr key={invite.id}>
                <td>{formatDate(invite.createdAt)}</td>
                <td>{t(`admin.roles.${invite.role}`)}</td>
                <td dir="auto">{statusOf(invite, now)}</td>
                <td>{formatDate(invite.expiresAt)}</td>
                <td>
                  {invite.usedAt === null ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('admin.invites.revokeLabel', {
                        role: t(`admin.roles.${invite.role}`),
                        date: formatDate(invite.createdAt),
                      })}
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(invite.id)}
                    >
                      {t('admin.invites.revoke')}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      <SectionHeader title={t('admin.sections.invites')} intro={t('admin.invites.intro')} />
      <Group title={t('admin.invites.create')}>
        <div className={styles.form}>
          <Select
            label={t('admin.invites.role')}
            value={role}
            onChange={(v) => setRole(v as CreateInviteBody['role'])}
            options={(['member', 'admin'] as const).map((r) => ({
              value: r,
              label: t(`admin.roles.${r}`),
            }))}
          />
          <Select
            label={t('admin.invites.expiry')}
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
            options={EXPIRY_DAYS.map((d) => ({
              value: String(d),
              label: t('admin.invites.days', { count: d }),
            }))}
          />
          <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
            {t('admin.invites.create')}
          </Button>
        </div>
        {code ? (
          <div className={styles.shown}>
            <p>{t('admin.invites.codeBody')}</p>
            <OnceSecret label={t('admin.invites.codeTitle')} value={code} />
            <div>
              <Button onClick={() => setCode(null)}>{t('admin.invites.done')}</Button>
            </div>
          </div>
        ) : null}
      </Group>
      <Group title={t('admin.sections.invites')}>{list}</Group>
    </>
  );
}

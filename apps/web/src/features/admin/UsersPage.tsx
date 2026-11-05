import type { AdminUser, Quota, UpdateAdminUserBody } from '@neotext/shared';
import { DotsThree } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { adminApi } from '../../lib/api/admin';
import { ApiError } from '../../lib/api/client';
import { errorText } from '../../lib/api/error-text';
import { quotasApi } from '../../lib/api/quotas';
import { formatCost } from '../../lib/format';
import { getLocale, useT } from '../../lib/i18n';
import { qk } from '../../lib/query';
import { useInstance, useSession } from '../../state/session';
import { Button, Dialog, IconButton, Menu, Spinner, toast } from '../../ui';
import { SectionHeader } from '../settings/SettingsParts';
import styles from './AdminPages.module.css';
import { OnceSecret } from './OnceSecret';
import { QuotaEditor } from './QuotaEditor';

const reasonOf = (err: unknown): unknown =>
  err instanceof ApiError ? (err.details as { reason?: unknown } | undefined)?.reason : undefined;

function formatSeen(ts: number): string {
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(ts),
  );
}

const nameOf = (u: AdminUser) => u.displayName || u.username;

/**
 * Confirms a reset, then shows the temporary password once. Closing drops it from memory; the
 * server kept no copy either.
 */
function ResetDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const t = useT();
  const escrow = useInstance().data?.escrow === true;
  const [password, setPassword] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const reset = useMutation({
    mutationFn: (id: string) => adminApi.resetPassword(id),
    // With `reset()` on close, the mutation and the password in it leave the cache at once.
    gcTime: 0,
    onSuccess: setPassword,
    onError: (err) => {
      if (reasonOf(err) === 'no_escrow') setRefused(true);
      else toast({ message: errorText(err, t('common.genericError')), tone: 'danger' });
    },
  });
  const close = () => {
    if (reset.isPending) return;
    setPassword(null);
    setRefused(false);
    // The mutation keeps its last result; drop it so the password lives nowhere after this.
    reset.reset();
    onClose();
  };
  if (!user) return null;
  const name = nameOf(user);
  const canReset = escrow && !refused;

  if (password) {
    return (
      <Dialog
        open
        onOpenChange={(open) => !open && close()}
        size="sm"
        title={t('admin.users.reset.doneTitle', { name })}
        footer={
          <Button variant="primary" onClick={close}>
            {t('admin.users.reset.done')}
          </Button>
        }
      >
        <div className={styles.dialogBody}>
          <p>{t('admin.users.reset.doneBody', { name })}</p>
          <OnceSecret label={t('admin.users.reset.label')} value={password} />
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      size="sm"
      title={t('admin.users.reset.title', { name })}
      footer={
        <div className={styles.actions}>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          {canReset ? (
            <Button
              variant="danger"
              loading={reset.isPending}
              onClick={() => reset.mutate(user.id)}
            >
              {t('admin.users.reset.confirm')}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className={styles.dialogBody}>
        <p>
          {!escrow
            ? t('admin.users.reset.noEscrow', { name })
            : refused
              ? t('admin.users.reset.notSignedInYet', { name })
              : t('admin.users.reset.body', { name })}
        </p>
      </div>
    </Dialog>
  );
}

/**
 * One member's limit on shared models. Each change saves as the box is left; "use the default"
 * removes their own limit so the instance default applies.
 */
function QuotaDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const id = user?.id ?? '';
  const current = useQuery({
    queryKey: qk.adminQuota(id),
    queryFn: () => quotasApi.get(id),
    enabled: user !== null,
  });
  const save = useMutation({
    mutationFn: (quota: Quota | null) => quotasApi.put(id, quota),
    onSuccess: (next) => {
      queryClient.setQueryData(qk.adminQuota(id), next);
      toast({ message: t('admin.quota.saved') });
    },
    onError: (err) => toast({ message: errorText(err, t('common.genericError')), tone: 'danger' }),
  });
  if (!user) return null;
  const name = nameOf(user);
  const data = current.data;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="sm"
      title={t('admin.quota.title', { name })}
      footer={
        <div className={styles.actions}>
          {data?.quota ? (
            <Button variant="ghost" loading={save.isPending} onClick={() => save.mutate(null)}>
              {t('admin.quota.useDefault')}
            </Button>
          ) : null}
          <Button variant="primary" onClick={onClose}>
            {t('admin.quota.done')}
          </Button>
        </div>
      }
    >
      <div className={styles.dialogBody}>
        <p>{t('admin.quota.intro', { name })}</p>
        {current.isError ? (
          <p role="alert" className={styles.error}>
            {t('admin.quota.loadFailed')}
          </p>
        ) : data ? (
          <>
            <QuotaEditor value={data.effective} onChange={(q) => save.mutate(q)} />
            {data.quota === null ? (
              <p className={styles.muted}>{t('admin.quota.following')}</p>
            ) : null}
          </>
        ) : (
          <Spinner label={t('common.loading')} />
        )}
      </div>
    </Dialog>
  );
}

export function UsersPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const me = useSession().data;
  const users = useQuery({ queryKey: qk.adminUsers, queryFn: adminApi.users });
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [budgeting, setBudgeting] = useState<AdminUser | null>(null);
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAdminUserBody }) =>
      adminApi.updateUser(id, body),
    onSuccess: (updated) => {
      queryClient.setQueryData<AdminUser[]>(qk.adminUsers, (list) =>
        list?.map((u) => (u.id === updated.id ? updated : u)),
      );
      void queryClient.invalidateQueries({ queryKey: qk.adminUsers });
      // A change to their own account (stepping down to member) must reach the rest of the app.
      if (updated.id === me?.id) void queryClient.invalidateQueries({ queryKey: qk.session });
    },
    onError: (err) => {
      const message =
        reasonOf(err) === 'last_admin'
          ? t('admin.errors.last_admin')
          : errorText(err, t('common.genericError'));
      toast({ message, tone: 'danger' });
    },
  });

  let body: ReactNode;
  if (users.isPending) {
    body = <Spinner label={t('common.loading')} />;
  } else if (users.isError) {
    body = (
      <p role="alert" className={styles.error}>
        {t('admin.users.loadFailed')}
      </p>
    );
  } else {
    body = (
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t('admin.users.name')}</th>
              <th scope="col">{t('admin.users.role')}</th>
              <th scope="col">{t('admin.users.status')}</th>
              <th scope="col">{t('admin.users.lastSeen')}</th>
              <th scope="col" className={styles.number}>
                {t('admin.users.monthCost')}
              </th>
              <th scope="col">
                <span className={styles.srOnly}>{t('admin.users.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.data.map((u) => {
              const name = nameOf(u);
              const change = (patch: UpdateAdminUserBody) =>
                update.mutate({ id: u.id, body: patch });
              return (
                <tr key={u.id}>
                  <th scope="row">
                    <span className={styles.name}>
                      <span className={styles.displayName} dir="auto">
                        {name}
                        {u.id === me?.id ? ` (${t('admin.users.you')})` : ''}
                      </span>
                      <span className={styles.username}>@{u.username}</span>
                    </span>
                  </th>
                  <td>{t(`admin.roles.${u.role}`)}</td>
                  <td className={u.status === 'disabled' ? styles.disabled : undefined}>
                    {t(`admin.users.statuses.${u.status}`)}
                  </td>
                  <td className={u.lastSeenAt === null ? styles.muted : undefined}>
                    {u.lastSeenAt === null ? t('admin.users.never') : formatSeen(u.lastSeenAt)}
                  </td>
                  <td className={styles.number}>{formatCost(u.monthCostUsd)}</td>
                  <td>
                    <Menu
                      align="end"
                      items={[
                        u.role === 'admin'
                          ? {
                              label: t('admin.users.makeMember'),
                              onSelect: () => change({ role: 'member' }),
                            }
                          : {
                              label: t('admin.users.makeAdmin'),
                              onSelect: () => change({ role: 'admin' }),
                            },
                        u.status === 'active'
                          ? {
                              label: t('admin.users.disable'),
                              danger: true,
                              onSelect: () => change({ status: 'disabled' }),
                            }
                          : {
                              label: t('admin.users.enable'),
                              onSelect: () => change({ status: 'active' }),
                            },
                        { separator: true },
                        {
                          label: t('admin.users.sharedBudget'),
                          onSelect: () => setBudgeting(u),
                        },
                        {
                          label: t('admin.users.resetPassword'),
                          onSelect: () => setResetting(u),
                        },
                      ]}
                      trigger={
                        <IconButton
                          size="sm"
                          label={t('admin.users.options', { name })}
                          icon={<DotsThree />}
                        />
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      <SectionHeader title={t('admin.sections.users')} intro={t('admin.users.intro')} />
      {body}
      <p className={styles.note}>{t('admin.users.note')}</p>
      <ResetDialog user={resetting} onClose={() => setResetting(null)} />
      <QuotaDialog user={budgeting} onClose={() => setBudgeting(null)} />
    </>
  );
}

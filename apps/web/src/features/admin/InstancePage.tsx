import type { AdminInstance, UpdateAdminInstanceBody } from '@neotext/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../../lib/api/admin';
import { ApiError } from '../../lib/api/client';
import { errorText } from '../../lib/api/error-text';
import { useT } from '../../lib/i18n';
import { qk } from '../../lib/query';
import { Select, Spinner, Switch, toast } from '../../ui';
import { Group, SectionHeader } from '../settings/SettingsParts';
import styles from './AdminPages.module.css';
import { QuotaEditor } from './QuotaEditor';

const MODES = ['personal', 'community'] as const;
const REGISTRATIONS = ['closed', 'invite', 'open'] as const;

/** Mode, sign-ups and password escrow. Each control saves as soon as it changes. */
export function InstancePage() {
  const t = useT();
  const queryClient = useQueryClient();
  const instance = useQuery({ queryKey: qk.adminInstance, queryFn: adminApi.instance });
  const save = useMutation({
    mutationFn: (body: UpdateAdminInstanceBody) => adminApi.updateInstance(body),
    onSuccess: (next) => {
      queryClient.setQueryData<AdminInstance>(qk.adminInstance, next);
      // Sign-up and Security read the public instance info.
      void queryClient.invalidateQueries({ queryKey: qk.instance });
      toast({ message: t('admin.instance.saved') });
    },
    onError: (err) => {
      const personal =
        err instanceof ApiError &&
        (err.details as { reason?: unknown } | undefined)?.reason === 'personal_signups';
      const message = personal
        ? t('admin.instance.personalNoSignUps')
        : errorText(err, t('common.genericError'));
      toast({ message, tone: 'danger' });
    },
  });

  const header = (
    <SectionHeader title={t('admin.sections.instance')} intro={t('admin.instance.intro')} />
  );
  if (instance.isPending) {
    return (
      <>
        {header}
        <Spinner label={t('common.loading')} />
      </>
    );
  }
  if (instance.isError) {
    return (
      <>
        {header}
        <p role="alert" className={styles.error}>
          {t('admin.instance.loadFailed')}
        </p>
      </>
    );
  }
  const value = instance.data;
  // Personal means just the owner: the server keeps sign-ups closed with it.
  const personal = value.mode === 'personal';
  return (
    <>
      {header}
      <Group title={t('admin.instance.mode')}>
        <Select
          aria-label={t('admin.instance.mode')}
          value={value.mode}
          disabled={save.isPending}
          onChange={(mode) => save.mutate({ mode: mode as AdminInstance['mode'] })}
          options={MODES.map((m) => ({
            value: m,
            label: t(`admin.instance.modes.${m}`),
            hint: t(`admin.instance.modes.${m}Hint`),
          }))}
        />
      </Group>
      <Group
        title={t('admin.instance.registration')}
        intro={personal ? t('admin.instance.personalNoSignUps') : undefined}
      >
        <Select
          aria-label={t('admin.instance.registration')}
          value={value.registration}
          disabled={save.isPending || personal}
          onChange={(registration) =>
            save.mutate({ registration: registration as AdminInstance['registration'] })
          }
          options={REGISTRATIONS.map((r) => ({
            value: r,
            label: t(`admin.instance.registrations.${r}`),
            hint: t(`admin.instance.registrations.${r}Hint`),
          }))}
        />
      </Group>
      <Group title={t('admin.instance.escrow')} intro={t('admin.instance.escrowLater')}>
        <Switch
          label={t('admin.instance.escrow')}
          hint={t('admin.instance.escrowHint')}
          checked={value.escrow}
          disabled={save.isPending}
          onChange={(escrow) => save.mutate({ escrow })}
        />
      </Group>
      <Group title={t('admin.quota.defaultTitle')} intro={t('admin.quota.defaultIntro')}>
        <QuotaEditor
          value={value.defaultQuota ?? { dailyUsd: null, monthlyUsd: null }}
          onChange={(defaultQuota) => save.mutate({ defaultQuota })}
        />
      </Group>
    </>
  );
}

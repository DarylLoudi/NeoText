import type { AdminUser } from '@neotext/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { adminApi } from '../../lib/api/admin';
import { auditApi } from '../../lib/api/audit';
import { getLocale, useT } from '../../lib/i18n';
import { qk } from '../../lib/query';
import { Button, Select, Spinner } from '../../ui';
import { Group, SectionHeader } from '../settings/SettingsParts';
import styles from './AdminPages.module.css';
import { auditLabel } from './audit-labels';

const EVERYONE = '*';

function formatWhen(ts: number): string {
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(ts),
  );
}

const nameOf = (u: AdminUser) => u.displayName || u.username;

/** Recorded events from every account, newest first, as plain sentences. Never chats or keys. */
export function AuditPage() {
  const t = useT();
  const [person, setPerson] = useState(EVERYONE);
  const userId = person === EVERYONE ? null : person;
  const users = useQuery({ queryKey: qk.adminUsers, queryFn: adminApi.users });
  const events = useInfiniteQuery({
    queryKey: qk.adminAudit(userId),
    queryFn: ({ pageParam }) => auditApi.list({ all: userId ? { userId } : {}, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const names = new Map((users.data ?? []).map((u) => [u.id, nameOf(u)]));
  const rows = events.data?.pages.flatMap((p) => p.items) ?? [];

  let body: ReactNode;
  if (events.isPending) {
    body = <Spinner label={t('common.loading')} />;
  } else if (events.isError) {
    body = (
      <p role="alert" className={styles.error}>
        {t('admin.audit.loadFailed')}
      </p>
    );
  } else if (rows.length === 0) {
    body = <p className={styles.muted}>{t('admin.audit.empty')}</p>;
  } else {
    body = (
      <>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('admin.audit.when')}</th>
                <th scope="col">{t('admin.audit.who')}</th>
                <th scope="col">{t('admin.audit.what')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>{formatWhen(e.createdAt)}</td>
                  <td dir="auto">
                    {(e.userId && names.get(e.userId)) || t('admin.audit.removedAccount')}
                  </td>
                  <td>{auditLabel(e.kind)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {events.hasNextPage ? (
          <div>
            <Button loading={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>
              {t('admin.audit.loadMore')}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <SectionHeader title={t('admin.sections.audit')} intro={t('admin.audit.intro')} />
      <Group title={t('admin.sections.audit')}>
        <div className={styles.form}>
          <Select
            label={t('admin.audit.person')}
            value={person}
            onChange={setPerson}
            options={[
              { value: EVERYONE, label: t('admin.audit.everyone') },
              ...(users.data ?? []).map((u) => ({ value: u.id, label: nameOf(u) })),
            ]}
          />
        </div>
        {body}
      </Group>
    </>
  );
}

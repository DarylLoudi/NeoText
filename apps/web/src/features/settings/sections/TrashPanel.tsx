import type { ConversationSummary } from '@neotext/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../../lib/api/client';
import { conversationsApi } from '../../../lib/api/conversations';
import { getLocale, useT } from '../../../lib/i18n';
import { qk } from '../../../lib/query';
import { Button, Dialog, Spinner, toast } from '../../../ui';
import { forgetPreviewStorage } from '../../project/preview-storage';
import styles from './TrashPanel.module.css';

const DAY_MS = 86_400_000;
const RETENTION_DAYS = 30;
// The most the server lists at once; a longer trash shows its newest page.
const TRASH_QUERY = { scope: 'trash', limit: 100 } as const;

function formatDeleted(ts: number): string {
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(new Date(ts));
}

function daysLeft(deletedAt: number, now: number): number {
  return Math.max(0, Math.ceil(RETENTION_DAYS - (now - deletedAt) / DAY_MS));
}

type Pending = { kind: 'one'; item: ConversationSummary } | { kind: 'all' } | null;

export function TrashPanel({ now = Date.now }: { now?: () => number }) {
  const t = useT();
  const queryClient = useQueryClient();
  const trash = useQuery({
    queryKey: qk.conversations(TRASH_QUERY),
    queryFn: () => conversationsApi.list(TRASH_QUERY),
  });
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      toast({ message: done, tone: 'success' });
    } catch (err) {
      toast({
        message: err instanceof ApiError ? err.message : t('common.genericError'),
        tone: 'danger',
      });
    } finally {
      setBusy(false);
      setPending(null);
      // The sidebar lists share this prefix, so a restored chat reappears there.
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    }
  }

  if (trash.isPending) return <Spinner />;
  if (trash.isError) {
    return (
      <div className={styles.failed}>
        <p>{t('settings.data.trash.failed')}</p>
        <Button size="sm" onClick={() => void trash.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }
  const items = trash.data.items;
  if (items.length === 0) return <p className={styles.empty}>{t('settings.data.trash.empty')}</p>;

  return (
    <>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.id} className={styles.row}>
            <div className={styles.text}>
              <span className={styles.title}>{item.title ?? t('sidebar.newChat')}</span>
              <span className={styles.meta}>
                {t('settings.data.trash.deletedOn', { date: formatDeleted(item.deletedAt ?? 0) })}
                {' · '}
                {t('settings.data.trash.daysLeft', { count: daysLeft(item.deletedAt ?? 0, now()) })}
              </span>
            </div>
            <div className={styles.actions}>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => conversationsApi.restore(item.id),
                    t('settings.data.trash.restored'),
                  )
                }
              >
                {t('settings.data.trash.restore')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() => setPending({ kind: 'one', item })}
              >
                {t('settings.data.trash.deleteForever')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div className={styles.footer}>
        <Button
          size="sm"
          variant="danger"
          disabled={busy}
          onClick={() => setPending({ kind: 'all' })}
        >
          {t('settings.data.trash.emptyAction')}
        </Button>
      </div>
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => !open && !busy && setPending(null)}
        size="sm"
        title={
          pending?.kind === 'all'
            ? t('settings.data.trash.emptyTitle')
            : t('settings.data.trash.deleteTitle')
        }
        description={
          pending?.kind === 'all'
            ? trash.data.nextCursor
              ? t('settings.data.trash.emptyBodyMin', { count: items.length })
              : t('settings.data.trash.emptyBody', { count: items.length })
            : t('settings.data.trash.deleteBody')
        }
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setPending(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => {
                if (pending?.kind === 'all') {
                  void run(async () => {
                    const { ids } = await conversationsApi.emptyTrash();
                    await forgetPreviewStorage(ids);
                  }, t('settings.data.trash.emptied'));
                } else if (pending) {
                  const id = pending.item.id;
                  void run(async () => {
                    await conversationsApi.deleteForever(id);
                    await forgetPreviewStorage([id]);
                  }, t('settings.data.trash.deleted'));
                }
              }}
            >
              {pending?.kind === 'all'
                ? t('settings.data.trash.emptyAction')
                : t('settings.data.trash.deleteForever')}
            </Button>
          </>
        }
      >
        {pending?.kind === 'one' ? (
          <p className={styles.picked}>{pending.item.title ?? t('sidebar.newChat')}</p>
        ) : null}
      </Dialog>
    </>
  );
}

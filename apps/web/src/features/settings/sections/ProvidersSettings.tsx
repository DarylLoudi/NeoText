import type { ProviderCategory, ProviderPublic } from '@neotext/shared';
import { PencilSimple, Plus } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../../lib/api/client';
import { useT } from '../../../lib/i18n';
import { useSession } from '../../../state/session';
import { Button, Dialog, IconButton, Spinner, toast } from '../../../ui';
import { Group, SectionHeader } from '../SettingsParts';
import { presetsQuery, providersQuery, useProviderMutations } from '../use-providers';
import { ProviderForm } from './ProviderForm';
import styles from './ProvidersSettings.module.css';

type Editing =
  | { mode: 'add'; category: ProviderCategory }
  | { mode: 'edit'; provider: ProviderPublic }
  | null;

const TITLES = {
  llm: { add: 'settings.providers.add', edit: 'settings.providers.editTitle' },
  search: { add: 'settings.providers.addSearch', edit: 'settings.providers.editSearchTitle' },
} as const;

function Row({
  provider,
  isAdmin,
  onEdit,
}: {
  provider: ProviderPublic;
  isAdmin: boolean;
  onEdit: () => void;
}) {
  const t = useT();
  // Members use a shared provider but never see or change its settings.
  const locked = provider.shared && !isAdmin;
  const key = provider.shared
    ? t(isAdmin ? 'settings.providers.sharedWithAll' : 'settings.providers.sharedByAdmin')
    : provider.hasKey
      ? provider.keyHint
        ? t('settings.providers.keySaved', { hint: provider.keyHint })
        : t('settings.providers.keySavedNoHint')
      : t('settings.providers.noKey');
  return (
    <li className={styles.row}>
      <div className={styles.main}>
        <span className={styles.name} dir="auto">
          {provider.name}
        </span>
        <span className={styles.kind}>{t(`settings.providers.kind.${provider.kind}`)}</span>
        {locked ? null : <span className={styles.url}>{provider.baseUrl}</span>}
      </div>
      <div className={styles.facts}>
        <span className={styles.key} data-missing={provider.hasKey ? undefined : ''}>
          {key}
        </span>
        <span className={styles.status} data-on={provider.enabled ? '' : undefined}>
          {provider.enabled ? t('settings.providers.on') : t('settings.providers.off')}
        </span>
      </div>
      {locked ? null : (
        <IconButton
          label={t('settings.providers.edit', { name: provider.name })}
          icon={<PencilSimple />}
          onClick={onEdit}
        />
      )}
    </li>
  );
}

const LIST_TEXT = {
  llm: {
    empty: 'settings.providers.empty',
    list: 'settings.providers.list',
    add: 'settings.providers.add',
  },
  search: {
    empty: 'settings.providers.searchEmpty',
    list: 'settings.providers.searchList',
    add: 'settings.providers.addSearch',
  },
} as const;

/** The providers of one category, with a way to add another. */
function ProviderList({
  category,
  isAdmin,
  onAdd,
  onEdit,
}: {
  category: ProviderCategory;
  isAdmin: boolean;
  onAdd: () => void;
  onEdit: (provider: ProviderPublic) => void;
}) {
  const t = useT();
  const providers = useQuery(providersQuery);
  const text = LIST_TEXT[category];
  const mine = (providers.data ?? []).filter((p) => p.category === category);
  return (
    <div className={styles.body}>
      {providers.isPending ? (
        <Spinner />
      ) : providers.isError ? (
        <div className={styles.failed}>
          <p>{t('settings.providers.loadFailed')}</p>
          <Button size="sm" onClick={() => void providers.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : mine.length === 0 ? (
        <p className={styles.empty}>{t(text.empty)}</p>
      ) : (
        <ul className={styles.list} aria-label={t(text.list)}>
          {mine.map((p) => (
            <Row key={p.id} provider={p} isAdmin={isAdmin} onEdit={() => onEdit(p)} />
          ))}
        </ul>
      )}
      <Button className={styles.add} onClick={onAdd}>
        <Plus aria-hidden />
        {t(text.add)}
      </Button>
    </div>
  );
}

export function ProvidersSettings() {
  const t = useT();
  const presets = useQuery(presetsQuery);
  const isAdmin = useSession().data?.role === 'admin';
  const { remove } = useProviderMutations();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<ProviderPublic | null>(null);

  const close = () => setEditing(null);

  async function confirmDelete(provider: ProviderPublic) {
    try {
      await remove.mutateAsync(provider.id);
      toast({ message: t('settings.providers.deleted'), tone: 'success' });
      setDeleting(null);
      close();
    } catch (err) {
      toast({
        message: err instanceof ApiError ? err.message : t('common.genericError'),
        tone: 'danger',
      });
      // The editor stays open behind the confirmation so nothing the person typed is lost.
      setDeleting(null);
    }
  }

  return (
    <>
      <SectionHeader
        title={t('settings.sections.providers')}
        intro={t('settings.providers.intro')}
      />
      <Group title={t('settings.providers.modelTitle')}>
        <ProviderList
          category="llm"
          isAdmin={isAdmin}
          onAdd={() => setEditing({ mode: 'add', category: 'llm' })}
          onEdit={(provider) => setEditing({ mode: 'edit', provider })}
        />
      </Group>
      <Group
        title={t('settings.providers.searchTitle')}
        intro={t('settings.providers.searchIntro')}
      >
        <ProviderList
          category="search"
          isAdmin={isAdmin}
          onAdd={() => setEditing({ mode: 'add', category: 'search' })}
          onEdit={(provider) => setEditing({ mode: 'edit', provider })}
        />
      </Group>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && close()}
        size="md"
        title={t(
          editing?.mode === 'edit'
            ? TITLES[editing.provider.category].edit
            : TITLES[editing?.category ?? 'llm'].add,
        )}
      >
        {editing ? (
          <ProviderForm
            key={editing.mode === 'edit' ? editing.provider.id : `new-${editing.category}`}
            presets={presets.data ?? []}
            category={editing.mode === 'edit' ? editing.provider.category : editing.category}
            onDone={close}
            canShare={isAdmin}
            {...(editing.mode === 'edit'
              ? { provider: editing.provider, onDelete: () => setDeleting(editing.provider) }
              : {})}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        size="sm"
        title={t('settings.providers.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('settings.providers.deleteBody')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => deleting && void confirmDelete(deleting)}
            >
              {t('settings.providers.delete')}
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </>
  );
}

import type { ModelInfo } from '@neotext/shared';
import { Eye, EyeSlash, SlidersHorizontal, Star } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { memo, useDeferredValue, useMemo, useState } from 'react';
import { providersApi } from '../../../lib/api/providers';
import { formatContext } from '../../../lib/format';
import { useT } from '../../../lib/i18n';
import { qk } from '../../../lib/query';
import { getSettingsState, updateSettings, useSettings } from '../../../state/settings';
import { Button, IconButton, Spinner, TextField } from '../../../ui';
import { priceText } from '../../chat/composer/ModelRow';
import { searchModels } from '../../chat/composer/model-search';
import { keyOf } from '../../chat/composer/use-models';
import { Group, SectionHeader } from '../SettingsParts';
import { ModelOverrideDialog } from './ModelOverrideDialog';
import styles from './ModelsSettings.module.css';

/** Rows drawn per provider before "Show more", as in the model picker. */
const PAGE_SIZE = 40;

/** Replaces one list in settings. A merge patch swaps arrays whole, so the list is sent whole. */
function toggleIn(list: 'favorites' | 'hidden', key: string): void {
  const current = getSettingsState().settings.models[list];
  const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
  updateSettings({ models: { [list]: next } });
}

interface ModelRowProps {
  model: ModelInfo;
  favorite: boolean;
  hidden: boolean;
  changed: boolean;
  onEdit: (m: ModelInfo) => void;
}

const ModelRow = memo(function ModelRow({
  model,
  favorite,
  hidden,
  changed,
  onEdit,
}: ModelRowProps) {
  const t = useT();
  const key = keyOf(model);
  const price = priceText(model, t);
  const facts = [
    model.contextLength === null
      ? null
      : t('chat.models.context', { size: formatContext(model.contextLength) }),
    price,
  ].filter(Boolean);
  return (
    <li className={styles.row} data-hidden={hidden ? '' : undefined}>
      <IconButton
        size="sm"
        pressed={favorite}
        label={t(favorite ? 'chat.models.removeFavorite' : 'chat.models.addFavorite', {
          name: model.name,
        })}
        icon={<Star weight={favorite ? 'fill' : 'regular'} />}
        onClick={() => toggleIn('favorites', key)}
      />
      <div className={styles.text}>
        <span className={styles.name} dir="auto">
          {model.name}
        </span>
        <span className={styles.id}>{model.id}</span>
        {facts.length > 0 ? <span className={styles.facts}>{facts.join(', ')}</span> : null}
      </div>
      <div className={styles.marks}>
        {changed ? <span className={styles.chip}>{t('settings.models.changed')}</span> : null}
        {hidden ? <span className={styles.chip}>{t('settings.models.hidden')}</span> : null}
      </div>
      <IconButton
        size="sm"
        label={t(hidden ? 'settings.models.show' : 'settings.models.hide', { name: model.name })}
        icon={hidden ? <EyeSlash /> : <Eye />}
        onClick={() => toggleIn('hidden', key)}
      />
      <IconButton
        size="sm"
        label={t('settings.models.edit', { name: model.name })}
        icon={<SlidersHorizontal />}
        onClick={() => onEdit(model)}
      />
    </li>
  );
});

function ProviderModels({
  name,
  error,
  models,
  query,
  onEdit,
}: {
  name: string;
  error: string | null;
  models: ModelInfo[];
  query: string;
  onEdit: (m: ModelInfo) => void;
}) {
  const t = useT();
  const favorites = useSettings((s) => s.settings.models.favorites);
  const hidden = useSettings((s) => s.settings.models.hidden);
  const overrides = useSettings((s) => s.settings.models.overrides);
  const [shown, setShown] = useState<{ query: string; count: number }>({ query, count: PAGE_SIZE });
  const count = shown.query === query ? shown.count : PAGE_SIZE;
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const hits = useMemo(
    () => searchModels(models, query, favoriteSet),
    [models, query, favoriteSet],
  );
  if (hits.length === 0) return null;
  const rest = hits.length - count;
  return (
    <Group title={name}>
      {error ? (
        <p className={styles.warn}>
          {t('settings.models.providerError', { provider: name, error })}
        </p>
      ) : null}
      <ul className={styles.list}>
        {hits.slice(0, count).map((m) => {
          const key = keyOf(m);
          return (
            <ModelRow
              key={key}
              model={m}
              favorite={favoriteSet.has(key)}
              hidden={hiddenSet.has(key)}
              changed={key in overrides}
              onEdit={onEdit}
            />
          );
        })}
      </ul>
      {rest > 0 ? (
        <Button
          size="sm"
          className={styles.more}
          onClick={() => setShown({ query, count: count + PAGE_SIZE })}
        >
          {t('chat.models.showMore', { count: Math.min(PAGE_SIZE, rest) })}
        </Button>
      ) : null}
    </Group>
  );
}

export function ModelsSettings() {
  const t = useT();
  // Everything the providers offer, hidden models included: this is where they come back.
  const catalog = useQuery({
    queryKey: qk.models,
    queryFn: providersApi.allModels,
    staleTime: 60_000,
  });
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [editing, setEditing] = useState<ModelInfo | null>(null);

  const providers = catalog.data?.providers ?? [];
  const total = providers.reduce((n, p) => n + p.models.length, 0);
  const matches = useMemo(
    () => providers.reduce((n, p) => n + searchModels(p.models, deferred).length, 0),
    [providers, deferred],
  );

  return (
    <>
      <SectionHeader title={t('settings.sections.models')} intro={t('settings.models.intro')} />
      {catalog.isPending ? <Spinner /> : null}
      {catalog.isError ? (
        <div className={styles.failed}>
          <p>{t('settings.models.loadFailed')}</p>
          <Button size="sm" onClick={() => void catalog.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
      {catalog.data && total === 0 ? (
        <p className={styles.empty}>{t('chat.models.empty')}</p>
      ) : null}
      {total > 0 ? (
        <>
          <TextField
            className={styles.search}
            label={t('settings.models.search')}
            type="search"
            placeholder={t('settings.models.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {matches === 0 ? (
            <p className={styles.empty}>{t('chat.models.noMatch', { query: deferred.trim() })}</p>
          ) : null}
          {providers.map((p) => (
            <ProviderModels
              key={p.providerId}
              name={p.providerName}
              error={p.error}
              models={p.models}
              query={deferred}
              onEdit={setEditing}
            />
          ))}
        </>
      ) : null}
      <ModelOverrideDialog model={editing} onClose={() => setEditing(null)} />
    </>
  );
}

import type { ModelInfo, ModelRef } from '@neotext/shared';
import { Command } from 'cmdk';
import { type KeyboardEvent, useCallback, useDeferredValue, useMemo, useState } from 'react';
import { useT } from '../../../lib/i18n';
import { Button } from '../../../ui';
import { toggleFavorite, useFavorites } from './favorites';
import styles from './ModelPicker.module.css';
import { ModelRow } from './ModelRow';
import { searchModels, toRef } from './model-search';
import { useOpenProviderSettings } from './open-settings';
import { keyOf, type ModelsState, useModels } from './use-models';

/** Rows drawn per section before "Show more": 450 models stay quick to type into and scroll. */
export const PAGE_SIZE = 40;

interface Section {
  id: string;
  heading: string;
  models: ModelInfo[];
}

/** Favorites first, then one section per provider (a starred model is not listed twice). */
function buildSections(
  catalog: ModelsState,
  query: string,
  favorites: ReadonlySet<string>,
  favoritesHeading: string,
): Section[] {
  const hits = searchModels(catalog.models, query, favorites);
  const starred = hits.filter((m) => favorites.has(keyOf(m)));
  const sections: Section[] = [];
  if (starred.length > 0) {
    sections.push({ id: 'favorites', heading: favoritesHeading, models: starred });
  }
  for (const p of catalog.providers) {
    const own = hits.filter((m) => m.providerId === p.providerId && !favorites.has(keyOf(m)));
    if (own.length > 0) {
      sections.push({ id: `provider:${p.providerId}`, heading: p.providerName, models: own });
    }
  }
  return sections;
}

function SettingsLink({ onNavigate }: { onNavigate: () => void }) {
  const t = useT();
  const open = useOpenProviderSettings();
  return (
    <a
      className={styles.link}
      href="/settings/providers"
      onClick={(e) => {
        e.preventDefault();
        onNavigate();
        open();
      }}
    >
      {t('chat.models.openSettings')}
    </a>
  );
}

export interface ModelListProps {
  value: ModelRef | null;
  onPick: (ref: ModelRef) => void;
  /** Called before leaving for the provider settings. */
  onLeave: () => void;
}

/** What the open picker shows: the list, or why there is none. */
export function ModelList({ value, onPick, onLeave }: ModelListProps) {
  const t = useT();
  const catalog = useModels();
  if (catalog.isLoading) return <p className={styles.status}>{t('chat.models.loading')}</p>;
  if (catalog.isError) {
    return (
      <div className={styles.status}>
        <p>{t('chat.models.loadFailed')}</p>
        <Button size="sm" onClick={catalog.refetch}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }
  if (catalog.models.length === 0) {
    return (
      <div className={styles.status}>
        <p>{t('chat.models.empty')}</p>
        <SettingsLink onNavigate={onLeave} />
      </div>
    );
  }
  return <ModelCommand catalog={catalog} value={value} onPick={onPick} />;
}

interface Widened {
  query: string;
  by: Record<string, number>;
}

function ModelCommand({
  catalog,
  value,
  onPick,
}: {
  catalog: ModelsState;
  value: ModelRef | null;
  onPick: (ref: ModelRef) => void;
}) {
  const t = useT();
  const favorites = useFavorites();
  const [query, setQuery] = useState('');
  // Typing stays instant; the list catches up when the browser has a moment.
  const deferred = useDeferredValue(query);
  const [widened, setWidened] = useState<Widened>({ query: '', by: {} });

  const sections = useMemo(
    () => buildSections(catalog, deferred, favorites, t('chat.models.favorites')),
    [catalog, deferred, favorites, t],
  );
  const widenedNow = widened.query === deferred ? widened.by : {};

  const pick = useCallback((m: ModelInfo) => onPick(toRef(m)), [onPick]);
  const toggle = useCallback((m: ModelInfo) => toggleFavorite(keyOf(m)), []);

  // The current model starts highlighted when it is among the rows first drawn.
  const [initial] = useState(() => {
    if (!value) return undefined;
    const drawn = buildSections(catalog, '', favorites, '').flatMap((s) =>
      s.models.slice(0, PAGE_SIZE),
    );
    const current = drawn.find((m) => m.providerId === value.providerId && m.id === value.modelId);
    return current ? keyOf(current) : undefined;
  });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || !e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
    // cmdk keeps the highlight in the DOM (it reports it only to a controlled list).
    const row = e.currentTarget.querySelector('[cmdk-item][aria-selected="true"]');
    const model = catalog.byKey.get(row?.getAttribute('data-value') ?? '');
    if (!model) return;
    e.preventDefault();
    toggleFavorite(keyOf(model));
  };

  return (
    <Command
      className={styles.command}
      label={t('chat.models.search')}
      shouldFilter={false}
      loop
      defaultValue={initial}
      onKeyDown={onKeyDown}
    >
      <Command.Input
        className={styles.search}
        placeholder={t('chat.models.searchPlaceholder')}
        value={query}
        onValueChange={setQuery}
      />
      <Command.List className={styles.list} aria-label={t('chat.models.list')}>
        {sections.length === 0 ? (
          <p className={styles.status}>{t('chat.models.noMatch', { query: deferred.trim() })}</p>
        ) : null}
        {sections.map((s) => {
          const limit = widenedNow[s.id] ?? PAGE_SIZE;
          const rest = s.models.length - limit;
          return (
            <Command.Group key={s.id} heading={s.heading} className={styles.group}>
              {s.models.slice(0, limit).map((m) => (
                <ModelRow
                  key={keyOf(m)}
                  model={m}
                  favorite={favorites.has(keyOf(m))}
                  onPick={pick}
                  onToggleFavorite={toggle}
                />
              ))}
              {rest > 0 ? (
                <Command.Item
                  value={`more:${s.id}`}
                  className={styles.more}
                  onSelect={() =>
                    setWidened({
                      query: deferred,
                      by: { ...widenedNow, [s.id]: limit + PAGE_SIZE },
                    })
                  }
                >
                  <span>{t('chat.models.showMore', { count: Math.min(PAGE_SIZE, rest) })}</span>
                  <span className={styles.meta}>{t('chat.models.notShown', { count: rest })}</span>
                </Command.Item>
              ) : null}
            </Command.Group>
          );
        })}
      </Command.List>
      <p className={styles.hint}>{t('chat.models.starHint')}</p>
    </Command>
  );
}

import type { Folder } from '@neotext/shared';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { providersApi } from '../../lib/api/providers';
import { useT } from '../../lib/i18n';
import { qk } from '../../lib/query';
import { Button, Select, type SelectOption, Spinner, TextField } from '../../ui';
import styles from './SmartSectionEditor.module.css';
import { type SmartFilterInput, useSmartQuery } from './smart-filter';
import { useConversationList, useFolders } from './use-conversations';

/** Radix selects cannot hold an empty value, so "any" has a name of its own. */
const ANY = '__any__';
const WITHIN_DAYS = [7, 30, 90] as const;
const TITLE_MAX = 60;

export interface SmartSectionInput {
  title: string;
  filter: SmartFilterInput;
}

/** "Thesis / Chapter 1": a folder's name with the folders above it. */
function folderPaths(folders: Folder[]): SelectOption[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathOf = (f: Folder): string => {
    const parent = f.parentId ? byId.get(f.parentId) : undefined;
    return parent && parent.id !== f.id ? `${pathOf(parent)} / ${f.name}` : f.name;
  };
  return folders
    .map((f) => ({ value: f.id, label: pathOf(f) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function useModelOptions(): SelectOption[] {
  const { data } = useQuery({ queryKey: qk.models, queryFn: providersApi.allModels });
  return useMemo(() => {
    // The server filters on the model id alone, so one entry per id.
    const seen = new Map<string, string>();
    for (const provider of data?.providers ?? []) {
      for (const m of provider.models) if (!seen.has(m.id)) seen.set(m.id, m.name);
    }
    return [...seen]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data]);
}

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

function buildFilter(f: {
  modelId: string;
  folderId: string;
  titleContains: string;
  days: string;
}): SmartFilterInput {
  const filter: SmartFilterInput = {};
  if (f.modelId !== ANY) filter.modelIds = [f.modelId];
  if (f.folderId !== ANY) filter.folderIds = [f.folderId];
  const text = f.titleContains.trim();
  if (text) filter.titleContains = text;
  if (f.days !== ANY) filter.updatedWithinDays = Number(f.days);
  return filter;
}

function Preview({ filter }: { filter: SmartFilterInput }) {
  const t = useT();
  const list = useConversationList(useSmartQuery(filter));
  let text: string;
  if (list.isPending) text = '';
  else if (list.isError) text = t('sidebar.smart.previewFailed');
  else if (list.items.length === 0) text = t('sidebar.smart.previewNone');
  else if (list.hasNextPage) text = t('sidebar.smart.previewMore', { count: list.items.length });
  else if (list.items.length === 1) text = t('sidebar.smart.previewOne');
  else text = t('sidebar.smart.previewMany', { count: list.items.length });
  return (
    <p className={styles.preview} aria-live="polite">
      {list.isPending ? <Spinner label={t('common.loading')} size={12} /> : text}
    </p>
  );
}

export interface SmartSectionEditorProps {
  onSubmit: (input: SmartSectionInput) => void;
  onCancel: () => void;
}

export function SmartSectionEditor({ onSubmit, onCancel }: SmartSectionEditorProps) {
  const t = useT();
  const models = useModelOptions();
  const { data: folders = [] } = useFolders();
  const [title, setTitle] = useState('');
  const [modelId, setModelId] = useState(ANY);
  const [folderId, setFolderId] = useState(ANY);
  const [titleContains, setTitleContains] = useState('');
  const [days, setDays] = useState(ANY);

  const typed = useDebounced(titleContains, 250);
  const filter = buildFilter({ modelId, folderId, titleContains, days });
  const previewFilter = useMemo(
    () => buildFilter({ modelId, folderId, titleContains: typed, days }),
    [modelId, folderId, typed, days],
  );

  const modelOptions = [{ value: ANY, label: t('sidebar.smart.anyModel') }, ...models];
  const folderOptions = [
    { value: ANY, label: t('sidebar.smart.anyFolder') },
    ...folderPaths(folders),
  ];
  const dayOptions = [
    { value: ANY, label: t('sidebar.smart.anyTime') },
    ...WITHIN_DAYS.map((d) => ({
      value: String(d),
      label: t('sidebar.smart.lastDays', { count: d }),
    })),
  ];

  const name = title.trim();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name) onSubmit({ title: name, filter });
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <TextField
        label={t('sidebar.smart.name')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={TITLE_MAX}
        autoComplete="off"
        dir="auto"
        autoFocus
      />
      <fieldset className={styles.filters}>
        <legend className={styles.legend}>{t('sidebar.smart.filters')}</legend>
        <Select
          label={t('sidebar.smart.model')}
          value={modelId}
          onChange={setModelId}
          options={modelOptions}
        />
        <Select
          label={t('sidebar.smart.folder')}
          value={folderId}
          onChange={setFolderId}
          options={folderOptions}
        />
        <TextField
          label={t('sidebar.smart.titleContains')}
          value={titleContains}
          onChange={(e) => setTitleContains(e.target.value)}
          autoComplete="off"
          dir="auto"
        />
        <Select
          label={t('sidebar.smart.updatedWithin')}
          value={days}
          onChange={setDays}
          options={dayOptions}
        />
      </fieldset>
      <Preview filter={previewFilter} />
      <div className={styles.actions}>
        <Button variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" type="submit" disabled={!name}>
          {t('sidebar.smart.add')}
        </Button>
      </div>
    </form>
  );
}

import type {
  CreateProviderBody,
  ProviderCategory,
  ProviderKind,
  ProviderPreset,
  ProviderPublic,
  UpdateProviderBody,
} from '@neotext/shared';
import { type FormEvent, useId, useRef, useState } from 'react';
import { useT } from '../../../lib/i18n';
import { Button, Select, Switch, TextArea, TextField, toast } from '../../../ui';
import { mapError } from '../../auth/authErrors';
import { FormError } from '../../auth/FormError';
import { useFocusFirstError } from '../../auth/useFocusFirstError';
import { ConnectionTest } from '../ConnectionTest';
import {
  kindCategory,
  MAX_HEADERS,
  MAX_MODEL_IDS,
  parseHeaders,
  parseModelIds,
} from '../provider-fields';
import { useProviderMutations } from '../use-providers';
import styles from './ProviderForm.module.css';

export interface ProviderFormProps {
  /** Present when editing; absent when adding. */
  provider?: ProviderPublic;
  presets: ProviderPreset[];
  /** Model providers or search providers; only that kind of preset is offered. Default `llm`. */
  category?: ProviderCategory;
  /** After a save, and when the form is cancelled. */
  onDone: () => void;
  /** Present when editing: asks the page to confirm and delete. */
  onDelete?: () => void;
  /** Admins only: offers to share a new provider with everyone on the instance. */
  canShare?: boolean;
}

const FALLBACK: Record<ProviderCategory, ProviderPreset> = {
  llm: {
    id: 'custom',
    name: 'Custom endpoint',
    kind: 'openai-compatible',
    baseUrl: '',
    keyRequired: false,
  },
  search: { id: 'searxng', name: 'SearXNG', kind: 'searxng', baseUrl: '', keyRequired: false },
};

type Field = 'name' | 'baseUrl' | 'apiKey' | 'headers' | 'models';
const FIELDS = ['name', 'baseUrl', 'apiKey'] as const;

export function ProviderForm({
  provider,
  presets,
  category: asked = 'llm',
  onDone,
  onDelete,
  canShare = false,
}: ProviderFormProps) {
  const t = useT();
  const editing = provider !== undefined;
  const category = provider?.category ?? asked;
  const fallback = FALLBACK[category];
  const offered = presets.filter((p) => kindCategory(p.kind) === category);
  const choices = offered.length > 0 ? offered : [fallback];
  const { create, update } = useProviderMutations();
  const formRef = useRef<HTMLFormElement>(null);
  const keyHintId = useId();

  const first = choices[0] ?? fallback;
  const [presetId, setPresetId] = useState(first.id);
  const [name, setName] = useState(provider?.name ?? first.name);
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? first.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [headers, setHeaders] = useState('');
  const [models, setModels] = useState((provider?.manualModels ?? []).join('\n'));
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [shared, setShared] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [failures, setFailures] = useState(0);
  useFocusFirstError(formRef, failures);

  const preset = choices.find((p) => p.id === presetId) ?? first;
  const kind: ProviderKind = provider?.kind ?? preset.kind;
  const search = category === 'search';
  const busy = create.isPending || update.isPending;

  function choosePreset(id: string) {
    const next = choices.find((p) => p.id === id);
    if (!next) return;
    // A name the person typed stays; one that only came from the old preset follows the new one.
    if (name === preset.name || name === '') setName(next.id === 'custom' ? '' : next.name);
    setBaseUrl(next.baseUrl);
    setPresetId(id);
  }

  function fail(next: Partial<Record<Field, string>>, form?: string) {
    setErrors(next);
    setFormError(form);
    setFailures((n) => n + 1);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Partial<Record<Field, string>> = {};
    const cleanName = name.trim();
    const cleanUrl = baseUrl.trim();
    if (!cleanName) found.name = t('settings.providers.nameRequired');
    if (kind === 'openai-compatible' && !cleanUrl) {
      found.baseUrl = t('settings.providers.baseUrlRequired');
    }
    if (kind === 'searxng' && !cleanUrl) {
      found.baseUrl = t('settings.providers.searxngUrlRequired');
    }
    if (!provider && (kind === 'brave' || kind === 'tavily') && !apiKey.trim()) {
      found.apiKey = t('settings.providers.keyRequired');
    }
    const parsedHeaders = headers.trim() ? parseHeaders(headers) : {};
    if (parsedHeaders === null) found.headers = t('settings.providers.headersInvalid');
    else if (Object.keys(parsedHeaders).length > MAX_HEADERS) {
      found.headers = t('settings.providers.headersTooMany');
    }
    const modelIds = parseModelIds(models);
    if (modelIds.length > MAX_MODEL_IDS) found.models = t('settings.providers.modelsTooMany');
    if (Object.keys(found).length > 0) return fail(found);
    setErrors({});
    setFormError(undefined);

    try {
      if (provider) {
        const body: UpdateProviderBody = {};
        if (cleanName !== provider.name) body.name = cleanName;
        if (cleanUrl && cleanUrl !== provider.baseUrl) body.baseUrl = cleanUrl;
        if (apiKey) body.apiKey = apiKey;
        else if (removeKey) body.apiKey = null;
        if (parsedHeaders && Object.keys(parsedHeaders).length > 0) body.headers = parsedHeaders;
        if (modelIds.join('\n') !== provider.manualModels.join('\n')) body.manualModels = modelIds;
        if (enabled !== provider.enabled) body.enabled = enabled;
        if (Object.keys(body).length > 0) {
          await update.mutateAsync({ id: provider.id, body });
        }
        toast({ message: t('common.saved'), tone: 'success' });
      } else {
        const body: CreateProviderBody = { kind, name: cleanName };
        if (cleanUrl) body.baseUrl = cleanUrl;
        if (apiKey) body.apiKey = apiKey;
        if (parsedHeaders && Object.keys(parsedHeaders).length > 0) body.headers = parsedHeaders;
        if (modelIds.length > 0) body.manualModels = modelIds;
        if (canShare && shared) body.shared = true;
        await create.mutateAsync(body);
        toast({ message: t('settings.providers.added'), tone: 'success' });
      }
      onDone();
    } catch (err) {
      const mapped = mapError(err, FIELDS);
      fail(mapped.fields, mapped.form);
    }
  }

  const keyPlaceholder = provider?.hasKey
    ? provider.keyHint
      ? t('settings.providers.keySaved', { hint: provider.keyHint })
      : t('settings.providers.keySavedNoHint')
    : t('settings.providers.keyPlaceholder');
  const keyWillGo = removeKey && !apiKey;

  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      {editing ? null : (
        <Select
          label={t('settings.providers.service')}
          value={presetId}
          onChange={choosePreset}
          options={choices.map((p) => ({ value: p.id, label: p.name }))}
        />
      )}
      <TextField
        label={t('settings.providers.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
        autoComplete="off"
        {...(errors.name ? { error: errors.name } : {})}
      />
      <TextField
        label={t('settings.providers.baseUrl')}
        hint={
          search ? t('settings.providers.searchBaseUrlHint') : t('settings.providers.baseUrlHint')
        }
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        {...(errors.baseUrl ? { error: errors.baseUrl } : {})}
      />
      <div className={styles.keyBlock}>
        <TextField
          label={t('settings.providers.apiKey')}
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={keyPlaceholder ?? ''}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={keyHintId}
          {...(errors.apiKey ? { error: errors.apiKey } : {})}
        />
        <div id={keyHintId} className={styles.keyLine}>
          {provider?.hasKey ? (
            keyWillGo ? (
              <>
                <p className={styles.note}>{t('settings.providers.keyWillBeRemoved')}</p>
                <Button size="sm" variant="ghost" onClick={() => setRemoveKey(false)}>
                  {t('settings.providers.keepKey')}
                </Button>
              </>
            ) : (
              <>
                <p className={styles.note}>{t('settings.providers.keyKeepHint')}</p>
                <Button size="sm" variant="ghost" onClick={() => setRemoveKey(true)}>
                  {t('settings.providers.removeKey')}
                </Button>
              </>
            )
          ) : null}
        </div>
      </div>
      <TextArea
        label={t('settings.providers.headers')}
        hint={
          editing ? t('settings.providers.headersKeepHint') : t('settings.providers.headersHint')
        }
        value={headers}
        onChange={(e) => setHeaders(e.target.value)}
        minRows={2}
        maxRows={6}
        spellCheck={false}
        autoComplete="off"
        {...(errors.headers ? { error: errors.headers } : {})}
      />
      {search ? null : (
        <TextArea
          label={t('settings.providers.models')}
          hint={t('settings.providers.modelsHint')}
          value={models}
          onChange={(e) => setModels(e.target.value)}
          minRows={2}
          maxRows={6}
          spellCheck={false}
          {...(errors.models ? { error: errors.models } : {})}
        />
      )}
      {canShare && !editing ? (
        <Switch
          label={t('settings.providers.share')}
          hint={t('settings.providers.shareHint')}
          checked={shared}
          onChange={setShared}
        />
      ) : null}
      {provider ? (
        <>
          <Switch
            label={t('settings.providers.enabled')}
            hint={t('settings.providers.enabledHint')}
            checked={enabled}
            onChange={setEnabled}
          />
          <ConnectionTest providerId={provider.id} />
        </>
      ) : null}
      <FormError message={formError} />
      <div className={styles.actions}>
        {onDelete ? (
          <Button variant="danger" className={styles.delete} onClick={onDelete}>
            {t('settings.providers.delete')}
          </Button>
        ) : null}
        <Button onClick={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" loading={busy}>
          {editing
            ? t('common.save')
            : search
              ? t('settings.providers.addSearch')
              : t('settings.providers.addSubmit')}
        </Button>
      </div>
    </form>
  );
}

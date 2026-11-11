import {
  type ModelRef,
  type Preset,
  type PresetData,
  PresetDataSchema,
  type ReasoningEffort,
} from '@neotext/shared';
import { type FormEvent, useId, useState } from 'react';
import { useT } from '../../lib/i18n';
import { Button, Dialog, TextArea, TextField } from '../../ui';
import { Select } from '../../ui/Select/Select';
import { ModelPicker } from '../chat/composer/ModelPicker';
import { useModels } from '../chat/composer/use-models';
import { ACCENTS } from '../settings/AccentSwatches';
import swatches from '../settings/AccentSwatches.module.css';
import styles from './PresetEditor.module.css';
import { usePresetMutations } from './use-presets';

const MAX_PROMPT = 20_000;
const EFFORTS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

interface Draft {
  name: string;
  color: string | null;
  systemPrompt: string;
  model: ModelRef | null;
  effort: ReasoningEffort | 'auto';
  temperature: string;
  maxTokens: string;
  webSearch: boolean;
}
type Problems = Partial<Record<'name' | 'systemPrompt' | 'temperature' | 'maxTokens', string>>;

const blank: Draft = {
  name: '',
  color: null,
  systemPrompt: '',
  model: null,
  effort: 'auto',
  temperature: '',
  maxTokens: '',
  webSearch: false,
};

const draftOf = (p: Preset | null): Draft =>
  p
    ? {
        name: p.name,
        color: p.data.color,
        systemPrompt: p.data.systemPrompt,
        model: p.data.model,
        effort: p.data.reasoningEffort ?? 'auto',
        temperature: p.data.temperature === null ? '' : String(p.data.temperature),
        maxTokens: p.data.maxOutputTokens === null ? '' : String(p.data.maxOutputTokens),
        webSearch: p.data.webSearch,
      }
    : blank;

function ColorChoice({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
}) {
  const t = useT();
  const name = useId();
  return (
    <fieldset className={swatches.group}>
      <legend className={swatches.legend}>{t('sidebar.presets.editor.color')}</legend>
      <div className={swatches.options}>
        {[null, ...ACCENTS].map((accent) => (
          <label key={accent ?? 'none'} className={swatches.option}>
            <input
              className={swatches.input}
              type="radio"
              name={name}
              checked={value === accent}
              onChange={() => onChange(accent)}
            />
            <span className={swatches.chip} data-accent={accent ?? undefined} aria-hidden />
            <span className={swatches.text}>
              {accent
                ? t(`settings.appearance.accents.${accent}`)
                : t('sidebar.presets.editor.noColor')}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function PresetForm({ preset, onClose }: { preset: Preset | null; onClose: () => void }) {
  const t = useT();
  const mutations = usePresetMutations();
  const catalog = useModels();
  const [draft, setDraft] = useState<Draft>(() => draftOf(preset));
  const [problems, setProblems] = useState<Problems>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const modelName =
    draft.model === null
      ? t('sidebar.presets.editor.defaultModel')
      : (catalog.providers
          .flatMap((p) => p.models)
          .find((m) => m.providerId === draft.model?.providerId && m.id === draft.model?.modelId)
          ?.name ?? draft.model.modelId);

  async function save(e: FormEvent) {
    e.preventDefault();
    const found: Problems = {};
    const name = draft.name.trim();
    if (name === '') found.name = t('sidebar.presets.editor.nameRequired');
    else if (name.length > 60) found.name = t('sidebar.presets.editor.nameTooLong');
    if (draft.systemPrompt.length > MAX_PROMPT)
      found.systemPrompt = t('sidebar.presets.editor.promptTooLong');
    const temperature = draft.temperature.trim() === '' ? null : Number(draft.temperature);
    if (temperature !== null && !(temperature >= 0 && temperature <= 2)) {
      found.temperature = t('sidebar.presets.editor.temperatureInvalid');
    }
    const maxTokens = draft.maxTokens.trim() === '' ? null : Number(draft.maxTokens);
    if (
      maxTokens !== null &&
      !(Number.isInteger(maxTokens) && maxTokens >= 1 && maxTokens <= 200_000)
    ) {
      found.maxTokens = t('sidebar.presets.editor.maxTokensInvalid');
    }
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    const parsed = PresetDataSchema.safeParse({
      systemPrompt: draft.systemPrompt,
      model: draft.model,
      reasoningEffort: draft.effort === 'auto' ? null : draft.effort,
      temperature,
      maxOutputTokens: maxTokens,
      webSearch: draft.webSearch,
      color: draft.color,
    });
    if (!parsed.success) {
      setProblems({ name: t('sidebar.presets.editor.invalid') });
      return;
    }
    const data: PresetData = parsed.data;
    setSaving(true);
    const saved = preset
      ? await mutations.update(preset.id, { name, data })
      : await mutations.create({ name, data });
    setSaving(false);
    if (saved) onClose();
  }

  return (
    <form className={styles.form} onSubmit={(e) => void save(e)}>
      <TextField
        label={t('sidebar.presets.editor.name')}
        value={draft.name}
        onChange={(e) => set('name', e.target.value)}
        error={problems.name}
        autoComplete="off"
        dir="auto"
      />
      <ColorChoice value={draft.color} onChange={(c) => set('color', c)} />
      <TextArea
        label={t('sidebar.presets.editor.systemPrompt')}
        hint={t('sidebar.presets.editor.systemPromptHint')}
        value={draft.systemPrompt}
        onChange={(e) => set('systemPrompt', e.target.value)}
        error={problems.systemPrompt}
        minRows={4}
        maxRows={12}
        dir="auto"
      />
      <div className={styles.modelRow}>
        <span className={styles.modelLabel}>{t('sidebar.presets.editor.model')}</span>
        <ModelPicker value={draft.model} onChange={(ref) => set('model', ref)} align="start">
          <Button type="button">{modelName}</Button>
        </ModelPicker>
        {draft.model ? (
          <Button type="button" variant="ghost" onClick={() => set('model', null)}>
            {t('sidebar.presets.editor.useDefaultModel')}
          </Button>
        ) : null}
      </div>
      <Select
        label={t('sidebar.presets.editor.reasoning')}
        value={draft.effort}
        onChange={(v) => set('effort', v as Draft['effort'])}
        options={[
          { value: 'auto', label: t('chat.composer.effort.auto') },
          ...EFFORTS.map((effort) => ({
            value: effort,
            label: t(`chat.composer.effort.${effort}`),
          })),
        ]}
      />
      <div className={styles.pair}>
        <TextField
          label={t('sidebar.presets.editor.temperature')}
          hint={t('sidebar.presets.editor.optionalHint')}
          value={draft.temperature}
          onChange={(e) => set('temperature', e.target.value)}
          error={problems.temperature}
          inputMode="decimal"
          autoComplete="off"
        />
        <TextField
          label={t('sidebar.presets.editor.maxTokens')}
          hint={t('sidebar.presets.editor.optionalHint')}
          value={draft.maxTokens}
          onChange={(e) => set('maxTokens', e.target.value)}
          error={problems.maxTokens}
          inputMode="numeric"
          autoComplete="off"
        />
      </div>
      <div className={styles.actions}>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

export interface PresetEditorProps {
  open: boolean;
  /** Null for a new preset. */
  preset: Preset | null;
  onOpenChange: (open: boolean) => void;
}

export function PresetEditor({ open, preset, onOpenChange }: PresetEditorProps) {
  const t = useT();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={preset ? t('sidebar.presets.editor.editTitle') : t('sidebar.presets.editor.newTitle')}
    >
      <PresetForm preset={preset} onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}

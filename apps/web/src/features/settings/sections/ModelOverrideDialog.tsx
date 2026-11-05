import type { JsonObject, ModelInfo } from '@neotext/shared';
import { type FormEvent, useState } from 'react';
import { formatContext } from '../../../lib/format';
import { useT } from '../../../lib/i18n';
import { updateSettings, useSettings } from '../../../state/settings';
import { Button, Dialog, TextField, toast } from '../../../ui';
import { keyOf } from '../../chat/composer/use-models';
import { ChoiceGroup } from '../../sidebar/ChoiceGroup';
import { type NumberRule, parseNumber, toText } from '../numbers';
import styles from './ModelOverrideDialog.module.css';

type Tri = 'catalog' | 'on' | 'off';
const triOf = (v: boolean | undefined): Tri => (v === undefined ? 'catalog' : v ? 'on' : 'off');
const boolOf = (v: Tri): boolean | null => (v === 'catalog' ? null : v === 'on');

const RULES = {
  contextLength: { min: 1, max: 100_000_000, integer: true },
  maxOutputTokens: { min: 1, max: 100_000_000, integer: true },
  temperature: { min: 0, max: 2 },
  inputPricePerM: { min: 0, max: 1_000_000 },
  outputPricePerM: { min: 0, max: 1_000_000 },
} as const satisfies Record<string, NumberRule>;
type NumberKey = keyof typeof RULES;
const NUMBER_KEYS = Object.keys(RULES) as NumberKey[];

function Form({ model, onClose }: { model: ModelInfo; onClose: () => void }) {
  const t = useT();
  const key = keyOf(model);
  const saved = useSettings((s) => s.settings.models.overrides[key]);
  const [text, setText] = useState<Record<NumberKey, string>>(() => ({
    contextLength: toText(saved?.contextLength),
    maxOutputTokens: toText(saved?.maxOutputTokens),
    temperature: toText(saved?.temperature),
    inputPricePerM: toText(saved?.inputPricePerM),
    outputPricePerM: toText(saved?.outputPricePerM),
  }));
  const [tools, setTools] = useState<Tri>(triOf(saved?.supportsTools));
  const [vision, setVision] = useState<Tri>(triOf(saved?.supportsVision));
  const [invalid, setInvalid] = useState<Partial<Record<NumberKey, boolean>>>({});

  const errorFor: Record<NumberKey, string> = {
    contextLength: t('settings.models.override.tokensError'),
    maxOutputTokens: t('settings.models.override.tokensError'),
    temperature: t('settings.models.override.temperatureError'),
    inputPricePerM: t('settings.models.override.priceError'),
    outputPricePerM: t('settings.models.override.priceError'),
  };
  const catalogHint: Record<NumberKey, string> = {
    contextLength: model.contextLength === null ? '' : formatContext(model.contextLength),
    maxOutputTokens: model.maxOutputTokens === null ? '' : formatContext(model.maxOutputTokens),
    temperature: '',
    inputPricePerM: model.pricing.promptPerM === null ? '' : String(model.pricing.promptPerM),
    outputPricePerM:
      model.pricing.completionPerM === null ? '' : String(model.pricing.completionPerM),
  };
  const label: Record<NumberKey, string> = {
    contextLength: t('settings.models.override.contextLength'),
    maxOutputTokens: t('settings.models.override.maxOutput'),
    temperature: t('settings.models.override.temperature'),
    inputPricePerM: t('settings.models.override.inputPrice'),
    outputPricePerM: t('settings.models.override.outputPrice'),
  };

  function save(e: FormEvent) {
    e.preventDefault();
    const values: Partial<Record<NumberKey, number | null>> = {};
    const bad: Partial<Record<NumberKey, boolean>> = {};
    for (const k of NUMBER_KEYS) {
      const parsed = parseNumber(text[k], RULES[k]);
      if (parsed.ok) values[k] = parsed.value;
      else bad[k] = true;
    }
    setInvalid(bad);
    if (Object.keys(bad).length > 0) return;

    // null removes a field from the saved override, so every field is named in the patch.
    const override: JsonObject = {
      ...Object.fromEntries(NUMBER_KEYS.map((k) => [k, values[k] ?? null])),
      supportsTools: boolOf(tools),
      supportsVision: boolOf(vision),
    };
    const empty = Object.values(override).every((v) => v === null);
    if (!(empty && !saved)) {
      updateSettings({ models: { overrides: { [key]: empty ? null : override } } });
      toast({ message: t('common.saved'), tone: 'success' });
    }
    onClose();
  }

  const field = (k: NumberKey, step?: number) => (
    <TextField
      label={label[k]}
      type="number"
      inputMode="decimal"
      min={RULES[k].min}
      step={step ?? ('integer' in RULES[k] ? 1 : 'any')}
      value={text[k]}
      placeholder={catalogHint[k]}
      onChange={(e) => setText((v) => ({ ...v, [k]: e.target.value }))}
      {...(invalid[k] ? { error: errorFor[k] } : {})}
    />
  );

  return (
    <form className={styles.form} onSubmit={save} noValidate>
      <div className={styles.grid}>
        {field('contextLength')}
        {field('maxOutputTokens')}
        {field('inputPricePerM')}
        {field('outputPricePerM')}
        {field('temperature', 0.1)}
      </div>
      <div className={styles.choices}>
        <ChoiceGroup
          legend={t('settings.models.override.tools')}
          value={tools}
          onChange={setTools}
          options={[
            { value: 'catalog', label: t('settings.models.override.catalog') },
            { value: 'on', label: t('settings.models.override.on') },
            { value: 'off', label: t('settings.models.override.off') },
          ]}
        />
        <ChoiceGroup
          legend={t('settings.models.override.vision')}
          value={vision}
          onChange={setVision}
          options={[
            { value: 'catalog', label: t('settings.models.override.catalog') },
            { value: 'on', label: t('settings.models.override.on') },
            { value: 'off', label: t('settings.models.override.off') },
          ]}
        />
      </div>
      <div className={styles.actions}>
        {saved ? (
          <Button
            variant="ghost"
            className={styles.reset}
            onClick={() => {
              updateSettings({ models: { overrides: { [key]: null } } });
              onClose();
            }}
          >
            {t('settings.models.override.reset')}
          </Button>
        ) : null}
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary">
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

export interface ModelOverrideDialogProps {
  model: ModelInfo | null;
  onClose: () => void;
}

/** Your own numbers for one model, kept under its `<providerId>|<modelId>` key. */
export function ModelOverrideDialog({ model, onClose }: ModelOverrideDialogProps) {
  const t = useT();
  return (
    <Dialog
      open={model !== null}
      onOpenChange={(open) => !open && onClose()}
      size="md"
      title={model?.name ?? ''}
      description={t('settings.models.override.description')}
    >
      {model ? <Form key={keyOf(model)} model={model} onClose={onClose} /> : null}
    </Dialog>
  );
}

import type { ModelInfo } from '@neotext/shared';
import { Brain, Eye, Star, Wrench } from '@phosphor-icons/react';
import { Command } from 'cmdk';
import { memo, type ReactNode } from 'react';
import { formatContext, formatPricePerM } from '../../../lib/format';
import { useT } from '../../../lib/i18n';
import { Tooltip } from '../../../ui';
import styles from './ModelPicker.module.css';
import { keyOf } from './use-models';

type Translate = ReturnType<typeof useT>;

/** "$0.05 in, $0.50 out per 1M", "Free", or nothing when the provider gives no price. */
export function priceText(m: ModelInfo, t: Translate): string | null {
  const { promptPerM, completionPerM } = m.pricing;
  if (promptPerM === null && completionPerM === null) return null;
  if (promptPerM === 0 && completionPerM === 0) return t('common.free');
  return t('chat.models.price', {
    input: formatPricePerM(promptPerM),
    output: formatPricePerM(completionPerM),
  });
}

function Capability({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip content={label}>
      <span className={styles.capability} role="img" aria-label={label}>
        {children}
      </span>
    </Tooltip>
  );
}

export interface ModelRowProps {
  model: ModelInfo;
  favorite: boolean;
  onPick: (m: ModelInfo) => void;
  onToggleFavorite: (m: ModelInfo) => void;
}

/** Memoized: a keystroke or a star changes few rows, and each row costs a few tooltips. */
export const ModelRow = memo(function ModelRow({
  model,
  favorite,
  onPick,
  onToggleFavorite,
}: ModelRowProps) {
  const t = useT();
  const price = priceText(model, t);
  const context = model.contextLength === null ? null : formatContext(model.contextLength);
  const vision = model.inputModalities.includes('image');
  const tools = model.supports.tools === true;
  const reasons = model.supports.reasoning === true || model.reasoning !== null;
  const starLabel = t(favorite ? 'chat.models.removeFavorite' : 'chat.models.addFavorite', {
    name: model.name,
  });
  return (
    <Command.Item value={keyOf(model)} className={styles.row} onSelect={() => onPick(model)}>
      <span className={styles.text}>
        <span className={styles.name} dir="auto">
          {model.name}
        </span>
        <span className={styles.meta}>
          {price ? <span>{price}</span> : null}
          {context ? <span>{t('chat.models.context', { size: context })}</span> : null}
        </span>
      </span>
      <span className={styles.capabilities}>
        {vision ? (
          <Capability label={t('chat.models.vision')}>
            <Eye aria-hidden />
          </Capability>
        ) : null}
        {tools ? (
          <Capability label={t('chat.models.tools')}>
            <Wrench aria-hidden />
          </Capability>
        ) : null}
        {reasons ? (
          <Capability label={t('chat.models.reasoning')}>
            <Brain aria-hidden />
          </Capability>
        ) : null}
      </span>
      <button
        type="button"
        tabIndex={-1}
        className={styles.star}
        aria-label={starLabel}
        aria-pressed={favorite}
        // Keep the search box focused, and keep the click from choosing the row.
        onPointerDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(model);
        }}
      >
        <Star weight={favorite ? 'fill' : 'regular'} aria-hidden />
      </button>
    </Command.Item>
  );
});

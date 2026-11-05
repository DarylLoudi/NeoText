import type { ModelInfo } from '@neotext/shared';
import { type ReactNode, useId } from 'react';
import { formatContext, formatMonth, formatPricePerM } from '../../../lib/format';
import { getLocale, useT } from '../../../lib/i18n';
import { Button } from '../../../ui';
import styles from './ModelSheet.module.css';
import { useOpenProviderSettings } from './open-settings';

export interface ModelSheetProps {
  /** The model the next message goes to. */
  model: ModelInfo | null;
  providerName: string | null;
  /** False when no provider is connected at all. */
  hasProvider: boolean;
  loading: boolean;
  /** Starting points from the user's presets (Plan 05 fills this). */
  presets?: ReactNode;
}

/** "2026-01" as "January 2026"; anything else as given. */
function cutoff(value: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(value);
  const month = m ? Number(m[2]) : 0;
  return m?.[1] && month >= 1 && month <= 12 ? formatMonth(Number(m[1]), month, locale) : value;
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <dt className={styles.term}>{term}</dt>
      <dd className={styles.detail}>{children}</dd>
    </div>
  );
}

/**
 * Shown on an empty chat: a short greeting, then the chosen model with what it costs and what
 * it can do as one quiet line of facts, centred like the start of most chat apps.
 */
export function ModelSheet({
  model,
  providerName,
  hasProvider,
  loading,
  presets,
}: ModelSheetProps) {
  const t = useT();
  const headingId = useId();
  const openSettings = useOpenProviderSettings();
  if (loading) return null;

  if (!hasProvider || !model) {
    return (
      <section className={styles.sheet}>
        <div className={styles.column}>
          <p className={styles.message}>
            {hasProvider ? t('chat.sheet.noModels') : t('chat.sheet.connect')}
          </p>
          <Button variant="primary" onClick={openSettings}>
            {t('chat.sheet.connectButton')}
          </Button>
        </div>
      </section>
    );
  }

  const locale = getLocale();
  const price = (perM: number | null) => {
    if (perM === null) return t('chat.sheet.unknown');
    return perM === 0
      ? formatPricePerM(0)
      : t('chat.sheet.priceValue', { price: formatPricePerM(perM) });
  };
  const supports = [
    t('chat.sheet.text'),
    ...(model.inputModalities.includes('image') ? [t('chat.sheet.images')] : []),
    ...(model.supports.tools === true ? [t('chat.sheet.tools')] : []),
    ...(model.supports.reasoning === true || model.reasoning !== null
      ? [t('chat.sheet.reasoning')]
      : []),
  ];

  return (
    <section className={styles.sheet} aria-labelledby={headingId}>
      <div className={styles.column}>
        <p className={styles.greeting}>{t('chat.sheet.greeting')}</p>
        <h2 className={styles.name} dir="auto">
          <span id={headingId}>{model.name}</span>
          {providerName ? <span className={styles.provider}> · {providerName}</span> : null}
        </h2>
        <dl className={styles.list}>
          <Row term={t('chat.sheet.contextWindow')}>
            {model.contextLength === null
              ? t('chat.sheet.unknown')
              : t('chat.sheet.contextValue', { size: formatContext(model.contextLength) })}
          </Row>
          <Row term={t('chat.sheet.inputPrice')}>{price(model.pricing.promptPerM)}</Row>
          <Row term={t('chat.sheet.outputPrice')}>{price(model.pricing.completionPerM)}</Row>
          {model.knowledgeCutoff ? (
            <Row term={t('chat.sheet.knowledgeCutoff')}>
              {cutoff(model.knowledgeCutoff, locale)}
            </Row>
          ) : null}
          <Row term={t('chat.sheet.supports')}>
            {supports.length === 1
              ? t('chat.sheet.supportsNothing')
              : new Intl.ListFormat(locale, { type: 'conjunction' }).format(supports)}
          </Row>
        </dl>
        {presets ? (
          <div className={styles.presets} data-slot="presets">
            {presets}
          </div>
        ) : null}
      </div>
    </section>
  );
}

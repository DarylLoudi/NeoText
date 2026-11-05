import type { Quota } from '@neotext/shared';
import { useT } from '../../lib/i18n';
import { NumberField } from '../settings/NumberField';
import { Row } from '../settings/SettingsParts';

const LIMIT_MAX = 1_000_000;

/**
 * The daily and monthly limit on shared models. An emptied box is no limit; 0 allows no use of
 * shared models at all. A change is passed up as soon as a box is left.
 */
export function QuotaEditor({ value, onChange }: { value: Quota; onChange: (q: Quota) => void }) {
  const t = useT();
  const field = (key: keyof Quota, label: string) => (
    <NumberField
      label={label}
      value={value[key]}
      onCommit={(v) => onChange({ ...value, [key]: v })}
      min={0}
      max={LIMIT_MAX}
      step={0.01}
      hint={t('admin.quota.hint')}
      error={t('admin.quota.error')}
    />
  );
  return (
    <Row>
      {field('dailyUsd', t('admin.quota.daily'))}
      {field('monthlyUsd', t('admin.quota.monthly'))}
    </Row>
  );
}

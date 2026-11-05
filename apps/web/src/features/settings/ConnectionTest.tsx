import type { ProviderTestResult } from '@neotext/shared';
import { useState } from 'react';
import { ApiError } from '../../lib/api/client';
import { formatDuration } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { Button } from '../../ui';
import styles from './ConnectionTest.module.css';
import { useProviderMutations } from './use-providers';

/** Tests the provider as saved and shows the server's own words for what it found. */
export function ConnectionTest({ providerId }: { providerId: string }) {
  const t = useT();
  const { test } = useProviderMutations();
  const [result, setResult] = useState<ProviderTestResult | { ok: false; message: string } | null>(
    null,
  );

  async function run() {
    setResult(null);
    try {
      setResult(await test.mutateAsync(providerId));
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof ApiError ? err.message : t('settings.providers.testFailed'),
      });
    }
  }

  return (
    <div className={styles.block}>
      <div className={styles.line}>
        <Button loading={test.isPending} onClick={run}>
          {t('settings.providers.test')}
        </Button>
        <p className={styles.hint}>{t('settings.providers.testHint')}</p>
      </div>
      <div role="status" className={styles.result}>
        {result?.ok === true ? (
          <p className={styles.ok}>
            {t('settings.providers.testOk', { time: formatDuration(result.latencyMs) })}
            {result.modelCount !== null
              ? ` ${t('settings.providers.testModels', { count: result.modelCount })}`
              : ''}
          </p>
        ) : result ? (
          <p className={styles.fail}>{result.message}</p>
        ) : null}
      </div>
    </div>
  );
}

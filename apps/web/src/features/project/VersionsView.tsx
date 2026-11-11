import type { ProjectVersion } from '@neotext/shared';
import { useState } from 'react';
import { useT } from '../../lib/i18n';
import { Button } from '../../ui';
import { changesText } from './changes-text';
import { lineDiff } from './line-diff';
import styles from './ProjectPanel.module.css';

interface Props {
  versions: ProjectVersion[];
  current: number;
  onPick: (number: number) => void;
}

function Diff({ before, after }: { before: string; after: string }) {
  return (
    <pre className={styles.diff}>
      {lineDiff(before, after).map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity of their own
        <span key={i} className={styles.diffLine} data-kind={line.kind}>
          {line.text}
        </span>
      ))}
    </pre>
  );
}

/** Every version, newest first, with what it changed and its diff against the one before. */
export function VersionsView({ versions, current, onPick }: Props) {
  const t = useT();
  const [open, setOpen] = useState<number | null>(null);
  return (
    <ol className={styles.versions} aria-label={t('chat.project.tabs.versions')} reversed>
      {[...versions].reverse().map((v) => {
        const previous = versions[v.number - 2];
        return (
          <li key={v.messageId} className={styles.version}>
            <div className={styles.versionRow}>
              <Button
                size="sm"
                variant={v.number === current ? 'primary' : 'ghost'}
                aria-current={v.number === current || undefined}
                onClick={() => onPick(v.number)}
              >
                {t('chat.project.versionLabel', { n: v.number, total: versions.length })}
              </Button>
              <span className={styles.versionChanges}>{changesText(v.changes, t)}</span>
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={open === v.number}
                onClick={() => setOpen(open === v.number ? null : v.number)}
              >
                {open === v.number ? t('chat.project.hideCompare') : t('chat.project.compare')}
              </Button>
            </div>
            {open === v.number
              ? v.changes.map((c) => (
                  <section key={c.path} className={styles.diffFile}>
                    <h4 className={styles.diffName}>{changesText([c], t)}</h4>
                    <Diff
                      before={previous?.files.get(c.path) ?? ''}
                      after={v.files.get(c.path) ?? ''}
                    />
                  </section>
                ))
              : null}
          </li>
        );
      })}
    </ol>
  );
}

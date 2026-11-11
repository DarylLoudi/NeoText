import type { ProjectFiles } from '@neotext/shared';
import { useState } from 'react';
import { useT } from '../../lib/i18n';
import { sizeText } from './changes-text';
import styles from './ProjectPanel.module.css';

/** The files of the shown version, read only; choosing one shows its text. */
export function FilesView({ files }: { files: ProjectFiles }) {
  const t = useT();
  const paths = [...files.keys()].sort();
  const [chosen, setChosen] = useState<string | null>(null);
  const shown = chosen !== null && files.has(chosen) ? chosen : null;
  return (
    <div className={styles.files}>
      <ul className={styles.fileList} aria-label={t('chat.project.tabs.files')}>
        {paths.map((path) => (
          <li key={path}>
            <button
              type="button"
              className={styles.file}
              aria-pressed={shown === path}
              onClick={() => setChosen(shown === path ? null : path)}
            >
              <span className={styles.fileName}>{path}</span>
              <span className={styles.fileSize}>{sizeText(files.get(path) ?? '', t)}</span>
            </button>
          </li>
        ))}
      </ul>
      {shown ? (
        <pre className={styles.code}>
          <code>{files.get(shown)}</code>
        </pre>
      ) : null}
    </div>
  );
}

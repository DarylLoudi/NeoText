import { X } from '@phosphor-icons/react';
import type { Ref } from 'react';
import { useT } from '../../lib/i18n';
import { Button, IconButton } from '../../ui';
import { Select } from '../../ui/Select/Select';
import styles from './ProjectPanel.module.css';

export type PanelTab = 'preview' | 'versions' | 'files';
export type FrameWidth = 'fit' | 'phone';

interface Props {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  pages: string[];
  page: string | null;
  onPage: (page: string) => void;
  total: number;
  current: number;
  onVersion: (number: number) => void;
  width: FrameWidth;
  onWidth: (width: FrameWidth) => void;
  canRun: boolean;
  onReload: () => void;
  onResetData: () => void;
  onDownload: () => void;
  onClose: () => void;
  closeRef: Ref<HTMLButtonElement>;
}

const TABS: PanelTab[] = ['preview', 'versions', 'files'];
const WIDTHS: FrameWidth[] = ['fit', 'phone'];

export function PanelHeader(p: Props) {
  const t = useT();
  return (
    <header className={styles.header}>
      <div className={styles.headerRow}>
        <h2 className={styles.title}>{t('chat.project.title')}</h2>
        <div className={styles.tabs}>
          {TABS.map((tab) => (
            <Button
              key={tab}
              size="sm"
              variant="ghost"
              className={styles.tab}
              aria-pressed={p.tab === tab}
              onClick={() => p.onTab(tab)}
            >
              {t(`chat.project.tabs.${tab}`)}
            </Button>
          ))}
        </div>
        <IconButton
          ref={p.closeRef}
          size="sm"
          label={t('chat.project.close')}
          icon={<X />}
          onClick={p.onClose}
        />
      </div>
      <div className={styles.toolbar}>
        {p.pages.length > 1 && p.page ? (
          <Select
            aria-label={t('chat.project.page')}
            value={p.page}
            onChange={p.onPage}
            options={p.pages.map((page) => ({ value: page, label: page }))}
            triggerClassName={styles.select}
          />
        ) : null}
        {p.total > 0 ? (
          <Select
            aria-label={t('chat.project.version')}
            value={String(p.current)}
            onChange={(v) => p.onVersion(Number(v))}
            options={Array.from({ length: p.total }, (_, i) => ({
              value: String(i + 1),
              label: t('chat.project.versionLabel', { n: i + 1, total: p.total }),
            })).reverse()}
            triggerClassName={styles.select}
          />
        ) : null}
        {p.canRun ? (
          <>
            {/* biome-ignore lint/a11y/useSemanticElements: a pair of toggle buttons, not a form */}
            <div className={styles.segment} role="group" aria-label={t('chat.project.width.label')}>
              {WIDTHS.map((w) => (
                <Button
                  key={w}
                  size="sm"
                  variant="ghost"
                  aria-pressed={p.width === w}
                  onClick={() => p.onWidth(w)}
                >
                  {t(`chat.project.width.${w}`)}
                </Button>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={p.onReload}>
              {t('chat.project.reload')}
            </Button>
            <Button size="sm" variant="ghost" onClick={p.onResetData}>
              {t('chat.project.resetData')}
            </Button>
            <Button size="sm" variant="ghost" onClick={p.onDownload}>
              {t('chat.project.download')}
            </Button>
          </>
        ) : null}
      </div>
    </header>
  );
}

import type { MessagePublic, ProjectFiles } from '@neotext/shared';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import { Button } from '../../ui';
import { bundlePage, htmlPages, resolveRef } from './bundle';
import { type ConsoleLine, ConsoleStrip } from './ConsoleStrip';
import { downloadPage } from './download';
import { FilesView } from './FilesView';
import { type FrameWidth, PanelHeader, type PanelTab } from './PanelHeader';
import { PreviewFrame } from './PreviewFrame';
import styles from './ProjectPanel.module.css';
import { usePanelProject } from './panel-project';
import { PRELUDE_SOURCE } from './prelude';
import type { PreviewStorage } from './preview-storage';
import type { FrameMessage } from './protocol';
import { VersionsView } from './VersionsView';

export interface ProjectPanelViewProps {
  conversationId: string;
  title: string;
  /** The visible branch, root to leaf. */
  path: MessagePublic[];
  storage: PreviewStorage;
  /** The answer the panel was opened from; null follows the latest version. */
  messageId: string | null;
  onClose: () => void;
}

/**
 * The version the panel opens at: the last one written at or before `messageId`. Null, which
 * follows every later version, when that is already the newest.
 */
function versionAt(path: MessagePublic[], numbers: Map<string, number>, messageId: string | null) {
  if (messageId === null) return null;
  const end = path.findIndex((m) => m.id === messageId);
  if (end === -1) return null;
  let found: number | null = null;
  for (const m of path.slice(0, end + 1)) found = numbers.get(m.id) ?? found;
  return found === numbers.size ? null : found;
}

function fingerprint(files: ProjectFiles): string {
  let hash = 0x811c9dc5;
  for (const [path, content] of files) {
    for (const text of [path, '\u0000', content, '\u0001']) {
      for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    }
  }
  return `${files.size}:${hash >>> 0}`;
}

/** Keeps the same files object while the content is the same, so the frame is not remounted. */
function useStableFiles(files: ProjectFiles): ProjectFiles {
  const last = useRef<{ key: string; files: ProjectFiles } | null>(null);
  const key = useMemo(() => fingerprint(files), [files]);
  if (last.current?.key !== key) last.current = { key, files };
  return last.current.files;
}

export function ProjectPanelView({
  conversationId,
  title,
  path,
  storage: kept,
  messageId,
  onClose,
}: ProjectPanelViewProps) {
  const t = useT();
  const project = usePanelProject(path);
  const { versions } = project;
  const numbers = useMemo(() => new Map(versions.map((v) => [v.messageId, v.number])), [versions]);
  const [picked, setPicked] = useState<number | null>(() => versionAt(path, numbers, messageId));
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new opener moves the pick
  useEffect(() => setPicked(versionAt(path, numbers, messageId)), [messageId]);
  const latest = versions.length;
  const current = picked !== null && picked <= latest ? picked : latest;
  const files = useStableFiles(versions[current - 1]?.files ?? project.files);
  const pages = useMemo(() => htmlPages(files), [files]);
  const [pageChoice, setPage] = useState<string | null>(null);
  const page = pageChoice !== null && pages.includes(pageChoice) ? pageChoice : (pages[0] ?? null);
  const [tab, setTab] = useState<PanelTab>('preview');
  const [width, setWidth] = useState<FrameWidth>('fit');
  const [reloadKey, setReloadKey] = useState(0);
  const storage = useRef<Record<string, string> | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  useEffect(() => {
    let live = true;
    void kept.load(conversationId).then((items) => {
      if (!live) return;
      storage.current = items;
      setStorageReady(true);
    });
    return () => {
      live = false;
    };
  }, [conversationId, kept]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a reload rebuilds with fresh storage
  const bundle = useMemo(
    () =>
      page && storageReady
        ? bundlePage(files, page, { prelude: PRELUDE_SOURCE, storage: storage.current ?? {} })
        : null,
    [files, page, storageReady, reloadKey],
  );
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  /** A page the preview tried to move to that the project lacks; kept until another page shows. */
  const [lost, setLost] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a page change clears it
  useEffect(() => setLost(null), [page]);
  const [blocked, setBlocked] = useState<string[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each run starts a fresh log
  useEffect(() => {
    setLines([]);
    setBlocked([]);
  }, [bundle]);

  const onMessage = (m: FrameMessage) => {
    if (m.type === 'nt-console')
      setLines((l) => [...l, { level: m.level, text: m.text }].slice(-500));
    else if (m.type === 'nt-blocked') setBlocked((b) => (b.includes(m.url) ? b : [...b, m.url]));
    else if (m.type === 'nt-storage') {
      storage.current = m.items;
      kept.save(conversationId, m.items);
    } else if (m.type === 'nt-navigate' && page) {
      const ref = resolveRef(page.split('/').slice(0, -1).join('/'), m.path);
      if (ref.kind === 'file' && pages.includes(ref.path)) {
        if (ref.path === page) setReloadKey((k) => k + 1);
        else setPage(ref.path);
      } else if (m.path.startsWith('/')) {
        // The page moved itself somewhere the project has nothing: back to where it was.
        setLost(m.path.slice(1));
        setReloadKey((k) => k + 1);
      }
    } else if (m.type === 'nt-escape') {
      // Only while the page has focus, so a page cannot pull focus out of the app on its own.
      const active = document.activeElement;
      if (active?.tagName === 'IFRAME' && panelRef.current?.contains(active)) {
        closeRef.current?.focus();
      }
    }
  };

  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };
  const external = bundle ? [...new Set([...bundle.external, ...blocked])] : blocked;
  const missing = bundle ? [...new Set([...bundle.missing, ...(lost ? [lost] : [])])] : [];
  const showFiles = tab === 'files' || (tab === 'preview' && page === null);

  return (
    <aside
      ref={panelRef}
      className={styles.panel}
      aria-label={t('chat.project.title')}
      onKeyDown={onKeyDown}
    >
      <PanelHeader
        tab={tab}
        onTab={setTab}
        pages={pages}
        page={page}
        onPage={setPage}
        total={latest}
        current={current}
        onVersion={setPicked}
        width={width}
        onWidth={setWidth}
        canRun={page !== null}
        onReload={() => setReloadKey((k) => k + 1)}
        onResetData={() =>
          void kept.clear(conversationId).then(() => {
            storage.current = {};
            setReloadKey((k) => k + 1);
          })
        }
        onDownload={() => {
          if (page)
            downloadPage(title, bundlePage(files, page, { prelude: null, storage: {} }).html);
        }}
        onClose={onClose}
        closeRef={closeRef}
      />
      {current < latest ? (
        <p className={styles.notice}>
          {t('chat.project.newer')}
          <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
            {t('chat.project.showLatest')}
          </Button>
        </p>
      ) : null}
      {latest === 0 ? <p className={styles.notice}>{t('chat.project.empty')}</p> : null}
      {page === null && latest > 0 ? (
        <p className={styles.notice}>{t('chat.project.noHtml')}</p>
      ) : null}
      {tab === 'preview' && bundle ? (
        <>
          {external.length > 0 ? (
            <p className={styles.notice}>
              {t('chat.project.offline')} <span className={styles.refs}>{external.join(', ')}</span>
            </p>
          ) : null}
          {missing.length > 0 ? (
            <p className={styles.notice}>
              {t('chat.project.missing')} <span className={styles.refs}>{missing.join(', ')}</span>
            </p>
          ) : null}
          <div className={styles.stage} data-width={width}>
            <PreviewFrame
              html={bundle.html}
              page={page ?? ''}
              reloadKey={reloadKey}
              title={t('chat.project.frameTitle', { page })}
              className={styles.frame}
              onMessage={onMessage}
            />
          </div>
          <ConsoleStrip lines={lines} />
        </>
      ) : null}
      {tab === 'versions' ? (
        <VersionsView versions={versions} current={current} onPick={setPicked} />
      ) : null}
      {showFiles ? <FilesView files={files} /> : null}
    </aside>
  );
}

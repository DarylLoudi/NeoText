import { FileDoc, FilePdf, FileText, Trash, UploadSimple } from '@phosphor-icons/react';
import { type DragEvent, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import { Button, Dialog, IconButton, Spinner, Tooltip } from '../../ui';
import { formatBytes } from '../chat/composer/attachments';
import styles from './KnowledgeSection.module.css';
import { type AgentFile, KNOWLEDGE_EXTENSIONS, KNOWLEDGE_MAX_FILES } from './knowledge-types';
import { useAgentFiles } from './use-agent-files';

const ACCEPT = KNOWLEDGE_EXTENSIONS.map((e) => `.${e}`).join(',');

function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return <FilePdf size={20} aria-hidden />;
  if (ext === 'docx') return <FileDoc size={20} aria-hidden />;
  return <FileText size={20} aria-hidden />;
}

function FileRow({ file, onDelete }: { file: AgentFile; onDelete: () => void }) {
  const t = useT();
  const failed = file.status === 'failed';
  const reason = file.error ?? t('settings.agents.editor.knowledge.failedFallback');
  const detail = [
    formatBytes(file.size),
    file.pages !== null ? t('settings.agents.editor.knowledge.pages', { count: file.pages }) : null,
    failed ? null : t('settings.agents.editor.knowledge.parts', { count: file.chunks }),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className={styles.row}>
      <span className={styles.icon}>
        <FileIcon name={file.name} />
      </span>
      <div className={styles.main}>
        <span className={styles.name} dir="auto">
          {file.name}
        </span>
        <span className={styles.detail}>{failed ? reason : detail}</span>
      </div>
      {failed ? (
        <Tooltip content={reason}>
          <span className={`${styles.pill} ${styles.failed}`}>
            {t('settings.agents.editor.knowledge.failed')}
          </span>
        </Tooltip>
      ) : (
        <span className={`${styles.pill} ${styles.ready}`}>
          {t('settings.agents.editor.knowledge.ready')}
        </span>
      )}
      <IconButton
        size="sm"
        label={t('settings.agents.editor.knowledge.deleteNamed', { name: file.name })}
        icon={<Trash size={16} />}
        onClick={onDelete}
      />
    </li>
  );
}

const carriesFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files');

/** The agent's files: dropped or chosen, searched by the agent when it answers. */
export function KnowledgeSection({ agentId }: { agentId: string | null }) {
  const t = useT();
  const { query, files, uploading, problems, add, remove, dismissProblem } = useAgentFiles(agentId);
  const [over, setOver] = useState(false);
  const [deleting, setDeleting] = useState<AgentFile | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const full = files.length + uploading.length >= KNOWLEDGE_MAX_FILES;

  if (agentId === null) {
    return (
      <section className={styles.section} aria-labelledby="knowledge-title">
        <h3 id="knowledge-title" className={styles.title}>
          {t('settings.agents.editor.knowledge.title')}
        </h3>
        <p className={styles.hint}>{t('settings.agents.editor.knowledge.saveFirst')}</p>
      </section>
    );
  }

  return (
    <section className={styles.section} aria-labelledby="knowledge-title">
      <h3 id="knowledge-title" className={styles.title}>
        {t('settings.agents.editor.knowledge.title')}
      </h3>
      <p className={styles.hint}>{t('settings.agents.editor.knowledge.intro')}</p>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target; the button is the keyboard path */}
      <div
        className={styles.drop}
        data-over={over || undefined}
        data-disabled={full || undefined}
        onDragEnter={(e) => {
          if (carriesFiles(e) && !full) setOver(true);
        }}
        onDragOver={(e) => {
          if (!carriesFiles(e) || full) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (!carriesFiles(e)) return;
          e.preventDefault();
          setOver(false);
          if (!full) add([...e.dataTransfer.files]);
        }}
      >
        <UploadSimple size={24} aria-hidden />
        <span>{t('settings.agents.editor.knowledge.drop')}</span>
        <span className={styles.accepted}>
          {t('settings.agents.editor.knowledge.accepted', {
            types: 'PDF, DOCX, TXT, MD, CSV, HTML',
          })}
        </span>
        <input
          ref={input}
          className={styles.hidden}
          type="file"
          multiple
          accept={ACCEPT}
          aria-label={t('settings.agents.editor.knowledge.input')}
          tabIndex={-1}
          disabled={full}
          onChange={(e) => {
            add([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <Button type="button" size="sm" disabled={full} onClick={() => input.current?.click()}>
          {t('settings.agents.editor.knowledge.add')}
        </Button>
      </div>
      {problems.length > 0 ? (
        <ul className={styles.problems} role="alert">
          {problems.map((p) => (
            <li key={p.key}>
              <span dir="auto">{p.name}</span>: {p.message}{' '}
              <button
                type="button"
                className={styles.dismiss}
                onClick={() => dismissProblem(p.key)}
              >
                {t('settings.agents.editor.knowledge.dismiss')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {query.isError ? (
        <p className={styles.error} role="alert">
          {t('settings.agents.editor.knowledge.loadFailed')}
        </p>
      ) : null}
      {files.length > 0 || uploading.length > 0 ? (
        <ul className={styles.list} aria-label={t('settings.agents.editor.knowledge.title')}>
          {files.map((f) => (
            <FileRow key={f.id} file={f} onDelete={() => setDeleting(f)} />
          ))}
          {uploading.map((u) => (
            <li key={u.key} className={styles.row}>
              <span className={styles.icon}>
                <Spinner />
              </span>
              <div className={styles.main}>
                <span className={styles.name} dir="auto">
                  {u.name}
                </span>
                <progress
                  className={styles.progress}
                  value={u.progress}
                  max={1}
                  aria-label={t('settings.agents.editor.knowledge.uploading', { name: u.name })}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <p className={styles.footer}>
        {t('settings.agents.editor.knowledge.count', {
          count: files.length,
          max: KNOWLEDGE_MAX_FILES,
        })}
      </p>
      <Dialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        size="sm"
        title={t('settings.agents.editor.knowledge.deleteTitle', { name: deleting?.name ?? '' })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const id = deleting?.id;
                setDeleting(null);
                if (id) void remove(id);
              }}
            >
              {t('settings.agents.editor.knowledge.delete')}
            </Button>
          </>
        }
      >
        <p>{t('settings.agents.editor.knowledge.deleteBody')}</p>
      </Dialog>
    </section>
  );
}

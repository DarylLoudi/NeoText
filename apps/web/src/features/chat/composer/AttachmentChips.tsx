import { attachmentKind, type ModelInfo } from '@neotext/shared';
import { FileText, ImageSquare, Warning, X } from '@phosphor-icons/react';
import { useT } from '../../../lib/i18n';
import { IconButton } from '../../../ui';
import styles from './AttachmentChips.module.css';
import { attachmentSupport, formatBytes, type PendingAttachment } from './attachments';

export interface AttachmentChipsProps {
  items: PendingAttachment[];
  model: ModelInfo | null;
  onRemove: (key: string) => void;
}

/** Files waiting to go with the next message: name, size, progress, and what the model can't read. */
export function AttachmentChips({ items, model, onRemove }: AttachmentChipsProps) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <ul className={styles.chips} aria-label={t('chat.attachments.list')}>
      {items.map((item) => {
        const kind = attachmentKind(item.mime);
        const unreadable =
          item.status !== 'error' && attachmentSupport(model, item.mime) === 'unsupported';
        const note =
          item.error ??
          (unreadable
            ? t(kind === 'image' ? 'chat.attachments.noImages' : 'chat.attachments.noFiles')
            : null);
        return (
          <li
            key={item.key}
            className={styles.chip}
            data-state={item.status === 'error' ? 'error' : unreadable ? 'warn' : undefined}
          >
            <span className={styles.icon} aria-hidden="true">
              {kind === 'image' ? <ImageSquare /> : <FileText />}
            </span>
            <span className={styles.text}>
              <span className={styles.name} title={item.name}>
                {item.name}
              </span>
              <span className={styles.meta}>
                {item.status === 'uploading' ? (
                  <span
                    className={styles.bar}
                    role="progressbar"
                    aria-label={t('chat.attachments.uploading', { name: item.name })}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(item.progress * 100)}
                  >
                    <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
                  </span>
                ) : (
                  <span>{formatBytes(item.size)}</span>
                )}
              </span>
              {note ? (
                <span className={styles.note}>
                  <Warning aria-hidden="true" />
                  {note}
                </span>
              ) : null}
            </span>
            <IconButton
              size="sm"
              label={t('chat.attachments.remove', { name: item.name })}
              icon={<X />}
              onClick={() => onRemove(item.key)}
            />
          </li>
        );
      })}
    </ul>
  );
}

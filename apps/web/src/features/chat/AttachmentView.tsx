import { ATTACHMENT_UNAVAILABLE_ID, attachmentKind, type MessagePart } from '@neotext/shared';
import { FileText } from '@phosphor-icons/react';
import { useState } from 'react';
import { attachmentUrl } from '../../lib/api/attachments';
import { useT } from '../../lib/i18n';
import styles from './AttachmentView.module.css';
import { formatBytes } from './composer/attachments';

export type AttachmentPart = Extract<MessagePart, { type: 'attachment' }>;

function FileChip({ part }: { part: AttachmentPart }) {
  const t = useT();
  if (part.attachmentId === ATTACHMENT_UNAVAILABLE_ID) {
    return (
      <span className={styles.file} data-unavailable="">
        <FileText aria-hidden="true" className={styles.fileIcon} />
        <span className={styles.fileName}>{part.name}</span>
        <span className={styles.fileSize}>{t('chat.attachments.unavailable')}</span>
      </span>
    );
  }
  return (
    <a
      className={styles.file}
      href={attachmentUrl(part.attachmentId)}
      download={part.name}
      aria-label={t('chat.attachments.download', { name: part.name })}
    >
      <FileText aria-hidden="true" className={styles.fileIcon} />
      <span className={styles.fileName}>{part.name}</span>
      <span className={styles.fileSize}>{formatBytes(part.size)}</span>
    </a>
  );
}

function Thumbnail({ part }: { part: AttachmentPart }) {
  const t = useT();
  // A file that is gone (or will not decode) still shows its name.
  const [broken, setBroken] = useState(false);
  if (broken) return <FileChip part={part} />;
  const url = attachmentUrl(part.attachmentId);
  return (
    <a
      className={styles.thumb}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('chat.attachments.open', { name: part.name })}
    >
      <img
        src={url}
        alt={part.name}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
      />
    </a>
  );
}

/** A message's files: images as thumbnails, everything else as download chips. */
export function AttachmentView({ parts }: { parts: AttachmentPart[] }) {
  const t = useT();
  if (parts.length === 0) return null;
  return (
    <ul className={styles.list} aria-label={t('chat.attachments.list')}>
      {parts.map((part) => (
        <li key={part.attachmentId || `gone:${part.name}:${part.size}`}>
          {attachmentKind(part.mime) === 'image' &&
          part.attachmentId !== ATTACHMENT_UNAVAILABLE_ID ? (
            <Thumbnail part={part} />
          ) : (
            <FileChip part={part} />
          )}
        </li>
      ))}
    </ul>
  );
}

export const attachmentParts = (parts: MessagePart[]): AttachmentPart[] =>
  parts.filter((p): p is AttachmentPart => p.type === 'attachment');

/** Files an edit can carry again: the ones that still exist. */
export const hasUsableFiles = (parts: MessagePart[]): boolean =>
  attachmentParts(parts).some((p) => p.attachmentId !== ATTACHMENT_UNAVAILABLE_ID);

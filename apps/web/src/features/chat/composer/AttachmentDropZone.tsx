import { type DragEvent, type ReactNode, useRef, useState } from 'react';
import { useT } from '../../../lib/i18n';
import styles from './AttachmentDropZone.module.css';

const carriesFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files');

/**
 * The composer box: files dropped on it, and images pasted into it, are attached. Pasted text
 * goes into the field as usual.
 */
export function AttachmentDropZone({
  className,
  onFiles,
  children,
}: {
  className?: string;
  onFiles: (files: File[]) => void;
  children: ReactNode;
}) {
  const t = useT();
  const [over, setOver] = useState(false);
  /** Enter and leave fire for every child crossed; count them to know when the drag left. */
  const depth = useRef(0);
  const reset = () => {
    depth.current = 0;
    setOver(false);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop and paste targets; the attach button is the keyboard path
    <div
      className={[className, styles.zone].filter(Boolean).join(' ')}
      data-over={over || undefined}
      onDragEnter={(e) => {
        if (!carriesFiles(e)) return;
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!carriesFiles(e)) return;
        depth.current -= 1;
        if (depth.current <= 0) reset();
      }}
      onDrop={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        reset();
        const files = [...e.dataTransfer.files];
        if (files.length > 0) onFiles(files);
      }}
      onPaste={(e) => {
        const images = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
        if (images.length === 0) return;
        e.preventDefault();
        onFiles(images);
      }}
    >
      {children}
      {over ? (
        <div className={styles.overlay} aria-hidden="true">
          {t('chat.attachments.drop')}
        </div>
      ) : null}
    </div>
  );
}

import {
  ATTACHMENT_CODE_EXTENSIONS,
  ATTACHMENT_IMAGE_TYPES,
  ATTACHMENT_PDF_TYPE,
  ATTACHMENT_TEXT_TYPES,
} from '@neotext/shared';
import { Paperclip } from '@phosphor-icons/react';
import { useRef } from 'react';
import { useT } from '../../../lib/i18n';
import { IconButton } from '../../../ui';

const ACCEPT = [
  ...ATTACHMENT_IMAGE_TYPES,
  ATTACHMENT_PDF_TYPE,
  ...ATTACHMENT_TEXT_TYPES,
  ...ATTACHMENT_CODE_EXTENSIONS.map((ext) => `.${ext}`),
].join(',');

/** Opens the file picker; the chosen files start uploading at once. */
export function AttachButton({
  onFiles,
  disabled,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <IconButton
        size="sm"
        label={t('chat.attach')}
        icon={<Paperclip />}
        disabled={disabled}
        onClick={() => input.current?.click()}
      />
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={ACCEPT}
        tabIndex={-1}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          // Cleared so picking the same file again still fires a change.
          e.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
    </>
  );
}

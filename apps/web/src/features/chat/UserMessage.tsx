import type { MessagePublic } from '@neotext/shared';
import { memo, useEffect, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import { Button, TextArea, toast } from '../../ui';
import { errorMessage } from '../sidebar/use-conversations';
import { AttachmentView, attachmentParts, hasUsableFiles } from './AttachmentView';
import { MessageActions, useChatActions } from './MessageActions';
import { MessageItem } from './MessageItem';
import { messageText, sameItem, type ThreadItem } from './thread';
import styles from './UserMessage.module.css';

/** Edits a sent message; saving sends it as a new version of that turn. */
function Editor({ message, onDone }: { message: MessagePublic; onDone: () => void }) {
  const t = useT();
  const { generating, editAndResend } = useChatActions();
  const [text, setText] = useState(() => messageText(message));
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // A message of files only may keep an empty text, but only files that still exist count.
  const blank = text.trim() === '' && !hasUsableFiles(message.parts);
  const submit = async () => {
    if (blank || busy || generating) return;
    setBusy(true);
    try {
      if (await editAndResend(message, text)) onDone();
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={styles.editor}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <TextArea
        ref={ref}
        label={t('chat.editLabel')}
        value={text}
        minRows={2}
        maxRows={12}
        dir="auto"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onDone();
          }
        }}
      />
      <div className={styles.editorActions}>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={busy}
          disabled={blank || generating}
        >
          {t('chat.saveAndSend')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

export interface UserMessageProps {
  item: ThreadItem;
}

export const UserMessage = memo(
  function UserMessage({ item }: UserMessageProps) {
    const t = useT();
    const [editing, setEditing] = useState(false);
    return (
      <MessageItem kind="user" label={t('chat.you')} speaker={<span>{t('chat.you')}</span>}>
        {editing ? (
          <Editor message={item.message} onDone={() => setEditing(false)} />
        ) : (
          <>
            <div className={styles.ruled}>
              <AttachmentView parts={attachmentParts(item.message.parts)} />
              <p className={styles.text} dir="auto">
                {messageText(item.message)}
              </p>
            </div>
            <MessageActions item={item} onEdit={() => setEditing(true)} />
          </>
        )}
      </MessageItem>
    );
  },
  (a, b) => sameItem(a.item, b.item),
);

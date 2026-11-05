import type { MessagePublic, ModelRef } from '@neotext/shared';
import {
  ArrowClockwise,
  CaretDown,
  Check,
  Copy,
  GitFork,
  PencilSimple,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { conversationsApi } from '../../lib/api/conversations';
import { useT } from '../../lib/i18n';
import { IconButton, toast } from '../../ui';
import { errorMessage } from '../sidebar/use-conversations';
import { BranchSwitcher } from './BranchSwitcher';
import { ModelPicker } from './composer/ModelPicker';
import styles from './MessageActions.module.css';
import { messageText, type ThreadItem } from './thread';

/** What a message can ask of its chat; provided once by the chat view. */
export interface ChatActions {
  conversationId: string | null;
  /** True while a turn is starting or an answer in this chat is being written. */
  generating: boolean;
  /** Answers again; `target` picks another model, else the one that answered before. */
  regenerate(userMessageId: string, target?: ModelRef): Promise<boolean>;
  editAndResend(message: MessagePublic, text: string): Promise<boolean>;
}

const idle = async () => false;

export const ChatActionsContext = createContext<ChatActions>({
  conversationId: null,
  generating: false,
  regenerate: idle,
  editAndResend: idle,
});

export function useChatActions(): ChatActions {
  return useContext(ChatActionsContext);
}

const COPIED_MS = 2000;

export interface MessageActionsProps {
  item: ThreadItem;
  /** User turns only: opens the inline editor. */
  onEdit?: () => void;
}

export function MessageActions({ item, onEdit }: MessageActionsProps) {
  const t = useT();
  const { conversationId, generating, regenerate } = useChatActions();
  const { message } = item;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(messageText(message)).then(
      () => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      },
      () => undefined,
    );
  };

  const fork = async () => {
    if (!conversationId) return;
    try {
      const copy = await conversationsApi.fork(conversationId, message.id);
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void navigate({ to: '/c/$conversationId', params: { conversationId: copy.id } });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'danger' });
    }
  };

  const parentId = message.parentId;
  return (
    <div className={styles.actions}>
      <IconButton
        size="sm"
        label={copied ? t('common.copied') : t('common.copy')}
        icon={copied ? <Check /> : <Copy />}
        onClick={copy}
      />
      {message.role === 'assistant' && parentId ? (
        <IconButton
          size="sm"
          label={t('chat.regenerate')}
          icon={<ArrowClockwise />}
          disabled={generating}
          onClick={() => void regenerate(parentId)}
        />
      ) : null}
      {message.role === 'assistant' && parentId ? (
        <ModelPicker value={message.model} onChange={(ref) => void regenerate(parentId, ref)}>
          <IconButton
            size="sm"
            label={t('chat.models.regenerateWith')}
            icon={<CaretDown />}
            disabled={generating}
          />
        </ModelPicker>
      ) : null}
      {message.role === 'user' && onEdit ? (
        <IconButton
          size="sm"
          label={t('chat.edit')}
          icon={<PencilSimple />}
          disabled={generating}
          onClick={onEdit}
        />
      ) : null}
      {conversationId ? (
        <IconButton
          size="sm"
          label={t('chat.fork')}
          icon={<GitFork />}
          disabled={generating}
          onClick={() => void fork()}
        />
      ) : null}
      {item.siblingCount > 1 && conversationId ? (
        <BranchSwitcher
          conversationId={conversationId}
          siblingIds={item.siblingIds}
          index={item.siblingIndex}
          disabled={generating}
        />
      ) : null}
    </div>
  );
}

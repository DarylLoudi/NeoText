import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_PER_MESSAGE,
  attachmentKind,
  type ModelInfo,
  normalizeAttachmentMime,
} from '@neotext/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadAttachment } from '../../../lib/api/attachments';
import { attachmentErrorText } from '../../../lib/api/error-text';
import { getLocale, useT } from '../../../lib/i18n';

/**
 * Whether this model reads the file. An unknown model (null, or no listed input types, as from
 * OpenAI-compatible endpoints) is assumed to read it.
 */
export function attachmentSupport(model: ModelInfo | null, mime: string): 'ok' | 'unsupported' {
  const kind = attachmentKind(mime);
  if (kind === null) return 'unsupported';
  if (!model || kind === 'text' || model.inputModalities.length === 0) return 'ok';
  const needs = kind === 'image' ? 'image' : 'file';
  return model.inputModalities.includes(needs) ? 'ok' : 'unsupported';
}

export function formatBytes(n: number, locale: string = getLocale()): string {
  const fmt = (v: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(v);
  if (n < 1024) return `${fmt(n)} B`;
  if (n < 1024 * 1024) return `${fmt(n / 1024)} KB`;
  return `${fmt(n / (1024 * 1024))} MB`;
}

export interface PendingAttachment {
  /** Local key: the server id only exists once the upload finishes. */
  key: string;
  name: string;
  mime: string;
  size: number;
  status: 'uploading' | 'ready' | 'error';
  /** 0 to 1 while uploading. */
  progress: number;
  id: string | null;
  error: string | null;
}

export interface AttachmentsState {
  items: PendingAttachment[];
  /** Starts uploading each file at once; files that cannot go show as errors. */
  add(files: File[]): void;
  remove(key: string): void;
  /** After a send: the uploads now belong to the message. */
  clear(): void;
  /** Server ids of finished uploads, in the order they were added. */
  readyIds: string[];
  uploading: boolean;
}

let seq = 0;

/** The files waiting to go with the next message. Switching chats drops them. */
export function useAttachments(conversationId: string | null): AttachmentsState {
  const t = useT();
  const [items, setItems] = useState<PendingAttachment[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const uploads = useRef(new Map<string, AbortController>());

  const patch = useCallback((key: string, change: Partial<PendingAttachment>) => {
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...change } : i)));
  }, []);

  const abortAll = useCallback(() => {
    for (const c of uploads.current.values()) c.abort();
    uploads.current.clear();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new chat starts empty
  useEffect(() => {
    setItems([]);
    return abortAll;
  }, [conversationId, abortAll]);

  const add = useCallback(
    (files: File[]) => {
      const room = ATTACHMENT_MAX_PER_MESSAGE - itemsRef.current.length;
      const next = files.map((file, i): [PendingAttachment, File | null] => {
        seq += 1;
        const mime = normalizeAttachmentMime(file.name, file.type) ?? file.type;
        const base: PendingAttachment = {
          key: `upl_${seq}`,
          name: file.name || 'file',
          mime,
          size: file.size,
          status: 'uploading',
          progress: 0,
          id: null,
          error: null,
        };
        const error =
          i >= room
            ? t('chat.attachments.tooMany', { max: ATTACHMENT_MAX_PER_MESSAGE })
            : file.size > ATTACHMENT_MAX_BYTES
              ? t('chat.attachments.tooLarge')
              : attachmentKind(mime) === null
                ? t('chat.attachments.unsupported')
                : null;
        return error ? [{ ...base, status: 'error', error }, null] : [base, file];
      });
      setItems((list) => [...list, ...next.map(([item]) => item)]);
      for (const [item, file] of next) {
        if (!file) continue;
        const controller = new AbortController();
        uploads.current.set(item.key, controller);
        uploadAttachment(file, {
          signal: controller.signal,
          onProgress: (progress) => patch(item.key, { progress }),
        })
          .then((att) =>
            patch(item.key, { status: 'ready', progress: 1, id: att.id, mime: att.mime }),
          )
          .catch((err: unknown) => {
            if (controller.signal.aborted) return;
            patch(item.key, {
              status: 'error',
              error: attachmentErrorText(err, t('chat.attachments.failed')),
            });
          })
          .finally(() => uploads.current.delete(item.key));
      }
    },
    [patch, t],
  );

  const remove = useCallback((key: string) => {
    uploads.current.get(key)?.abort();
    uploads.current.delete(key);
    setItems((list) => list.filter((i) => i.key !== key));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  return {
    items,
    add,
    remove,
    clear,
    readyIds: items.flatMap((i) => (i.status === 'ready' && i.id ? [i.id] : [])),
    uploading: items.some((i) => i.status === 'uploading'),
  };
}

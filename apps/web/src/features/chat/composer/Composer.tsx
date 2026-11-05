import type { ModelInfo, ModelRef, Preset } from '@neotext/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorText } from '../../../lib/api/error-text';
import { useAppCommand } from '../../../lib/app-commands';
import { useT } from '../../../lib/i18n';
import { clearDraft, loadDraft, saveDraft } from '../../../lib/persist/drafts';
import { qk } from '../../../lib/query';
import { useMediaQuery } from '../../../lib/use-media-query';
import { useSettings } from '../../../state/settings';
import { TextArea, toast } from '../../../ui';
import { compareTargets, seedCompareTargets, useCompareState } from '../../compare/compare-state';
import { LazyComparePicker } from '../../compare/LazyComparePicker';
import { setPendingPreset } from '../../presets/use-presets';
import type { SendOptions } from '../streaming/use-chat-stream';
import { AttachButton } from './AttachButton';
import { AttachmentChips } from './AttachmentChips';
import { AttachmentDropZone } from './AttachmentDropZone';
import { useAttachments } from './attachments';
import styles from './Composer.module.css';
import { ComposerToolbar } from './ComposerToolbar';
import { QuotaNotice } from './QuotaNotice';
import { type EffortChoice, effortFor } from './ReasoningSelect';
import { SnippetMenu } from './SnippetMenu';
import { useWebSearch } from './WebSearchToggle';
import { warmProvider } from './warm';

/** What the composer needs from `useChatStream`. */
export interface ComposerStream {
  send(text: string, opts: SendOptions): Promise<boolean>;
  stop(): void;
  generating: boolean;
  /** False while an existing chat's messages load: a send then would lose its context. */
  ready: boolean;
}

export interface ComposerProps {
  /** Null for a new chat. Drafts are kept per chat, and under `new` for a new one. */
  conversationId: string | null;
  /** The model the message goes to; null while none can be chosen. */
  model: ModelInfo | null;
  stream: ComposerStream;
  /** The preset a new chat starts with: sent with the first message. */
  preset?: Preset | null;
}

/** A finger is the main pointer (phones, tablets): the on-screen Enter key is for new lines. */
const TOUCH = '(pointer: coarse)';
const MIN_ROWS = 1;
const MAX_ROWS = 12;

/** Enter during an input method's composition picks a candidate; it must never send. */
function composing(e: KeyboardEvent): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}

export function Composer({ conversationId, model, stream, preset = null }: ComposerProps) {
  const t = useT();
  const sendKey = useSettings((s) => s.settings.chat.sendKey);
  const touch = useMediaQuery(TOUCH);
  /** On a touch screen Enter would send half-written messages; only the button sends there. */
  const enterSends = sendKey === 'enter' && !touch;
  const snippets = useSettings((s) => s.settings.snippets);
  const defaultEffort = useSettings((s) => s.settings.chat.reasoningEffort);
  const draftKey = conversationId ?? 'new';

  const [text, setText] = useState('');
  const textRef = useRef(text);
  textRef.current = text;
  /** Set by the first keystroke, so a draft that loads late never overwrites it. */
  const touched = useRef(false);
  const sending = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useAppCommand('focus-composer', () => field.current?.focus());
  const [picked, setPicked] = useState<EffortChoice | null>(null);
  const effort = effortFor(model?.reasoning ?? null, picked ?? defaultEffort);
  const qc = useQueryClient();
  // The preset seeds only the first message's web toggle: the toggle is per message (R19).
  const webSearch = useWebSearch(model, conversationId, preset?.data.webSearch);
  const searchWeb = webSearch.on;
  const resetWebSearch = webSearch.reset;
  const attachments = useAttachments(conversationId);
  const { readyIds, uploading, clear: clearAttachments } = attachments;

  useEffect(() => {
    touched.current = false;
    let current = true;
    void loadDraft(draftKey).then((draft) => {
      if (current && !touched.current && draft !== '') setText(draft);
    });
    return () => {
      current = false;
    };
  }, [draftKey]);

  const change = (value: string) => {
    touched.current = true;
    setText(value);
    saveDraft(draftKey, value);
  };

  const ref = useMemo<ModelRef | null>(
    () => (model ? { providerId: model.providerId, modelId: model.id } : null),
    [model],
  );
  const compare = useCompareState();
  // Every model a send goes to: the compare choice while compare is on, else the one in use.
  const targets = useMemo(
    () => (compare.enabled ? compareTargets(compare.targets, ref) : ref ? [ref] : []),
    [compare.enabled, compare.targets, ref],
  );
  // Compare turned on from the sidebar has no model yet: the one in use becomes the first.
  useEffect(() => {
    if (ref && compare.enabled && compare.targets.length === 0) seedCompareTargets(ref);
  }, [ref, compare.enabled, compare.targets.length]);
  // Files alone are a message too.
  const hasContent = text.trim() !== '' || readyIds.length > 0;
  const canSend =
    targets.length > 0 && hasContent && !stream.generating && stream.ready && !uploading;

  const submit = useCallback(async () => {
    const body = textRef.current;
    const empty = body.trim() === '' && readyIds.length === 0;
    if (targets.length === 0 || empty || stream.generating || !stream.ready || sending.current) {
      return;
    }
    // Read the preset afresh: it may have been deleted since it was picked.
    const known = qc.getQueryData<Preset[]>(qk.presets);
    if (preset && known && !known.some((p) => p.id === preset.id)) {
      setPendingPreset(null);
      toast({ tone: 'danger', message: t('sidebar.presets.gone') });
      return;
    }
    if (uploading) {
      toast({ message: t('chat.attachments.waiting') });
      return;
    }
    sending.current = true;
    try {
      const started = await stream.send(body.trimEnd(), {
        targets,
        reasoningEffort: effort === 'auto' ? null : effort,
        webSearch: searchWeb,
        ...(preset ? { presetId: preset.id } : {}),
        ...(readyIds.length > 0 ? { attachmentIds: readyIds } : {}),
      });
      // Only an untouched box is emptied: anything typed while the turn started stays.
      if (started) {
        resetWebSearch();
        clearAttachments();
        if (preset) setPendingPreset(null);
      }
      if (started && textRef.current === body) {
        setText('');
        void clearDraft(draftKey);
      }
    } catch (err) {
      // The text stays, so sending again is one key away.
      toast({
        tone: 'danger',
        message: errorText(err, t('common.genericError')),
      });
    } finally {
      sending.current = false;
    }
  }, [
    targets,
    effort,
    searchWeb,
    resetWebSearch,
    readyIds,
    uploading,
    clearAttachments,
    preset,
    qc,
    stream,
    draftKey,
    t,
  ]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || composing(e)) return;
    const chord = e.ctrlKey || e.metaKey;
    const sends = sendKey === 'enter' ? enterSends && !e.shiftKey : chord;
    if (!sends) return;
    e.preventDefault();
    void submit();
  };

  const onEscape = (e: KeyboardEvent<HTMLFormElement>) => {
    // Shift+Escape is the shortcut that jumps here; it must not also stop the answer.
    if (e.key !== 'Escape' || e.shiftKey || e.defaultPrevented || !stream.generating) return;
    e.preventDefault();
    stream.stop();
  };

  return (
    <form
      className={styles.dock}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={onEscape}
    >
      <div className={styles.row}>
        <QuotaNotice targets={targets} />
        <span className={styles.speaker}>{t('chat.you')}</span>
        <AttachmentDropZone className={styles.box} onFiles={attachments.add}>
          <SnippetMenu field={field} text={text} snippets={snippets} onChange={change} />
          {compare.enabled ? (
            <LazyComparePicker value={targets} onChange={compare.setTargets} />
          ) : null}
          <AttachmentChips items={attachments.items} model={model} onRemove={attachments.remove} />
          <TextArea
            ref={field}
            className={styles.field}
            label={t('chat.composer.label')}
            hideLabel
            minRows={MIN_ROWS}
            maxRows={MAX_ROWS}
            placeholder={
              model
                ? t('chat.composer.placeholder', { model: model.name })
                : t('chat.composer.placeholderNoModel')
            }
            value={text}
            dir="auto"
            onChange={(e) => change(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => {
              if (ref) warmProvider(ref.providerId);
            }}
          />
          <ComposerToolbar
            model={model}
            effort={effort}
            onEffort={setPicked}
            webSearch={webSearch}
            compare={compare.enabled}
            onCompare={() => compare.toggle(ref)}
            hint={
              sendKey === 'mod-enter'
                ? t('chat.composer.hintMod')
                : enterSends
                  ? t('chat.composer.hintEnter')
                  : t('chat.composer.hintTouch')
            }
            generating={stream.generating}
            canSend={canSend}
            onStop={stream.stop}
            attach={<AttachButton onFiles={attachments.add} />}
          />
        </AttachmentDropZone>
      </div>
    </form>
  );
}

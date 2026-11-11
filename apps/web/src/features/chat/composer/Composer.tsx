import type { AgentPublic, ModelInfo, ModelRef, Preset } from '@neotext/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  type KeyboardEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { errorText } from '../../../lib/api/error-text';
import { useAppCommand } from '../../../lib/app-commands';
import { useT } from '../../../lib/i18n';
import { clearDraft, loadDraft, saveDraft } from '../../../lib/persist/drafts';
import { qk } from '../../../lib/query';
import { useMediaQuery } from '../../../lib/use-media-query';
import { useSettings } from '../../../state/settings';
import { TextArea, toast } from '../../../ui';
import { useAgents } from '../../agents/use-agents';
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
import { loadDraftAgent, saveDraftAgent } from './draft-agent';
import { QuotaNotice } from './QuotaNotice';
import { type EffortChoice, effortFor } from './reasoning-effort';
import { SnippetMenu } from './SnippetMenu';
import { useWebSearchAvailable } from './use-web-search';
import { warmProvider } from './warm';

// The agent controls load after the composer itself, so the first paint stays small.
const loadPicker = () => import('./AgentPicker');
const AgentButton = lazy(() => loadPicker().then((m) => ({ default: m.AgentButton })));
const AgentChip = lazy(() => loadPicker().then((m) => ({ default: m.AgentChip })));
const AgentMention = lazy(() => loadPicker().then((m) => ({ default: m.AgentMention })));

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
  // Web search is automatic: every message allows it when something can search, and the model
  // decides whether to. A preset's `webSearch` flag (and the old `defaultOn` setting) is kept in
  // the stored data for compatibility but no longer read.
  const searchWeb = useWebSearchAvailable(model);
  const attachments = useAttachments(conversationId);
  const { readyIds, uploading, clear: clearAttachments } = attachments;
  const agentsQuery = useAgents();
  const agents = useMemo(
    () => (agentsQuery.data ?? []).filter((a) => a.data.enabled),
    [agentsQuery.data],
  );
  /** The agent that answers the next message only; kept with the draft over a reload. */
  const [agentId, setAgentId] = useState<string | null>(null);
  const agent = useMemo(() => agents.find((a) => a.id === agentId) ?? null, [agents, agentId]);
  const setAgent = useCallback(
    (picked: AgentPublic | null) => {
      setAgentId(picked?.id ?? null);
      saveDraftAgent(draftKey, picked?.id ?? null);
    },
    [draftKey],
  );

  useEffect(() => {
    touched.current = false;
    setAgentId(loadDraftAgent(draftKey));
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
  // An agent answers alone: compare stays off while one is chosen.
  const comparing = compare.enabled && agent === null;
  // Every model a send goes to: the compare choice while compare is on, else the one in use.
  const targets = useMemo(
    () => (comparing ? compareTargets(compare.targets, ref) : ref ? [ref] : []),
    [comparing, compare.targets, ref],
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
        ...(agent ? { agentId: agent.id } : {}),
        ...(readyIds.length > 0 ? { attachmentIds: readyIds } : {}),
      });
      // Only an untouched box is emptied: anything typed while the turn started stays.
      if (started) {
        clearAttachments();
        setAgent(null);
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
    readyIds,
    uploading,
    clearAttachments,
    preset,
    agent,
    setAgent,
    qc,
    stream,
    draftKey,
    t,
  ]);

  const pickAgent = (picked: AgentPublic) => {
    setAgent(picked);
    if (compare.enabled) compare.toggle(ref);
  };

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
        <AttachmentDropZone className={styles.box} onFiles={attachments.add}>
          <SnippetMenu field={field} text={text} snippets={snippets} onChange={change} />
          {agents.length > 0 ? (
            <Suspense fallback={null}>
              <AgentMention
                field={field}
                text={text}
                agents={agents}
                onPick={(picked, rest) => {
                  pickAgent(picked);
                  change(rest);
                }}
              />
            </Suspense>
          ) : null}
          {comparing ? <LazyComparePicker value={targets} onChange={compare.setTargets} /> : null}
          {agent ? (
            <Suspense fallback={null}>
              <AgentChip
                agent={agent}
                onRemove={() => {
                  setAgent(null);
                  field.current?.focus();
                }}
              />
            </Suspense>
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
              agent
                ? t('chat.agents.placeholder', { agent: agent.name })
                : model
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
            compare={comparing}
            compareBlockedBy={agent ? t('chat.agents.compareOff') : null}
            onCompare={() => compare.toggle(ref)}
            generating={stream.generating}
            canSend={canSend}
            enterSends={sendKey === 'enter'}
            onStop={stream.stop}
            attach={<AttachButton onFiles={attachments.add} />}
            agent={
              <Suspense fallback={null}>
                <AgentButton agents={agents} onPick={pickAgent} />
              </Suspense>
            }
          />
        </AttachmentDropZone>
      </div>
    </form>
  );
}

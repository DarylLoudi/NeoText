import { DotsThree, DownloadSimple, SidebarSimple } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouterState } from '@tanstack/react-router';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../../lib/api/client';
import { conversationsApi } from '../../lib/api/conversations';
import { downloadExport } from '../../lib/api/transfer';
import { formatCost } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { qk } from '../../lib/query';
import { useSettings } from '../../state/settings';
import { IconButton, Menu, Tooltip, toast } from '../../ui';
import { InlineRename } from '../sidebar/ConversationItem';
import { findConversation, useConversationMutations } from '../sidebar/use-conversations';
import styles from './TopBar.module.css';

/* ----------------------------------------------------------------------------------------------
 * Slots: a page puts its model picker and overflow menu into the top bar with <TopBarSlot>.
 * --------------------------------------------------------------------------------------------*/

type SlotName = 'model' | 'menu';
type Slots = Record<SlotName, HTMLElement | null>;

const SlotTargets = createContext<Slots>({ model: null, menu: null });
const SlotSetters = createContext<Record<SlotName, (el: HTMLElement | null) => void> | null>(null);

export function TopBarSlotsProvider({ children }: { children: ReactNode }) {
  const [model, setModel] = useState<HTMLElement | null>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [setters] = useState(() => ({ model: setModel, menu: setMenu }));
  return (
    <SlotSetters.Provider value={setters}>
      <SlotTargets.Provider value={{ model, menu }}>{children}</SlotTargets.Provider>
    </SlotSetters.Provider>
  );
}

export function TopBarSlot({ name, children }: { name: SlotName; children: ReactNode }) {
  const target = useContext(SlotTargets)[name];
  return target ? createPortal(children, target) : null;
}

/* ----------------------------------------------------------------------------------------------
 * Title
 * --------------------------------------------------------------------------------------------*/

function ConversationTitle({ id }: { id: string }) {
  const t = useT();
  const qc = useQueryClient();
  const { rename } = useConversationMutations();
  const [editing, setEditing] = useState(false);
  const hintId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    buttonRef.current?.focus();
  }, [editing]);
  const detail = useQuery({
    queryKey: qk.conversation(id),
    queryFn: () => conversationsApi.detail(id),
  });
  const summary = detail.data?.conversation ?? findConversation(qc, id);
  if (!summary) return <h1 className={styles.title}>{' '}</h1>;
  const title = summary.title ?? t('sidebar.newChat');
  if (editing) {
    return (
      <InlineRename
        className={styles.rename}
        value={summary.title ?? ''}
        label={t('sidebar.titleLabel')}
        onSave={(next) => void rename(id, next)}
        onDone={(byKeyboard) => {
          refocus.current = byKeyboard;
          setEditing(false);
        }}
      />
    );
  }
  return (
    <>
      <h1 className={styles.title}>
        <Tooltip content={t('shell.renameHint')} side="bottom">
          <button
            ref={buttonRef}
            type="button"
            className={styles.titleButton}
            aria-describedby={hintId}
            onClick={() => setEditing(true)}
            dir="auto"
          >
            {title}
          </button>
        </Tooltip>
      </h1>
      <span id={hintId} className={styles.hint}>
        {t('shell.renameHint')}
      </span>
    </>
  );
}

/** The chat's total: every answer in every branch, from the costs the providers reported. */
function ConversationCost({ id }: { id: string }) {
  const t = useT();
  const showCost = useSettings((s) => s.settings.appearance.showCost);
  const detail = useQuery({
    queryKey: qk.conversation(id),
    queryFn: () => conversationsApi.detail(id),
    enabled: showCost,
  });
  if (!showCost) return null;
  const costs = (detail.data?.messages ?? []).flatMap((m) =>
    m.usage?.costUsd != null ? [m.usage.costUsd] : [],
  );
  if (costs.length === 0) return null;
  const cost = formatCost(costs.reduce((a, b) => a + b, 0));
  return (
    <span className={styles.cost}>
      <span aria-hidden>{cost}</span>
      <span className={styles.hint}>{t('settings.usage.chatCost', { cost })}</span>
    </span>
  );
}

function PageTitle() {
  const t = useT();
  const params = useParams({ strict: false }) as { conversationId?: string };
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (params.conversationId) {
    return (
      <>
        <ConversationTitle id={params.conversationId} />
        <ConversationCost id={params.conversationId} />
      </>
    );
  }
  const text = pathname.startsWith('/settings')
    ? t('settings.title')
    : pathname.startsWith('/usage')
      ? t('settings.usage.title')
      : t('sidebar.newChat');
  return <h1 className={styles.title}>{text}</h1>;
}

/** The overflow menu of an open chat. */
function ConversationMenu() {
  const t = useT();
  const params = useParams({ strict: false }) as { conversationId?: string };
  const id = params.conversationId;
  if (!id) return null;
  async function exportChat(conversationId: string) {
    try {
      await downloadExport({ format: 'markdown', conversationId });
      toast({ message: t('shell.exportedChat'), tone: 'success' });
    } catch (err) {
      toast({
        message: err instanceof ApiError ? err.message : t('common.genericError'),
        tone: 'danger',
      });
    }
  }
  return (
    <Menu
      align="end"
      items={[
        {
          label: t('shell.exportChat'),
          icon: <DownloadSimple />,
          onSelect: () => void exportChat(id),
        },
      ]}
      trigger={<IconButton label={t('shell.moreActions')} icon={<DotsThree />} />}
    />
  );
}

export interface TopBarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  /** The id of the sidebar element the toggle controls. */
  sidebarId: string;
}

export function TopBar({ sidebarOpen, onToggleSidebar, sidebarId }: TopBarProps) {
  const t = useT();
  const setters = useContext(SlotSetters);
  return (
    <header className={styles.bar}>
      <IconButton
        label={sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')}
        icon={<SidebarSimple />}
        onClick={onToggleSidebar}
        aria-expanded={sidebarOpen}
        aria-controls={sidebarId}
      />
      <div className={styles.titleWrap}>
        <PageTitle />
      </div>
      <div className={styles.slot} ref={setters?.model} />
      <div className={styles.slot} ref={setters?.menu} />
      <ConversationMenu />
    </header>
  );
}

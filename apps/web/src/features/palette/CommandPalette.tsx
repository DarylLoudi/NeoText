import type { ConversationSummary, ModelInfo } from '@neotext/shared';
import { modelKey } from '@neotext/shared';
import { ChatText, Cpu, MagnifyingGlass, Terminal } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Command } from 'cmdk';
import { Dialog as D } from 'radix-ui';
import { type ReactNode, useMemo, useState } from 'react';
import { hasAppCommand, runAppCommand } from '../../lib/app-commands';
import { formatCombo, IS_MAC, resolveShortcuts } from '../../lib/hotkeys';
import { useT } from '../../lib/i18n';
import { updateSettings, useSettings } from '../../state/settings';
import { Kbd } from '../../ui';
import { searchModels, toRef } from '../chat/composer/model-search';
import { useModels } from '../chat/composer/use-models';
import { setPendingPreset } from '../presets/use-presets';
import styles from './CommandPalette.module.css';
import { buildCommands, cachedChats, matchesQuery, type PaletteCommand } from './commands';
import { useChatSearch } from './use-chat-search';

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MODELS_SHOWN = 6;
const MODELS_SHOWN_WITH_QUERY = 10;

function Row({
  value,
  icon,
  onSelect,
  children,
  aside,
}: {
  value: string;
  icon: ReactNode;
  onSelect: () => void;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <Command.Item value={value} onSelect={onSelect} className={styles.item}>
      <span className={styles.icon} aria-hidden>
        {icon}
      </span>
      <span className={styles.label} dir="auto">
        {children}
      </span>
      {aside ? <span className={styles.aside}>{aside}</span> : null}
    </Command.Item>
  );
}

function Keys({ combo }: { combo: string }) {
  return (
    <span className={styles.keys}>
      {formatCombo(combo, IS_MAC).map((key, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length list rebuilt as a whole
        <Kbd key={`${i}:${key}`}>{key}</Kbd>
      ))}
    </span>
  );
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const t = useT();
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={styles.overlay} />
        <D.Content className={styles.content}>
          <D.Title className={styles.hidden}>{t('shell.palette.title')}</D.Title>
          <D.Description className={styles.hidden}>{t('shell.palette.description')}</D.Description>
          <PaletteBody close={() => onOpenChange(false)} />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Mounted only while the palette is open, so each opening starts from an empty search. */
function PaletteBody({ close }: { close: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const theme = useSettings((s) => s.settings.appearance.theme);
  const overrides = useSettings((s) => s.settings.shortcuts);
  const favorites = useSettings((s) => s.settings.models.favorites);
  const bindings = useMemo(() => resolveShortcuts(overrides), [overrides]);

  // A snapshot taken as the palette opens: what the sidebar has loaded by now.
  const cached = useMemo(() => cachedChats(qc), [qc]);
  const chats = useChatSearch(query, cached);
  const catalog = useModels();
  // Models can be switched only where a chat is open to take the choice.
  const canSwitchModel = hasAppCommand('switch-model');

  const commands = useMemo(
    () =>
      buildCommands({
        t,
        theme,
        newChat: () => {
          setPendingPreset(null);
          void navigate({ to: '/' });
        },
        toggleSidebar: () => runAppCommand('toggle-sidebar'),
        openSettings: (section) => void navigate({ to: '/settings/$section', params: { section } }),
        setTheme: (next) => updateSettings({ appearance: { theme: next } }),
      }),
    [t, theme, navigate],
  );
  const shownCommands = useMemo(
    () => commands.filter((c) => matchesQuery(query, c.label, ...c.keywords)),
    [commands, query],
  );

  const models = useMemo(() => {
    if (!canSwitchModel) return [];
    const found = searchModels(catalog.models, query, new Set(favorites));
    return found.slice(0, query.trim() === '' ? MODELS_SHOWN : MODELS_SHOWN_WITH_QUERY);
  }, [canSwitchModel, catalog.models, query, favorites]);
  const providerName = (m: ModelInfo) =>
    catalog.providers.find((p) => p.providerId === m.providerId)?.providerName ?? '';

  const run = (action: () => void) => {
    close();
    action();
  };
  const openChat = (c: ConversationSummary) =>
    run(() => void navigate({ to: '/c/$conversationId', params: { conversationId: c.id } }));
  const chatRow = (c: ConversationSummary) => (
    <Row
      key={c.id}
      value={`chat:${c.id}`}
      icon={<ChatText />}
      onSelect={() => openChat(c)}
      aside={c.archived ? t('sidebar.sections.archived') : undefined}
    >
      {c.title ?? t('shell.palette.untitled')}
    </Row>
  );

  const hasChats = chats.loaded.length + chats.older.length > 0;
  const nothing = shownCommands.length === 0 && models.length === 0 && !hasChats;
  const trimmed = query.trim();

  return (
    <Command
      className={styles.command}
      label={t('shell.palette.inputLabel')}
      shouldFilter={false}
      vimBindings={false}
      loop
    >
      <div className={styles.inputRow}>
        <MagnifyingGlass className={styles.searchIcon} aria-hidden />
        <Command.Input
          className={styles.input}
          value={query}
          onValueChange={setQuery}
          placeholder={t('shell.palette.placeholder')}
          autoFocus
        />
        <Kbd>Esc</Kbd>
      </div>
      <Command.List className={styles.list} label={t('shell.palette.listLabel')}>
        {shownCommands.length > 0 ? (
          <Command.Group heading={t('shell.palette.groups.actions')} className={styles.group}>
            {shownCommands.map((c: PaletteCommand) => (
              <Row
                key={c.id}
                value={`cmd:${c.id}`}
                icon={<Terminal />}
                onSelect={() => run(c.run)}
                aside={c.shortcut ? <Keys combo={bindings[c.shortcut]} /> : undefined}
              >
                {c.label}
              </Row>
            ))}
          </Command.Group>
        ) : null}
        {models.length > 0 ? (
          <Command.Group heading={t('shell.palette.groups.models')} className={styles.group}>
            {models.map((m) => (
              <Row
                key={modelKey(toRef(m))}
                value={`model:${modelKey(toRef(m))}`}
                icon={<Cpu />}
                onSelect={() => run(() => runAppCommand('switch-model', toRef(m)))}
                aside={providerName(m)}
              >
                {t('shell.palette.useModel', { model: m.name })}
              </Row>
            ))}
          </Command.Group>
        ) : null}
        {hasChats ? (
          <Command.Group heading={t('shell.palette.groups.chats')} className={styles.group}>
            {chats.loaded.map(chatRow)}
            {chats.older.map(chatRow)}
          </Command.Group>
        ) : null}
      </Command.List>
      {nothing && !chats.searching ? (
        <p className={styles.note} role="status">
          {t('shell.palette.empty', { query: trimmed })}
        </p>
      ) : null}
      {chats.searching ? (
        <p className={styles.note} role="status">
          {t('shell.palette.searching')}
        </p>
      ) : null}
      {chats.mayHaveMore ? <p className={styles.note}>{t('shell.palette.moreChats')}</p> : null}
    </Command>
  );
}

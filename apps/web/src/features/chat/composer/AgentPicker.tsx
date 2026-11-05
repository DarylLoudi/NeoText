import type { AgentPublic } from '@neotext/shared';
import { Robot, X } from '@phosphor-icons/react';
import { type RefObject, useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../../lib/i18n';
import { IconButton, Menu } from '../../../ui';
import styles from './AgentPicker.module.css';

/** The word after an `@` that starts the message, up to the cursor; null when there is none. */
export function mentionQuery(text: string, cursor: number): string | null {
  const match = /^@([^\s@]*)$/.exec(text.slice(0, cursor));
  return match ? (match[1] ?? '') : null;
}

/** Agents whose name holds the query, those that start with it first. */
export function matchAgents(agents: AgentPublic[], query: string): AgentPublic[] {
  const q = query.toLowerCase();
  const hits = agents.filter((a) => a.name.toLowerCase().includes(q));
  const starts = (a: AgentPublic) => (a.name.toLowerCase().startsWith(q) ? 0 : 1);
  return hits.sort((a, b) => starts(a) - starts(b));
}

export interface AgentButtonProps {
  /** Enabled agents only. */
  agents: AgentPublic[];
  onPick: (agent: AgentPublic) => void;
}

/** The toolbar's "Agent": a menu of the agents that can answer the next message. */
export function AgentButton({ agents, onPick }: AgentButtonProps) {
  const t = useT();
  const items =
    agents.length > 0
      ? agents.map((a) => ({
          id: a.id,
          label: a.name,
          icon: <Robot aria-hidden />,
          onSelect: () => onPick(a),
        }))
      : [{ id: 'none', label: t('chat.agents.none'), onSelect: () => {}, disabled: true }];
  return (
    <Menu
      side="top"
      items={items}
      trigger={
        <button type="button" className={styles.toggle}>
          <Robot aria-hidden className={styles.icon} />
          {t('chat.agents.button')}
        </button>
      }
    />
  );
}

export interface AgentChipProps {
  agent: AgentPublic;
  onRemove: () => void;
}

/** The chosen agent, above the text; it answers this one message. */
export function AgentChip({ agent, onRemove }: AgentChipProps) {
  const t = useT();
  return (
    <div className={styles.chips}>
      <span className={styles.chip} title={t('chat.agents.chip', { agent: agent.name })}>
        <Robot aria-hidden className={styles.chipIcon} weight="bold" />
        <span className={styles.chipName} dir="auto">
          {agent.name}
        </span>
        <IconButton
          size="sm"
          className={styles.remove}
          label={t('chat.agents.remove', { agent: agent.name })}
          icon={<X />}
          onClick={onRemove}
        />
      </span>
    </div>
  );
}

export interface AgentMentionProps {
  /** The message box; its keys are handled here while the list is open. */
  field: RefObject<HTMLTextAreaElement | null>;
  text: string;
  agents: AgentPublic[];
  /** The agent picked, and the text without its `@word`. */
  onPick: (agent: AgentPublic, rest: string) => void;
}

/** A list above the message box while the message starts with `@word`. */
export function AgentMention({ field, text, agents, onPick }: AgentMentionProps) {
  const t = useT();
  const listId = useId();
  const [cursor, setCursor] = useState(text.length);
  const [active, setActive] = useState(0);
  /** Closed with Escape; it stays closed until the `@word` ends. */
  const [dismissed, setDismissed] = useState(false);
  const [focused, setFocused] = useState(false);

  const query = mentionQuery(text, cursor);
  const matches = query === null ? [] : matchAgents(agents, query);
  const open = query !== null && matches.length > 0 && !dismissed && focused;

  // `text` is a dependency on purpose: typing moves the cursor.
  useEffect(() => {
    setCursor(field.current?.selectionStart ?? text.length);
  }, [text, field]);
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    const sync = () => setCursor(el.selectionStart);
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    setFocused(document.activeElement === el);
    el.addEventListener('click', sync);
    el.addEventListener('keyup', sync);
    el.addEventListener('focus', on);
    el.addEventListener('blur', off);
    return () => {
      el.removeEventListener('focus', on);
      el.removeEventListener('blur', off);
      el.removeEventListener('click', sync);
      el.removeEventListener('keyup', sync);
    };
  }, [field]);
  useEffect(() => {
    if (query === null) setDismissed(false);
  }, [query]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new word starts at the top
  useEffect(() => setActive(0), [query]);

  function pick(agent: AgentPublic) {
    const rest = text.slice(cursor).trimStart();
    onPick(agent, rest);
    setCursor(0);
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(0, 0);
    });
  }

  // Native, so the keys are taken before the composer's own handlers see them.
  const latest = useRef({ open, matches, active, pick });
  latest.current = { open, matches, active, pick };
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const { open: isOpen, matches: list, active: index, pick: choose } = latest.current;
      if (!isOpen || e.isComposing || e.keyCode === 229) return;
      const take = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      // Ctrl or Cmd with Enter is the send chord, never a pick.
      if ((e.key === 'Enter' || e.key === 'Tab') && (e.ctrlKey || e.metaKey)) return;
      if (e.key === 'ArrowDown') {
        take();
        setActive((index + 1) % list.length);
      } else if (e.key === 'ArrowUp') {
        take();
        setActive((index - 1 + list.length) % list.length);
      } else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        take();
        const chosen = list[index];
        if (chosen) choose(chosen);
      } else if (e.key === 'Escape') {
        take();
        setDismissed(true);
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [field]);

  // The box tells assistive technology which option is current.
  useEffect(() => {
    const el = field.current;
    if (!el || !open) return;
    el.setAttribute('role', 'combobox');
    el.setAttribute('aria-autocomplete', 'list');
    el.setAttribute('aria-expanded', 'true');
    el.setAttribute('aria-controls', listId);
    el.setAttribute('aria-activedescendant', `${listId}-${active}`);
    return () => {
      el.removeAttribute('role');
      el.removeAttribute('aria-autocomplete');
      el.removeAttribute('aria-expanded');
      el.removeAttribute('aria-controls');
      el.removeAttribute('aria-activedescendant');
    };
  }, [open, active, listId, field]);

  if (!open) return null;
  return (
    <div
      id={listId}
      role="listbox"
      className={styles.menu}
      aria-label={t('chat.agents.suggestions')}
    >
      {matches.map((a, i) => (
        // Keys are handled on the text box, which keeps focus and names the option.
        // biome-ignore lint/a11y/useFocusableInteractive: focus stays in the text box
        <div
          key={a.id}
          id={`${listId}-${i}`}
          role="option"
          aria-selected={i === active}
          className={styles.option}
          // Mouse down, so the box keeps focus.
          onMouseDown={(e) => {
            e.preventDefault();
            pick(a);
          }}
          onMouseEnter={() => setActive(i)}
        >
          <Robot aria-hidden className={styles.optionIcon} />
          <span className={styles.name} dir="auto">
            {a.name}
          </span>
          {a.data.description ? (
            <span className={styles.description} dir="auto">
              {a.data.description}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

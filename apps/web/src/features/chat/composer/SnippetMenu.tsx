import type { Snippet } from '@neotext/shared';
import { type RefObject, useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../../lib/i18n';
import styles from './SnippetMenu.module.css';
import { SnippetVariablesDialog } from './SnippetVariablesDialog';
import { extractVariables, fillVariables, lineStart, matchSnippets, slashQuery } from './snippets';

export interface SnippetMenuProps {
  /** The message box the menu belongs to; its keys are handled here while the menu is open. */
  field: RefObject<HTMLTextAreaElement | null>;
  text: string;
  snippets: Snippet[];
  /** The new text of the box after a snippet went in. */
  onChange: (text: string) => void;
}

/** What a pick replaces: from the line's slash to where the cursor was. */
interface Range {
  from: number;
  to: number;
}

/** A list above the message box while a `/word` starts a line; picking one inserts its text. */
export function SnippetMenu({ field, text, snippets, onChange }: SnippetMenuProps) {
  const t = useT();
  const listId = useId();
  const [cursor, setCursor] = useState(text.length);
  const [active, setActive] = useState(0);
  /** Line start of a menu closed with Escape; it stays closed until the slash word ends. */
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [asking, setAsking] = useState<{ snippet: Snippet; range: Range } | null>(null);

  const query = slashQuery(text, cursor);
  const start = lineStart(text, cursor);
  const matches = query === null ? [] : matchSnippets(snippets, query);
  const open = query !== null && matches.length > 0 && dismissed !== start && focused && !asking;

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
    if (query === null) setDismissed(null);
  }, [query]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new word starts at the top
  useEffect(() => setActive(0), [query]);

  function insert(body: string, range: Range) {
    const next = text.slice(0, range.from) + body + text.slice(range.to);
    const caret = range.from + body.length;
    onChange(next);
    setCursor(caret);
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(caret, caret);
    });
  }

  function pick(snippet: Snippet) {
    const range = { from: start, to: cursor };
    if (extractVariables(snippet.body).length > 0) setAsking({ snippet, range });
    else insert(snippet.body, range);
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
        setDismissed(lineStart(el.value, el.selectionStart));
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [field]);

  // The box tells assistive technology which option is current.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    if (open) {
      // A combobox while the list is shown, so the attributes below are valid on it.
      el.setAttribute('role', 'combobox');
      el.setAttribute('aria-autocomplete', 'list');
      el.setAttribute('aria-expanded', 'true');
      el.setAttribute('aria-controls', listId);
      el.setAttribute('aria-activedescendant', `${listId}-${active}`);
    } else {
      el.removeAttribute('role');
      el.removeAttribute('aria-autocomplete');
      el.removeAttribute('aria-expanded');
      el.removeAttribute('aria-controls');
      el.removeAttribute('aria-activedescendant');
    }
  }, [open, active, listId, field]);

  return (
    <>
      {open ? (
        <div
          id={listId}
          role="listbox"
          className={styles.menu}
          aria-label={t('chat.snippets.menu')}
        >
          {matches.map((s, i) => (
            // Keys are handled on the text box, which keeps focus and names the option.
            // biome-ignore lint/a11y/useFocusableInteractive: focus stays in the text box
            <div
              key={s.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={styles.option}
              // Mouse down, so the box keeps focus.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className={styles.trigger}>/{s.trigger}</span>
              <span className={styles.title}>{s.title}</span>
            </div>
          ))}
        </div>
      ) : null}
      {asking ? (
        <SnippetVariablesDialog
          title={asking.snippet.title}
          names={extractVariables(asking.snippet.body)}
          onSubmit={(values) => {
            insert(fillVariables(asking.snippet.body, values), asking.range);
            setAsking(null);
          }}
          onCancel={() => {
            setAsking(null);
            requestAnimationFrame(() => field.current?.focus());
          }}
        />
      ) : null}
    </>
  );
}

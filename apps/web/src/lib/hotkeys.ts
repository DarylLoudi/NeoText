import { tinykeys } from 'tinykeys';

/** Every action that can have a shortcut. */
export const ACTION_IDS = [
  'palette',
  'new-chat',
  'toggle-sidebar',
  'focus-composer',
  'settings',
  'shortcuts-help',
  'search',
] as const;
export type ActionId = (typeof ACTION_IDS)[number];

export const isActionId = (value: string): value is ActionId =>
  (ACTION_IDS as readonly string[]).includes(value);

/**
 * Combos are written the way tinykeys reads them: modifiers joined by `+`, then a
 * `KeyboardEvent.code` (`KeyK`, `Comma`) or key name (`Escape`). `$mod` is Cmd on a Mac and
 * Ctrl elsewhere.
 */
export const DEFAULT_SHORTCUTS: Record<ActionId, string> = {
  palette: '$mod+KeyK',
  'new-chat': '$mod+Shift+KeyO',
  'toggle-sidebar': '$mod+KeyB',
  'focus-composer': 'Shift+Escape',
  settings: '$mod+Comma',
  'shortcuts-help': '$mod+Slash',
  search: '$mod+Shift+KeyF',
};

export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

/**
 * The defaults with the user's changes on top. Unknown actions, blank combos and combos that
 * would break typing (see `isUsableCombo`) are ignored, so a bad stored value never takes
 * Ctrl+V or Escape away from a text field.
 */
export function resolveShortcuts(
  overrides: Readonly<Record<string, string>> = {},
  isMac: boolean = IS_MAC,
): Record<ActionId, string> {
  const resolved = { ...DEFAULT_SHORTCUTS };
  for (const id of ACTION_IDS) {
    const combo = overrides[id]?.trim();
    if (combo && isUsableCombo(combo, isMac)) resolved[id] = combo;
  }
  return resolved;
}

const MODIFIER_ORDER = ['$mod', 'Control', 'Meta', 'Alt', 'Shift'];

/** One spelling per chord, so `Shift+$mod+keyo` and `$mod+Shift+KeyO` compare equal. */
function normalize(combo: string): string {
  const parts = combo.split('+');
  const key = (parts.pop() ?? '').toLowerCase();
  const mods = parts.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  return [...mods, key].join('+');
}

/** Whether two spellings are the same chord. */
export function sameCombo(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

/** The other action that already uses `combo`, if any. */
export function findConflict(
  bindings: Readonly<Record<ActionId, string>>,
  actionId: ActionId,
  combo: string,
): ActionId | null {
  for (const id of ACTION_IDS) {
    if (id !== actionId && sameCombo(bindings[id], combo)) return id;
  }
  return null;
}

const KEY_NAMES: Record<string, string> = {
  Escape: 'Esc',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** The labels for each key of a combo, to show as keycaps: `['⌘', '⇧', 'O']` or `['Ctrl', …]`. */
export function formatCombo(combo: string, isMac: boolean): string[] {
  const mac: Record<string, string> = {
    $mod: '⌘',
    Meta: '⌘',
    Control: '⌃',
    Alt: '⌥',
    Shift: '⇧',
  };
  const other: Record<string, string> = {
    $mod: 'Ctrl',
    Meta: 'Win',
    Control: 'Ctrl',
    Alt: 'Alt',
    Shift: 'Shift',
  };
  return combo.split('+').map((part) => {
    const mod = (isMac ? mac : other)[part];
    if (mod) return mod;
    if (/^Key[A-Z]$/.test(part)) return part.slice(3);
    if (/^Digit\d$/.test(part)) return part.slice(5);
    return KEY_NAMES[part] ?? part;
  });
}

/** Keycaps as one phrase for a sentence or a tooltip: `Ctrl+K`, `⌘K`. */
export function describeCombo(combo: string, isMac: boolean): string {
  return formatCombo(combo, isMac).join(isMac ? '' : '+');
}

/** The combo as `aria-keyshortcuts` writes it: `Control+K`, `Meta+Shift+O`. */
export function ariaKeyShortcuts(combo: string, isMac: boolean): string {
  return combo
    .split('+')
    .map((part) => {
      if (part === '$mod') return isMac ? 'Meta' : 'Control';
      if (/^Key[A-Z]$/.test(part)) return part.slice(3);
      if (/^Digit\d$/.test(part)) return part.slice(5);
      // Punctuation is its character; names such as Escape and ArrowUp stay as they are.
      const name = KEY_NAMES[part];
      return name !== undefined && /^[!-~]$/.test(name) ? name : part;
    })
    .join('+');
}

const EDITING_LETTERS = new Set(['C', 'V', 'X', 'A', 'Z', 'Y']);
/** Cocoa text fields: Control+letter moves the cursor or edits (A, E, K, N, P, B, F, D, H, O, T). */
const MAC_CONTROL_LETTERS = new Set(['A', 'E', 'K', 'N', 'P', 'B', 'F', 'D', 'H', 'O', 'T']);

/**
 * Chords that text fields already use for editing: copy, paste, cut, select all, undo, redo
 * (Shift variants too), and on a Mac the Control+letter cursor keys. A shortcut on one would
 * take that editing key away, because shortcuts with Ctrl or Cmd also fire while typing.
 */
export function isReservedCombo(combo: string, isMac: boolean): boolean {
  const parts = combo.split('+');
  const letter = /^key([a-z])$/i.exec(parts.pop() ?? '')?.[1]?.toUpperCase();
  if (!letter) return false;
  // Spelled-out Ctrl (or Cmd on a Mac) is the same key as `$mod`.
  const mods = new Set(parts.map((p) => (p === (isMac ? 'Meta' : 'Control') ? '$mod' : p)));
  mods.delete('Shift');
  if (mods.size !== 1) return false;
  if (mods.has('$mod')) return EDITING_LETTERS.has(letter);
  return isMac && mods.has('Control') && MAC_CONTROL_LETTERS.has(letter);
}

/** Needs Ctrl, Alt or Cmd; Escape may use Shift instead (the default for the message box). */
function hasChordModifier(combo: string): boolean {
  const parts = combo.split('+');
  const key = parts.pop();
  if (parts.some((p) => p !== 'Shift')) return true;
  return key === 'Escape' && parts.includes('Shift');
}

/** Whether a stored or captured combo is safe to bind: a real chord, not an editing key. */
export function isUsableCombo(combo: string, isMac: boolean): boolean {
  return hasChordModifier(combo) && !isReservedCombo(combo, isMac);
}

const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|AltGraph|OS)(Left|Right)?$/;

/** A press of Ctrl, Shift, Alt or Cmd on its own: the start of a chord, not yet a combo. */
export function isModifierPress(e: KeyboardEvent): boolean {
  return (
    MODIFIER_CODES.test(e.code) || ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)
  );
}

/**
 * The combo a key press spells, for rebinding. Null while only modifiers are down, and for
 * chords that would eat typing: a key alone, or with Shift alone (Shift+Escape is the one
 * exception). Editing chords such as Ctrl+V are still returned; check them with
 * `isReservedCombo`, which names the reason.
 */
export function comboFromEvent(e: KeyboardEvent, isMac: boolean): string | null {
  if (!e.code || isModifierPress(e)) return null;
  const mods: string[] = [];
  // Cmd on a Mac and Ctrl elsewhere is the shortcut key; the other one keeps its own name.
  if (isMac ? e.metaKey : e.ctrlKey) mods.push('$mod');
  if (isMac ? e.ctrlKey : e.metaKey) mods.push(isMac ? 'Control' : 'Meta');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const combo = [...mods, e.code].join('+');
  return hasChordModifier(combo) ? combo : null;
}

const EDITABLE = '[contenteditable]:not([contenteditable="false"]),input,select,textarea';

/** Chords with Ctrl or Cmd, and Escape, cannot be mistaken for typing. */
export function allowedInTextField(combo: string): boolean {
  const parts = combo.split('+');
  const key = parts.at(-1);
  return key === 'Escape' || parts.some((p) => p === '$mod' || p === 'Control' || p === 'Meta');
}

/** Cmd on a Mac, Ctrl elsewhere: the same choice `formatCombo` makes. */
function toTinykeys(combo: string, isMac: boolean): string {
  return combo.replaceAll('$mod', isMac ? 'Meta' : 'Control');
}

/**
 * Listens for each action's combo on the window and runs its handler. Typing is never
 * interrupted: while a text field has focus only Ctrl/Cmd chords and Escape fire. Nothing
 * fires while an input method is composing, or on key repeat. Returns a function that stops
 * listening.
 */
export function bindShortcuts(
  handlers: Partial<Record<ActionId, () => void>>,
  overrides: Readonly<Record<string, string>> = {},
  isMac: boolean = IS_MAC,
): () => void {
  const combos = resolveShortcuts(overrides, isMac);
  const stops: (() => void)[] = [];
  for (const id of ACTION_IDS) {
    const handler = handlers[id];
    if (!handler) continue;
    const combo = combos[id];
    const inFields = allowedInTextField(combo);
    stops.push(
      tinykeys(
        window,
        {
          [toTinykeys(combo, isMac)]: (e) => {
            e.preventDefault();
            handler();
          },
        },
        {
          ignore: (e) =>
            e.repeat ||
            e.isComposing ||
            e.keyCode === 229 ||
            (!inFields && e.target instanceof Element && e.target.matches(EDITABLE)),
        },
      ),
    );
  }
  return () => {
    for (const stop of stops) stop();
  };
}

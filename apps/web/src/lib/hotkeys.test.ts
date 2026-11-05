import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  type ActionId,
  allowedInTextField,
  bindShortcuts,
  comboFromEvent,
  DEFAULT_SHORTCUTS,
  findConflict,
  formatCombo,
  isReservedCombo,
  resolveShortcuts,
} from './hotkeys';

test('overrides win', () => {
  expect(resolveShortcuts({ palette: '$mod+KeyP' }).palette).toBe('$mod+KeyP');
  expect(resolveShortcuts({ palette: '$mod+KeyP' })['new-chat']).toBe(
    DEFAULT_SHORTCUTS['new-chat'],
  );
});

test('unknown actions and blank combos in the overrides are ignored', () => {
  const resolved = resolveShortcuts({ warp: '$mod+KeyW', palette: '  ' });
  expect(resolved).toEqual(DEFAULT_SHORTCUTS);
});

test('overrides that would break typing are ignored', () => {
  const resolved = resolveShortcuts({ palette: '$mod+KeyV', 'new-chat': 'Escape' }, false);
  expect(resolved.palette).toBe(DEFAULT_SHORTCUTS.palette);
  expect(resolved['new-chat']).toBe(DEFAULT_SHORTCUTS['new-chat']);
  expect(resolveShortcuts({ palette: 'Control+KeyE' }, true).palette).toBe(
    DEFAULT_SHORTCUTS.palette,
  );
  // Ctrl+E moves the cursor only on a Mac; elsewhere it is a free chord.
  expect(resolveShortcuts({ palette: 'Control+KeyE' }, false).palette).toBe('Control+KeyE');
});

test('conflicts are found', () => {
  expect(findConflict(DEFAULT_SHORTCUTS, 'palette', '$mod+KeyB')).toBe('toggle-sidebar');
  expect(findConflict(DEFAULT_SHORTCUTS, 'palette', '$mod+KeyP')).toBeNull();
  // Its own current combo is not a conflict.
  expect(findConflict(DEFAULT_SHORTCUTS, 'palette', '$mod+KeyK')).toBeNull();
});

test('conflicts ignore case and the order of modifiers', () => {
  expect(findConflict(DEFAULT_SHORTCUTS, 'palette', 'Shift+$mod+keyo')).toBe('new-chat');
});

test('formats for mac and others', () => {
  expect(formatCombo('$mod+Shift+KeyO', true)).toEqual(['⌘', '⇧', 'O']);
  expect(formatCombo('$mod+Shift+KeyO', false)).toEqual(['Ctrl', 'Shift', 'O']);
  expect(formatCombo('$mod+Comma', false)).toEqual(['Ctrl', ',']);
  expect(formatCombo('Shift+Escape', true)).toEqual(['⇧', 'Esc']);
  expect(formatCombo('Alt+Digit1', true)).toEqual(['⌥', '1']);
  expect(formatCombo('Alt+Digit1', false)).toEqual(['Alt', '1']);
});

describe('text fields', () => {
  test('only chords with Ctrl or Cmd, and Escape, work while typing', () => {
    expect(allowedInTextField('$mod+KeyK')).toBe(true);
    expect(allowedInTextField('Control+KeyK')).toBe(true);
    expect(allowedInTextField('Shift+Escape')).toBe(true);
    expect(allowedInTextField('Alt+KeyK')).toBe(false);
    expect(allowedInTextField('Shift+KeyK')).toBe(false);
  });
});

describe('isReservedCombo', () => {
  test.each(['KeyC', 'KeyV', 'KeyX', 'KeyA', 'KeyZ', 'KeyY'])(
    'Ctrl or Cmd with %s is for editing text',
    (code) => {
      expect(isReservedCombo(`$mod+${code}`, false)).toBe(true);
      expect(isReservedCombo(`$mod+${code}`, true)).toBe(true);
    },
  );

  test('so are the Shift versions (redo, paste without formatting)', () => {
    expect(isReservedCombo('$mod+Shift+KeyZ', false)).toBe(true);
    expect(isReservedCombo('Shift+$mod+KeyV', false)).toBe(true);
  });

  test('Ctrl and Meta spelled out count as the shortcut key where they are one', () => {
    expect(isReservedCombo('Control+KeyV', false)).toBe(true);
    expect(isReservedCombo('Meta+KeyV', true)).toBe(true);
    expect(isReservedCombo('Meta+KeyV', false)).toBe(false);
  });

  test.each(['KeyA', 'KeyE', 'KeyK', 'KeyN', 'KeyP'])(
    'on a Mac, Control with %s moves the cursor',
    (code) => {
      expect(isReservedCombo(`Control+${code}`, true)).toBe(true);
      expect(isReservedCombo(`Control+${code}`, false)).toBe(code === 'KeyA');
    },
  );

  test('other chords are free', () => {
    expect(isReservedCombo('$mod+KeyK', false)).toBe(false);
    expect(isReservedCombo('$mod+Comma', true)).toBe(false);
    expect(isReservedCombo('$mod+Alt+KeyV', false)).toBe(false);
    expect(isReservedCombo('$mod+Shift+KeyO', false)).toBe(false);
  });
});

describe('comboFromEvent', () => {
  const press = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

  test('writes the chord the user pressed', () => {
    expect(comboFromEvent(press({ code: 'KeyP', ctrlKey: true }), false)).toBe('$mod+KeyP');
    expect(comboFromEvent(press({ code: 'KeyP', metaKey: true, shiftKey: true }), true)).toBe(
      '$mod+Shift+KeyP',
    );
    expect(comboFromEvent(press({ code: 'Escape', shiftKey: true }), false)).toBe('Shift+Escape');
  });

  test('bare Escape and bare function keys are not combos', () => {
    expect(comboFromEvent(press({ code: 'Escape' }), false)).toBeNull();
    expect(comboFromEvent(press({ code: 'F5' }), false)).toBeNull();
    expect(comboFromEvent(press({ code: 'F5', shiftKey: true }), false)).toBeNull();
    expect(comboFromEvent(press({ code: 'F5', ctrlKey: true }), false)).toBe('$mod+F5');
    expect(comboFromEvent(press({ code: 'Escape', ctrlKey: true }), false)).toBe('$mod+Escape');
  });

  test('a bare modifier, a bare letter and a lone Shift chord are not combos yet', () => {
    expect(comboFromEvent(press({ code: 'ControlLeft', ctrlKey: true }), false)).toBeNull();
    expect(comboFromEvent(press({ code: 'KeyP' }), false)).toBeNull();
    expect(comboFromEvent(press({ code: 'KeyP', shiftKey: true }), false)).toBeNull();
  });

  test('on a Mac the Control key stays Control; Cmd is the shortcut key', () => {
    expect(comboFromEvent(press({ code: 'KeyP', ctrlKey: true }), true)).toBe('Control+KeyP');
  });
});

describe('bindShortcuts', () => {
  const unbinds: (() => void)[] = [];
  afterEach(() => {
    for (const off of unbinds.splice(0)) off();
    document.body.innerHTML = '';
  });

  const bind = (handlers: Partial<Record<ActionId, () => void>>, overrides = {}) => {
    const off = bindShortcuts(handlers, overrides);
    unbinds.push(off);
    return off;
  };
  const bindOn = (isMac: boolean, handlers: Partial<Record<ActionId, () => void>>) => {
    unbinds.push(bindShortcuts(handlers, {}, isMac));
  };
  const key = (target: EventTarget, init: KeyboardEventInit) => {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(e);
    return e;
  };

  test('runs the handler for the bound chord and stops the browser default', () => {
    const palette = vi.fn();
    bind({ palette });
    const e = key(document.body, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(palette).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  test('follows overrides', () => {
    const palette = vi.fn();
    bind({ palette }, { palette: '$mod+KeyP' });
    key(document.body, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(palette).not.toHaveBeenCalled();
    key(document.body, { key: 'p', code: 'KeyP', ctrlKey: true });
    expect(palette).toHaveBeenCalledTimes(1);
  });

  test('Ctrl chords still work from a text box', () => {
    const palette = vi.fn();
    const toggle = vi.fn();
    bind({ palette, 'toggle-sidebar': toggle });
    const box = document.createElement('textarea');
    document.body.append(box);
    key(box, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(palette).toHaveBeenCalledTimes(1);
    key(box, { key: 'b', code: 'KeyB', ctrlKey: true });
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  test('a chord without Ctrl or Cmd is left to the text box', () => {
    const run = vi.fn();
    bind({ 'toggle-sidebar': run }, { 'toggle-sidebar': 'Alt+KeyB' });
    const box = document.createElement('input');
    document.body.append(box);
    key(box, { key: 'b', code: 'KeyB', altKey: true });
    expect(run).not.toHaveBeenCalled();
    key(document.body, { key: 'b', code: 'KeyB', altKey: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('does nothing while an input method is composing, or on key repeat', () => {
    const palette = vi.fn();
    bind({ palette });
    key(document.body, { key: 'k', code: 'KeyK', ctrlKey: true, isComposing: true });
    key(document.body, { key: 'k', code: 'KeyK', ctrlKey: true, repeat: true });
    expect(palette).not.toHaveBeenCalled();
  });

  test('on a Mac the shortcut key is Cmd, not Ctrl', () => {
    const palette = vi.fn();
    bindOn(true, { palette });
    key(document.body, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(palette).not.toHaveBeenCalled();
    key(document.body, { key: 'k', code: 'KeyK', metaKey: true });
    expect(palette).toHaveBeenCalledTimes(1);
  });

  test('off a Mac the shortcut key is Ctrl, not Cmd', () => {
    const palette = vi.fn();
    bindOn(false, { palette });
    key(document.body, { key: 'k', code: 'KeyK', metaKey: true });
    expect(palette).not.toHaveBeenCalled();
    key(document.body, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(palette).toHaveBeenCalledTimes(1);
  });

  test('actions without a handler are not bound, and unbinding stops all of them', () => {
    const palette = vi.fn();
    const off = bind({ palette });
    const e = key(document.body, { key: 'b', code: 'KeyB', ctrlKey: true });
    expect(e.defaultPrevented).toBe(false);
    off();
    key(document.body, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(palette).not.toHaveBeenCalled();
  });
});

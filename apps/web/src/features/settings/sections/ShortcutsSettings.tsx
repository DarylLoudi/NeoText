import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ACTION_IDS,
  type ActionId,
  comboFromEvent,
  DEFAULT_SHORTCUTS,
  describeCombo,
  findConflict,
  formatCombo,
  IS_MAC,
  isModifierPress,
  isReservedCombo,
  resolveShortcuts,
  sameCombo,
} from '../../../lib/hotkeys';
import { useT } from '../../../lib/i18n';
import { updateSettings, useSettings } from '../../../state/settings';
import { Button, Kbd } from '../../../ui';
import { Group, SectionHeader } from '../SettingsParts';
import styles from './ShortcutsSettings.module.css';

function Keys({ combo }: { combo: string }) {
  return (
    <span className={styles.keys}>
      {formatCombo(combo, IS_MAC).map((key, i) => (
        // The same key can repeat in one combo only by mistake; position is a stable identity.
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length list rebuilt as a whole
        <Kbd key={`${i}:${key}`}>{key}</Kbd>
      ))}
    </span>
  );
}

export function ShortcutsSettings() {
  const t = useT();
  const overrides = useSettings((s) => s.settings.shortcuts);
  const bindings = resolveShortcuts(overrides);
  const [capturing, setCapturing] = useState<ActionId | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const idBase = useId();
  /** The row to hand focus back to once the capture button it replaced is gone. */
  const refocus = useRef<ActionId | null>(null);

  const finish = useCallback((id: ActionId) => {
    refocus.current = id;
    setCapturing(null);
    setProblem(null);
  }, []);

  useEffect(() => {
    if (capturing !== null || !refocus.current) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-action="${refocus.current}"] [data-change]`)
      ?.focus();
    refocus.current = null;
  }, [capturing]);

  // While listening, the keys are ours: the shortcuts themselves must not fire.
  useEffect(() => {
    if (capturing === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        finish(capturing);
        return;
      }
      if (isModifierPress(e)) return;
      const combo = comboFromEvent(e, IS_MAC);
      if (!combo) {
        setProblem(t('settings.shortcuts.needsModifier'));
        return;
      }
      if (isReservedCombo(combo, IS_MAC)) {
        setProblem(t('settings.shortcuts.reserved'));
        return;
      }
      const other = findConflict(bindings, capturing, combo);
      if (other) {
        setProblem(
          t('settings.shortcuts.taken', {
            combo: describeCombo(combo, IS_MAC),
            action: t(`settings.shortcuts.actions.${other}`),
          }),
        );
        return;
      }
      // Back to the default means no override at all.
      const stored = sameCombo(combo, DEFAULT_SHORTCUTS[capturing]) ? null : combo;
      updateSettings({ shortcuts: { [capturing]: stored } });
      finish(capturing);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, bindings, finish, t]);

  const changed = ACTION_IDS.filter(
    (id) => overrides[id] !== undefined && !sameCombo(overrides[id], DEFAULT_SHORTCUTS[id]),
  );
  const overridden = ACTION_IDS.filter((id) => overrides[id] !== undefined);

  return (
    <>
      <SectionHeader
        title={t('settings.sections.shortcuts')}
        intro={t('settings.shortcuts.intro')}
      />
      <Group title={t('settings.shortcuts.actionsTitle')}>
        <ul ref={list} className={styles.list} aria-label={t('settings.shortcuts.list')}>
          {ACTION_IDS.map((id) => {
            const name = t(`settings.shortcuts.actions.${id}`);
            const listening = capturing === id;
            const nameId = `${idBase}-${id}`;
            return (
              <li key={id} className={styles.row} data-action={id} aria-labelledby={nameId}>
                <span id={nameId} className={styles.name}>
                  {name}
                </span>
                {listening ? (
                  <div className={styles.listening}>
                    <p className={styles.prompt} role="status">
                      {t('settings.shortcuts.listening')}
                    </p>
                    {problem ? (
                      <p className={styles.problem} role="alert">
                        {problem}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <Keys combo={bindings[id]} />
                )}
                <span className={styles.buttons}>
                  {listening ? (
                    <Button size="sm" variant="ghost" onClick={() => finish(id)}>
                      {t('common.cancel')}
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        data-change
                        aria-describedby={nameId}
                        onClick={() => {
                          setProblem(null);
                          setCapturing(id);
                        }}
                      >
                        {t('settings.shortcuts.change')}
                      </Button>
                      {changed.includes(id) ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-describedby={nameId}
                          onClick={() => updateSettings({ shortcuts: { [id]: null } })}
                        >
                          {t('settings.shortcuts.reset')}
                        </Button>
                      ) : null}
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {overridden.length > 0 ? (
          <div className={styles.all}>
            <Button
              variant="ghost"
              onClick={() =>
                updateSettings({
                  shortcuts: Object.fromEntries(overridden.map((id) => [id, null])),
                })
              }
            >
              {t('settings.shortcuts.resetAll')}
            </Button>
          </div>
        ) : null}
      </Group>
    </>
  );
}

import type { ModelInfo } from '@neotext/shared';
import { Globe } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { toolsApi } from '../../../lib/api/tools';
import { useT } from '../../../lib/i18n';
import { qk } from '../../../lib/query';
import { useSettings } from '../../../state/settings';
import { Tooltip } from '../../../ui';
import { enginePrice, priceText, validMode } from '../../settings/sections/web-search-engines';
import styles from './WebSearchToggle.module.css';

export interface WebSearchChoice {
  /** The model searches by itself, or a search backend is set up. */
  available: boolean;
  /** What the next message asks for: on only when it is available. */
  on: boolean;
  /** The model searches by itself (OpenRouter), with the engine set in Tools settings. */
  native: boolean;
  toggle: () => void;
  /** Back to the default, after a message is sent. */
  reset: () => void;
}

/**
 * Whether the next message searches the web. The choice is for this message only: it starts
 * from `webSearch.defaultOn` (changed in Tools settings, never here) and goes back to it after
 * a send, in another chat, and whenever the default itself changes.
 */
export function useWebSearch(
  model: ModelInfo | null,
  conversationId: string | null,
  /** A preset's own starting point for this chat; replaces the default while it applies. */
  presetOn?: boolean,
): WebSearchChoice {
  const settingOn = useSettings((s) => s.settings.webSearch.defaultOn);
  const defaultOn = presetOn ?? settingOn;
  // A pick is dropped as soon as the chat or the default changes (even back to an old value).
  const seed = `${conversationId ?? ''}|${defaultOn}`;
  const [picked, setPicked] = useState<boolean | null>(null);
  const [pickedUnder, setPickedUnder] = useState(seed);
  if (pickedUnder !== seed) {
    setPickedUnder(seed);
    setPicked(null);
  }
  const chosen = pickedUnder === seed && picked !== null ? picked : defaultOn;
  const reset = useCallback(() => setPicked(null), []);
  const native = model?.supports.webSearch ?? false;
  const tools = useQuery({
    queryKey: qk.toolsMeta,
    queryFn: toolsApi.meta,
    enabled: model !== null && !native,
    staleTime: 5 * 60_000,
  });
  const available = native || tools.data?.webSearchBackend === true;
  return {
    available,
    on: available && chosen,
    native,
    toggle: () => setPicked(!chosen),
    reset,
  };
}

export interface WebSearchToggleProps {
  on: boolean;
  /** Searches with the configured engine; otherwise the search backend does it. */
  native: boolean;
  onToggle: () => void;
}

/** Which engine searches and what it costs, as one line for the tooltip. */
function useEngineLine(native: boolean): string {
  const t = useT();
  const engine = useSettings((s) => s.settings.webSearch.engine);
  const stored = useSettings((s) => s.settings.webSearch.mode);
  if (!native) return t('chat.webToggle.viaBackend');
  if (engine === 'native') return t('chat.webToggle.viaNative');
  if (engine === 'auto') return t('chat.webToggle.viaAuto');
  const mode = validMode(engine, stored);
  const name = t(`settings.tools.engines.${engine}`);
  return t('chat.webToggle.via', {
    engine: mode
      ? t('chat.webToggle.engineMode', { engine: name, mode: t(`settings.tools.modes.${mode}`) })
      : name,
    price: priceText(enginePrice(engine, mode)),
  });
}

export function WebSearchToggle({ on, native, onToggle }: WebSearchToggleProps) {
  const t = useT();
  const engineLine = useEngineLine(native);
  return (
    <Tooltip
      content={
        <span className={styles.tip}>
          <span>{t('chat.webToggle.tooltip')}</span>
          <span className={styles.tipMuted}>{engineLine}</span>
        </span>
      }
    >
      <button type="button" className={styles.toggle} aria-pressed={on} onClick={onToggle}>
        <Globe aria-hidden className={styles.icon} weight={on ? 'bold' : 'regular'} />
        {t('chat.webToggle.label')}
      </button>
    </Tooltip>
  );
}

import { WEB_SEARCH_ENGINE_MODES as MODES, type UserSettings } from '@neotext/shared';
import { formatCost } from '../../../lib/format';
import { translate } from '../../../lib/i18n';

export type WebSearchEngine = UserSettings['webSearch']['engine'];

/** What one search costs on OpenRouter, in USD. */
export type EnginePrice =
  | { kind: 'perSearch'; usd: number; perResultUsd?: number }
  /** The model's own provider bills it. */
  | { kind: 'provider' }
  /** Native search when the model has it, else Exa. */
  | { kind: 'auto' };

export interface EngineMode {
  id: string;
  price: EnginePrice;
}

export interface EngineInfo {
  /** The modes to choose from, cheapest first; empty when the engine has none. */
  modes: readonly EngineMode[];
  /** The price when the engine has no modes, else the price of its first mode. */
  price: EnginePrice;
}

const perSearch = (usd: number, perResultUsd?: number): EnginePrice =>
  perResultUsd === undefined
    ? { kind: 'perSearch', usd }
    : { kind: 'perSearch', usd, perResultUsd };

type EngineWithModes = 'parallel' | 'exa';

/** One price for each mode of the shared table, which also tells the server what to send. */
function withModes<E extends EngineWithModes>(
  engine: E,
  prices: Record<(typeof MODES)[E][number], EnginePrice>,
): EngineInfo {
  const modes = MODES[engine].map((id: (typeof MODES)[E][number]) => ({ id, price: prices[id] }));
  return { modes, price: modes[0]?.price ?? { kind: 'provider' } };
}

/** OpenRouter's web search engines with their prices, in the order Settings lists them. */
export const WEB_SEARCH_ENGINES: Record<WebSearchEngine, EngineInfo> = {
  parallel: withModes('parallel', { fast: perSearch(0.001), basic: perSearch(0.005) }),
  exa: withModes('exa', { auto: perSearch(0.007), deep: perSearch(0.012) }),
  perplexity: { modes: [], price: perSearch(0.005) },
  firecrawl: { modes: [], price: perSearch(0.005, 0.0125) },
  native: { modes: [], price: { kind: 'provider' } },
  auto: { modes: [], price: { kind: 'auto' } },
};

/** Every engine id in the table's order: the default (Parallel) first, the fallbacks last. */
export const ENGINE_ORDER = Object.keys(WEB_SEARCH_ENGINES) as WebSearchEngine[];

/** The stored mode when the engine offers it, else the engine's first mode (null when none). */
export function validMode(engine: WebSearchEngine, mode: string | null): string | null {
  const { modes } = WEB_SEARCH_ENGINES[engine];
  if (modes.some((m) => m.id === mode)) return mode;
  return modes[0]?.id ?? null;
}

export function enginePrice(engine: WebSearchEngine, mode: string | null): EnginePrice {
  const info = WEB_SEARCH_ENGINES[engine];
  return info.modes.find((m) => m.id === mode)?.price ?? info.price;
}

/** The price in words, such as "$0.005 per search" or "$0.005 per search plus $0.0125 a result". */
export function priceText(price: EnginePrice): string {
  if (price.kind === 'provider') return translate('settings.tools.price.provider');
  if (price.kind === 'auto') return translate('settings.tools.price.auto');
  const base = translate('settings.tools.price.perSearch', { price: formatCost(price.usd) });
  if (price.perResultUsd === undefined) return base;
  return translate('settings.tools.price.perSearchPlusResult', {
    price: formatCost(price.usd),
    perResult: formatCost(price.perResultUsd),
  });
}

/** The lowest price of an engine, for the engine list ("From $0.001 per search"). */
export function engineHint(engine: WebSearchEngine): string {
  const info = WEB_SEARCH_ENGINES[engine];
  if (info.modes.length < 2 || info.price.kind !== 'perSearch') return priceText(info.price);
  return translate('settings.tools.price.from', {
    price: priceText(info.price),
  });
}

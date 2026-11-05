/**
 * The web searches one target may still run in a turn. The provider's own (server-side)
 * searches and the app `web_search` calls draw on the same budget.
 */
export interface SearchBudget {
  remaining(): number;
  /** Counts searches that already ran, such as those the provider reported for a step. */
  spend(n: number): void;
  /** Takes one search; false when none is left. */
  take(): boolean;
}

export function createSearchBudget(max: number): SearchBudget {
  let left = Math.max(0, Math.floor(max));
  return {
    remaining: () => left,
    spend: (n) => {
      left = Math.max(0, left - Math.max(0, n));
    },
    take: () => {
      if (left <= 0) return false;
      left -= 1;
      return true;
    },
  };
}

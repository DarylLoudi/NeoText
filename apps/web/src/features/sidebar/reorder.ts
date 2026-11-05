import { positionBetween } from './use-conversations';

/**
 * The new position key for the row at `index` moved one place up (`-1`) or down (`1`) among
 * `positions` (keys in display order), or null when it is already at that end. It is the
 * keyboard's way to do what dragging a pinned chat or a folder does.
 */
export function stepPosition(
  positions: (string | null)[],
  index: number,
  step: -1 | 1,
): string | null {
  const target = index + step;
  if (index < 0 || index >= positions.length || target < 0 || target >= positions.length) {
    return null;
  }
  // Up: between the row above the target and the target. Down: between the target and below it.
  const before = step < 0 ? positions[target - 1] : positions[target];
  const after = step < 0 ? positions[target] : positions[target + 1];
  return positionBetween(before ?? null, after ?? null);
}

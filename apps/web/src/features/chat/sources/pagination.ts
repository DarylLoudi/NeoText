export interface PageRange {
  /** The page shown, clamped to the pages that exist (0-based). */
  page: number;
  /** At least 1, so an empty list still has a page to show. */
  pageCount: number;
  /** 0-based, half-open: the page shows items `start` up to but not including `end`. */
  start: number;
  end: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export function paginate(total: number, pageSize: number, page: number): PageRange {
  const size = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(Math.max(0, total) / size));
  const current = Math.min(Math.max(0, Math.floor(page)), pageCount - 1);
  const start = current * size;
  return {
    page: current,
    pageCount,
    start,
    end: Math.min(Math.max(0, total), start + size),
    hasPrev: current > 0,
    hasNext: current < pageCount - 1,
  };
}

/** Cards per page for a strip this wide (px): each card keeps room for a two-line title. */
export function pageSizeForWidth(width: number): number {
  if (width >= 720) return 4;
  if (width >= 540) return 3;
  if (width >= 360) return 2;
  return 1;
}

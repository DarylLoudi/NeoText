import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { formatCost } from '../../lib/format';
import { useT } from '../../lib/i18n';
import styles from './UsageChart.module.css';

export interface ChartDay {
  /** `YYYY-MM-DD`, local. */
  key: string;
  costUsd: number;
  requests: number;
}

export interface UsageChartProps {
  days: ChartDay[];
  /** Names the chart (the id of its visible heading). */
  labelledBy: string;
  locale: string;
}

const HEIGHT = 200;
const TOP = 12;
const AXIS_X = 28;
const AXIS_Y = 64;
const BAR_MAX = 24;
const GAP = 2;
const RADIUS = 4;
const LABEL_EVERY_PX = 64;
/** Half a date label's width, about: a centred label closer than this to the edge would spill. */
const EDGE_LABEL_PX = 24;

/** A round step near `max / 3`, so the axis reads 0 / 0.25 / 0.50 rather than 0 / 0.23 / 0.47. */
function ticksFor(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  const ticks: number[] = [];
  for (let v = 0; v < max + step - 1e-12; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

/** The day as a local date (no time zone shift: the key is already local). */
const dateOf = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};

/** A column with a 4px rounded data end and a square base. */
function barPath(x: number, w: number, top: number, base: number): string {
  const r = Math.min(RADIUS, w / 2, base - top);
  return `M${x},${base}V${top + r}A${r},${r} 0 0 1 ${x + r},${top}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${top + r}V${base}Z`;
}

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? 0;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** Cost per day as columns: one series, so no legend; the heading names it. */
export function UsageChart({ days, labelledBy, locale }: UsageChartProps) {
  const t = useT();
  const { ref, width } = useWidth<HTMLDivElement>(640);
  const [active, setActive] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState(Math.max(0, days.length - 1));
  const bars = useRef<(SVGGElement | null)[]>([]);

  useEffect(() => {
    setFocusIndex((i) => Math.min(i, Math.max(0, days.length - 1)));
  }, [days.length]);

  const short = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
  const long = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const max = Math.max(0, ...days.map((d) => d.costUsd));
  const ticks = ticksFor(max);
  const top = ticks.at(-1) || 1;
  const plotW = Math.max(1, width - AXIS_Y);
  const base = HEIGHT - AXIS_X;
  const plotH = base - TOP;
  const band = plotW / Math.max(1, days.length);
  const barW = Math.max(1, Math.min(BAR_MAX, band - GAP));
  const labelEvery = Math.max(1, Math.ceil(LABEL_EVERY_PX / band));
  const y = (v: number) => base - (v / top) * plotH;
  const atEdge = (i: number) => AXIS_Y + band * i + band / 2 > width - EDGE_LABEL_PX;
  const nameOf = (d: ChartDay) =>
    t('settings.usage.bar', {
      date: long.format(dateOf(d.key)),
      cost: formatCost(d.costUsd, locale),
      requests: t('settings.usage.requestCount', { count: d.requests }),
    });

  const move = (e: KeyboardEvent, i: number) => {
    const last = days.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? Math.min(last, i + 1)
        : e.key === 'ArrowLeft'
          ? Math.max(0, i - 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    setFocusIndex(next);
    bars.current[next]?.focus();
  };

  const shown = active === null ? null : days[active];
  return (
    <div ref={ref} className={styles.chart}>
      {/* biome-ignore lint/a11y/useSemanticElements: an SVG cannot be a fieldset */}
      <svg
        className={styles.svg}
        width={width}
        height={HEIGHT}
        role="group"
        aria-labelledby={labelledBy}
      >
        <g aria-hidden>
          {ticks.map((v) => (
            <g key={v}>
              <line className={styles.grid} x1={AXIS_Y} x2={width} y1={y(v)} y2={y(v)} />
              <text className={styles.tick} x={AXIS_Y - 8} y={y(v)} dy="0.32em" textAnchor="end">
                {formatCost(v, locale)}
              </text>
            </g>
          ))}
          {/* Counted back from today, so the newest day always has its label. */}
          {days.map((d, i) =>
            (days.length - 1 - i) % labelEvery === 0 ? (
              <text
                key={d.key}
                className={styles.tick}
                // A label too close to the right edge ends there instead of running past it.
                x={atEdge(i) ? width : AXIS_Y + band * i + band / 2}
                y={HEIGHT - 8}
                textAnchor={atEdge(i) ? 'end' : 'middle'}
              >
                {short.format(dateOf(d.key))}
              </text>
            ) : null,
          )}
        </g>
        {days.map((d, i) => {
          const x = AXIS_Y + band * i;
          const h = d.costUsd > 0 ? Math.max(1, base - y(d.costUsd)) : 0;
          return (
            // biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: a focusable data mark, named as one image per day
            <g
              key={d.key}
              ref={(el) => {
                bars.current[i] = el;
              }}
              className={styles.bar}
              role="img"
              aria-label={nameOf(d)}
              tabIndex={i === focusIndex ? 0 : -1}
              onFocus={() => {
                setFocusIndex(i);
                setActive(i);
              }}
              onBlur={() => setActive(null)}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onKeyDown={(e) => move(e, i)}
            >
              <rect className={styles.hit} x={x} y={TOP} width={band} height={plotH} />
              {h > 0 ? (
                <path
                  className={styles.mark}
                  d={barPath(x + (band - barW) / 2, barW, base - h, base)}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      {shown && active !== null ? (
        <div
          className={styles.tooltip}
          data-testid="usage-tooltip"
          aria-hidden
          style={{
            left: Math.min(Math.max(AXIS_Y + band * active + band / 2, 72), width - 72),
            top: Math.max(0, y(shown.costUsd) - 8),
          }}
        >
          <strong className={styles.value}>{formatCost(shown.costUsd, locale)}</strong>
          <span className={styles.label}>{long.format(dateOf(shown.key))}</span>
          <span className={styles.label}>
            {t('settings.usage.requestCount', { count: shown.requests })}
          </span>
        </div>
      ) : null}
    </div>
  );
}

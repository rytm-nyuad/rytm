'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { SectionHeader } from '@/components/analytics/SectionHeader';
import type { ProgressMetric, ProgressPoint } from '@/components/analytics/progressTypes';

type Props = {
  /** Full series for the selected calendar month (day gaps allowed). */
  series: ProgressPoint[];
  metrics: ProgressMetric[];
  month: string; // YYYY-MM
  onMonthChange: (month: string) => void;
  loading?: boolean;
};

const W = 360;
const H = 150;
const PAD = { top: 16, right: 12, bottom: 28, left: 32 };

function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains('dark'));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, 1));
  return dt.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function MonthlyScatter({
  label,
  color,
  points,
  monthDays,
}: {
  label: string;
  color: string;
  points: Array<{ day: number; value: number }>;
  monthDays: number;
}) {
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const xAt = (day: number) =>
    PAD.left + ((Math.max(1, Math.min(monthDays, day)) - 1) / Math.max(monthDays - 1, 1)) * innerW;
  const yAt = (v: number) => PAD.top + innerH - (Math.min(100, Math.max(0, v)) / 100) * innerH;
  const average = points.length
    ? points.reduce((sum, p) => sum + p.value, 0) / points.length
    : null;

  return (
    <div className="rounded-2xl dark:bg-zinc-900 bg-white border dark:border-zinc-800 border-zinc-200 p-4">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold dark:text-zinc-100 text-zinc-900">{label}</h3>
        <span
          className="text-xs font-semibold tabular-nums dark:text-zinc-100"
          style={{ color }}
          title="Month average"
        >
          {average !== null ? Math.round(average) : '—'}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${label} by day of month`}>
        {[0, 50, 100].map((tick) => {
          const y = yAt(tick);
          return (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y}
                y2={y}
                className="dark:stroke-zinc-800 stroke-zinc-100"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y + 3}
                textAnchor="end"
                className="dark:fill-zinc-300 fill-zinc-500"
                style={{ fontSize: 9 }}
              >
                {tick}
              </text>
            </g>
          );
        })}
        {points.map((p, i) => (
          <circle key={i} cx={xAt(p.day)} cy={yAt(p.value)} r={3} fill={color} opacity={0.9} />
        ))}
        <text x={PAD.left} y={H - 8} className="dark:fill-zinc-300 fill-zinc-500" style={{ fontSize: 9 }}>
          1
        </text>
        <text
          x={W - PAD.right}
          y={H - 8}
          textAnchor="end"
          className="dark:fill-zinc-300 fill-zinc-500"
          style={{ fontSize: 9 }}
        >
          {monthDays}
        </text>
      </svg>
    </div>
  );
}

export function MonthlyCheckInScatter({
  series,
  metrics,
  month,
  onMonthChange,
  loading,
}: Props) {
  const isDark = useIsDark();
  const monthDays = daysInMonth(month);
  const byDay = useMemo(() => {
    const map = new Map<number, ProgressPoint>();
    for (const row of series) {
      if (!row.date.startsWith(month)) continue;
      const day = Number(row.date.slice(8, 10));
      if (Number.isFinite(day)) map.set(day, row);
    }
    return map;
  }, [series, month]);

  const chartMetrics = metrics.filter((m) =>
    ['energy', 'focus', 'productivity', 'mood', 'stress', 'overall'].includes(m.key)
  );

  const logged = [...byDay.values()].filter(
    (d) =>
      d.energy !== null ||
      d.focus !== null ||
      d.productivity !== null ||
      d.mood !== null ||
      d.stress !== null ||
      d.overall !== null
  ).length;

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeader
          title="Check-ins by month"
          subtitle={
            loading
              ? 'Loading…'
              : `${logged} logged day${logged === 1 ? '' : 's'} in ${monthLabel(month)}`
          }
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => onMonthChange(shiftMonth(month, -1))}
            className="p-2 rounded-lg dark:bg-zinc-800 bg-zinc-100 dark:text-zinc-100 text-zinc-700 dark:hover:bg-zinc-700 hover:bg-zinc-200"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold dark:text-zinc-100 text-zinc-900 min-w-[9rem] text-center">
            {monthLabel(month)}
          </span>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => onMonthChange(shiftMonth(month, 1))}
            className="p-2 rounded-lg dark:bg-zinc-800 bg-zinc-100 dark:text-zinc-100 text-zinc-700 dark:hover:bg-zinc-700 hover:bg-zinc-200"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className={`grid gap-4 sm:grid-cols-2 ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
        {chartMetrics.map((m) => {
          const points: Array<{ day: number; value: number }> = [];
          for (let day = 1; day <= monthDays; day++) {
            const row = byDay.get(day);
            const v = row ? row[m.key] : null;
            if (typeof v === 'number') points.push({ day, value: v });
          }
          return (
            <MonthlyScatter
              key={m.key}
              label={m.label}
              color={isDark && m.colorDark ? m.colorDark : m.color}
              points={points}
              monthDays={monthDays}
            />
          );
        })}
      </div>
    </section>
  );
}

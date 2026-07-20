'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { SectionHeader } from '@/components/analytics/SectionHeader';

export type NutritionDay = {
  date: string;
  total_kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  sugar_g: number | null;
  meal_count: number;
  confidence: number | null;
  breakfast: boolean;
  lunch: boolean;
  dinner: boolean;
};

type Props = {
  days: NutritionDay[];
};

function fmt(n: number | null, suffix = ''): string {
  if (n === null || Number.isNaN(n)) return '—';
  return `${Math.round(n)}${suffix}`;
}

function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function NutritionDayBrowser({ days }: Props) {
  const sorted = useMemo(
    () => [...days].sort((a, b) => a.date.localeCompare(b.date)),
    [days]
  );
  const [index, setIndex] = useState(() => Math.max(0, sorted.length - 1));

  // Keep index in range when data reloads.
  const safeIndex = sorted.length ? Math.min(index, sorted.length - 1) : 0;
  const day = sorted[safeIndex] || null;

  if (!sorted.length) {
    return (
      <section className="space-y-4">
        <SectionHeader
          title="Nutrition by day"
          subtitle="Scroll through days to review calories and macros"
        />
        <div className="rounded-2xl dark:bg-zinc-900 bg-white border dark:border-zinc-800 border-zinc-200 px-5 py-8 text-sm dark:text-zinc-300 text-zinc-500 text-center">
          No nutrition days yet. Log meals to see daily totals here.
        </div>
      </section>
    );
  }

  const macros = [
    { label: 'Calories', value: fmt(day?.total_kcal ?? null, ' kcal'), tone: 'text-violet-700 dark:text-violet-200' },
    { label: 'Protein', value: fmt(day?.protein_g ?? null, ' g'), tone: 'text-indigo-700 dark:text-indigo-200' },
    { label: 'Carbs', value: fmt(day?.carbs_g ?? null, ' g'), tone: 'text-blue-700 dark:text-blue-200' },
    { label: 'Fat', value: fmt(day?.fat_g ?? null, ' g'), tone: 'text-violet-700 dark:text-violet-200' },
    { label: 'Sugar', value: fmt(day?.sugar_g ?? null, ' g'), tone: 'dark:text-zinc-200 text-zinc-700' },
  ];

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Nutrition by day"
        subtitle="Scroll through days to review calories and macros"
      />

      <div className="rounded-2xl dark:bg-zinc-900 bg-white border dark:border-zinc-800 border-zinc-200 p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            aria-label="Previous day"
            disabled={safeIndex <= 0}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            className="p-2 rounded-lg dark:bg-zinc-800 bg-zinc-100 dark:text-zinc-100 text-zinc-700 disabled:opacity-30 dark:hover:bg-zinc-700 hover:bg-zinc-200 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="text-center min-w-0">
            <p className="text-base font-semibold dark:text-zinc-100 text-zinc-900">
              {day ? formatDisplayDate(day.date) : '—'}
            </p>
            <p className="text-xs dark:text-zinc-300 text-zinc-500 mt-0.5">
              Day {safeIndex + 1} of {sorted.length}
              {day ? ` · ${day.meal_count} meal${day.meal_count === 1 ? '' : 's'}` : ''}
            </p>
          </div>

          <button
            type="button"
            aria-label="Next day"
            disabled={safeIndex >= sorted.length - 1}
            onClick={() => setIndex((i) => Math.min(sorted.length - 1, i + 1))}
            className="p-2 rounded-lg dark:bg-zinc-800 bg-zinc-100 dark:text-zinc-100 text-zinc-700 disabled:opacity-30 dark:hover:bg-zinc-700 hover:bg-zinc-200 transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {macros.map((m) => (
            <div
              key={m.label}
              className="rounded-xl dark:bg-zinc-950/60 bg-zinc-50 border dark:border-zinc-800 border-zinc-200 px-3 py-3"
            >
              <p className="text-[11px] dark:text-zinc-400 text-zinc-500 mb-1">{m.label}</p>
              <p className={`text-sm font-semibold tabular-nums ${m.tone}`}>{m.value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {(
            [
              ['Breakfast', day?.breakfast],
              ['Lunch', day?.lunch],
              ['Dinner', day?.dinner],
            ] as const
          ).map(([label, on]) => (
            <span
              key={label}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border ${
                on
                  ? 'bg-violet-600/15 text-violet-700 dark:text-violet-200 border-violet-500/30'
                  : 'dark:bg-zinc-800 bg-zinc-100 dark:text-zinc-400 text-zinc-400 border-transparent'
              }`}
            >
              {label}
            </span>
          ))}
          {day?.confidence !== null && day?.confidence !== undefined ? (
            <span className="text-[11px] font-medium px-2.5 py-1 rounded-lg dark:bg-zinc-800 bg-zinc-100 dark:text-zinc-200 text-zinc-600">
              Confidence {Math.round(day.confidence * (day.confidence <= 1 ? 100 : 1))}
              {day.confidence <= 1 ? '%' : ''}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

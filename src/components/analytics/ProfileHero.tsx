'use client';

import { Brain, CalendarDays, Clock3, Layers } from 'lucide-react';
import {
  confidenceFromArchetype,
  formatRelativeTime,
  toSecondPerson,
} from '@/lib/analytics/format';

type Props = {
  title: string;
  summary: string;
  daysUsed?: number | null;
  trustedEdgeCount?: number | null;
  createdAt?: string | null;
  profileVersion?: string | null;
};

function firstSentences(text: string, max = 2): string {
  const parts = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!parts?.length) return text;
  return parts.slice(0, max).join(' ').trim();
}

export function ProfileHero({
  title,
  summary,
  daysUsed,
  trustedEdgeCount,
  createdAt,
  profileVersion,
}: Props) {
  const confidence = confidenceFromArchetype({
    daysUsed,
    trustedEdgeCount,
  });
  const versionLabel = (profileVersion || 'v1').replace('correlation_archetype_', '');

  return (
    <section className="relative">
      <div
        aria-hidden
        className="mb-5 h-[2px] w-full rounded-full bg-gradient-to-r from-indigo-600 via-violet-500 to-violet-400 opacity-90"
      />

      <div className="relative overflow-hidden rounded-2xl dark:bg-zinc-900 bg-white border dark:border-zinc-800 border-zinc-200 p-6 sm:p-8 shadow-md shadow-violet-500/10">
        <div className="relative flex items-start gap-4">
          <div className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-md shadow-violet-500/25">
            <Brain className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1 space-y-5">
            <div className="space-y-1.5">
              <p className="text-[12px] font-medium tracking-wide dark:text-zinc-500 text-zinc-400">
                Your Behavioral Profile
              </p>
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-violet-700 dark:text-violet-200">
                {title}
              </h1>
            </div>

            <div className="flex flex-wrap gap-2">
              <span
                className={`inline-flex items-center rounded-lg px-3 py-1.5 text-[12px] font-medium dark:bg-zinc-800 bg-zinc-100 dark:text-zinc-200 text-zinc-700 ${confidence.tone}`}
              >
                Confidence: {confidence.label}
              </span>
              {typeof daysUsed === 'number' ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium dark:bg-zinc-800 bg-zinc-100 dark:text-zinc-200 text-zinc-700">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {daysUsed} days analyzed
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium dark:bg-zinc-800 bg-zinc-100 dark:text-zinc-200 text-zinc-700">
                <Clock3 className="h-3.5 w-3.5" />
                Updated {formatRelativeTime(createdAt)}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium dark:bg-zinc-800 bg-zinc-100 dark:text-zinc-200 text-zinc-700">
                <Layers className="h-3.5 w-3.5" />
                {versionLabel}
              </span>
            </div>

            {summary ? (
              <div className="space-y-2.5 max-w-2xl">
                <p className="text-sm leading-relaxed dark:text-zinc-200 text-zinc-600">
                  {firstSentences(toSecondPerson(summary), 2)}
                </p>
                {typeof daysUsed === 'number' ? (
                  <p className="text-[13px] leading-relaxed dark:text-zinc-400 text-zinc-400">
                    This profile is based on patterns observed across {daysUsed} tracked days.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

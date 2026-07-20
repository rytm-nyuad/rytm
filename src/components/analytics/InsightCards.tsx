'use client';

import { Lightbulb, Target } from 'lucide-react';
import { toSecondPerson } from '@/lib/analytics/format';

type Props = {
  insight?: string | null;
  opportunity?: string | null;
};

function firstSentences(text: string, max = 2): string {
  const parts = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!parts?.length) return text;
  return parts.slice(0, max).join(' ').trim();
}

export function InsightCards({ insight, opportunity }: Props) {
  if (!insight && !opportunity) return null;

  return (
    <section className="grid gap-5 sm:grid-cols-2">
      {insight ? (
        <article className="rounded-2xl dark:bg-zinc-900 bg-white border dark:border-zinc-800 border-zinc-200 p-6 sm:p-7 space-y-4 shadow-sm">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
            <Lightbulb className="h-5 w-5 text-violet-600 dark:text-violet-300" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight dark:text-white text-zinc-900">
            Biggest Insight
          </h2>
          <p className="text-sm leading-relaxed dark:text-zinc-200 text-zinc-600">
            {firstSentences(toSecondPerson(insight), 2)}
          </p>
        </article>
      ) : null}

      {opportunity ? (
        <article className="rounded-2xl dark:bg-zinc-900 bg-white border dark:border-zinc-800 border-zinc-200 p-6 sm:p-7 space-y-4 shadow-sm">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10">
            <Target className="h-5 w-5 text-indigo-600 dark:text-indigo-300" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight dark:text-white text-zinc-900">
            Biggest Opportunity
          </h2>
          <p className="text-sm leading-relaxed dark:text-zinc-200 text-zinc-600">
            {firstSentences(toSecondPerson(opportunity), 2)}
          </p>
        </article>
      ) : null}
    </section>
  );
}

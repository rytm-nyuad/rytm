'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { Loader2, Sparkles, RefreshCw } from 'lucide-react';
import { TopNav } from '@/components/dashboard/TopNav';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ProfileHero } from '@/components/analytics/ProfileHero';
import { InsightCards } from '@/components/analytics/InsightCards';
import { CorrelationChips } from '@/components/analytics/CorrelationChips';
import { RelationshipNetwork } from '@/components/analytics/AnalyticsCharts';
import type { ProgressMetric, ProgressPoint } from '@/components/analytics/progressTypes';
import { NutritionDayBrowser, type NutritionDay } from '@/components/analytics/NutritionDayBrowser';
import { FitbitCharts, type FitbitMetric, type FitbitPoint } from '@/components/analytics/FitbitCharts';
import { MonthlyCheckInScatter } from '@/components/analytics/MonthlyCheckInScatter';
import type { AnalyticsViz, KeyCorrelation } from '@/lib/analytics/format';

type ArchetypeRow = {
  archetype_id: string;
  archetype_title: string;
  summary: string;
  core_insight: string;
  strength: string;
  profile_version?: string | null;
  days_used?: number | null;
  created_at?: string | null;
  key_correlations?: KeyCorrelation[];
  trusted_edge_count?: number | null;
  viz?: AnalyticsViz | null;
};

type RefreshMeta = {
  due: boolean;
  canRun?: boolean;
  reason: string;
  message: string;
  dueState?: {
    reason?: string;
    featureDays?: number;
    minFeatureDays?: number;
    nextDueDate?: string;
  };
  latestJob?: {
    archetypeId: string;
    status: string;
    createdAt: string | null;
    errorKind?: string | null;
    rejectionReasons?: string[];
  } | null;
};

type AnalyticsPayload = {
  archetype: ArchetypeRow | null;
  behaviorProfile: {
    summary?: string;
    primary_coaching_rule?: string;
  } | null;
  unavailable?: boolean;
  error?: string;
  refresh?: RefreshMeta;
};

type ProgressPayload = {
  days: number;
  start: string;
  end: string;
  logged_days: number;
  series: ProgressPoint[];
  metrics: ProgressMetric[];
  nutrition?: { days: NutritionDay[]; error?: string | null };
  fitbit?: {
    series: FitbitPoint[];
    logged_days: number;
    metrics: FitbitMetric[];
    error?: string | null;
  };
  error?: string;
};

function currentMonthLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function jobFailureMessage(job: RefreshMeta['latestJob']): string | null {
  if (!job) return null;
  if (job.status === 'rejected') {
    const reasons = job.rejectionReasons?.length
      ? job.rejectionReasons.join(', ')
      : job.errorKind || 'quality gate';
    return `Correlation run finished but was rejected (${reasons}).`;
  }
  if (job.status === 'failed') {
    return `Correlation run failed${job.errorKind ? ` (${job.errorKind})` : ''}.`;
  }
  return null;
}

export default function AnalyticsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<AnalyticsPayload | null>(null);
  const [monthProgress, setMonthProgress] = useState<ProgressPayload | null>(null);
  const [nutritionDays, setNutritionDays] = useState<NutritionDay[]>([]);
  const [month, setMonth] = useState(currentMonthLocal);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number | null>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    startedAtRef.current = null;
  };

  const fetchArchetype = async (): Promise<AnalyticsPayload> => {
    const archetypeRes = await fetch('/api/analytics/archetype');
    const archetypeData = (await archetypeRes.json()) as AnalyticsPayload;
    if (!archetypeRes.ok) {
      return {
        archetype: null,
        behaviorProfile: null,
        error: archetypeData.error || 'Failed to load',
      };
    }
    return archetypeData;
  };

  const fetchMonth = async (nextMonth: string) => {
    const res = await fetch(
      `/api/analytics/progress?month=${nextMonth}&nutrition_days=365`
    );
    if (!res.ok) {
      setMonthProgress(null);
      return;
    }
    const data = (await res.json()) as ProgressPayload;
    setMonthProgress(data);
    if (data.nutrition?.days?.length) {
      setNutritionDays(data.nutrition.days);
    }
  };

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/sign-in');
        return;
      }

      try {
        const [archetypeData] = await Promise.all([
          fetchArchetype(),
          fetchMonth(currentMonthLocal()),
        ]);
        setPayload(archetypeData);
      } catch (err) {
        setPayload({
          archetype: null,
          behaviorProfile: null,
          error: err instanceof Error ? err.message : 'Failed to load',
        });
      } finally {
        setLoading(false);
      }
    };
    load();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMonthChange = async (next: string) => {
    if (next === month) return;
    setMonth(next);
    setLoadingMonth(true);
    try {
      await fetchMonth(next);
    } finally {
      setLoadingMonth(false);
    }
  };

  const handleRunCorrelation = async () => {
    setRefreshNote(null);
    setRefreshing(true);
    try {
      const res = await fetch('/api/analytics/archetype/refresh', { method: 'POST' });
      const data = (await res.json()) as {
        status?: string;
        message?: string;
        error?: string;
        reason?: string;
      };

      if (!res.ok || data.status === 'blocked') {
        const blockedHard =
          data.reason === 'insufficient_feature_days' || data.reason === 'already_running';
        setRefreshNote(
          data.message ||
            data.error ||
            (blockedHard
              ? 'Correlation refresh is blocked.'
              : 'Could not start correlation refresh. Hard-refresh the page and try again.')
        );
        setRefreshing(false);
        return;
      }

      setRefreshNote(data.message || 'Correlation pipeline started…');
      startedAtRef.current = Date.now();
      const previousArchetypeId = payload?.archetype?.archetype_id ?? null;

      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const next = await fetchArchetype();
          setPayload(next);

          const latest = next.refresh?.latestJob;
          const elapsed = Date.now() - (startedAtRef.current ?? Date.now());

          if (
            next.archetype &&
            (!previousArchetypeId || next.archetype.archetype_id !== previousArchetypeId)
          ) {
            stopPolling();
            setRefreshing(false);
            setRefreshNote('Correlation profile updated.');
            return;
          }

          if (
            previousArchetypeId &&
            next.archetype?.archetype_id === previousArchetypeId &&
            latest?.status === 'active' &&
            elapsed > 15_000
          ) {
            // Refresh completed but same active row identity can happen on supersede timing;
            // keep waiting a bit for a new active row, then accept if due flipped off.
          }

          if (latest && (latest.status === 'rejected' || latest.status === 'failed')) {
            const started = startedAtRef.current ?? 0;
            const jobAt = latest.createdAt ? Date.parse(latest.createdAt) : 0;
            if (!jobAt || jobAt >= started - 5_000) {
              stopPolling();
              setRefreshing(false);
              setRefreshNote(jobFailureMessage(latest) || 'Correlation run did not succeed.');
              return;
            }
          }

          if (elapsed > 120_000) {
            stopPolling();
            setRefreshing(false);
            setRefreshNote(
              'Still running in the background. Refresh this page in a minute to check.'
            );
          }
        } catch {
          // keep polling until timeout
        }
      }, 3000);
    } catch (err) {
      setRefreshing(false);
      setRefreshNote(err instanceof Error ? err.message : 'Failed to start correlation refresh');
    }
  };

  const archetype = payload?.archetype;
  const keyCorrelations: KeyCorrelation[] = archetype?.key_correlations || [];
  const viz = archetype?.viz || null;
  const refresh = payload?.refresh;
  // Allow re-run unless hard-blocked. Fallback for older payloads missing `canRun`.
  const hardBlocked =
    refresh?.reason === 'insufficient_feature_days' ||
    refresh?.reason === 'already_running' ||
    refresh?.dueState?.reason === 'insufficient_feature_days';
  const canRun =
    !payload?.unavailable &&
    !refreshing &&
    (typeof refresh?.canRun === 'boolean' ? refresh.canRun : !hardBlocked);
  const runButton = !payload?.unavailable ? (
    <button
      type="button"
      onClick={handleRunCorrelation}
      disabled={!canRun}
      title={
        canRun
          ? 'Re-run correlation pipeline'
          : refresh?.message || 'Correlation refresh unavailable'
      }
      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium border dark:border-zinc-700 border-zinc-200 dark:bg-zinc-800/80 bg-zinc-50 dark:text-zinc-200 text-zinc-700 dark:hover:bg-zinc-800 hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {refreshing ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        <RefreshCw className="w-3 h-3" />
      )}
      {refreshing ? 'Running…' : 'Re-run'}
    </button>
  ) : null;
  const statusNote =
    refreshNote ||
    (hardBlocked && refresh?.message ? refresh.message : null);

  return (
    <ThemeProvider>
      <div className="min-h-screen dark:bg-black bg-zinc-50">
        <TopNav />

        <main className="max-w-4xl mx-auto px-4 py-10 sm:py-16">
          {loading ? (
            <div className="flex items-center justify-center py-28 gap-2 text-sm dark:text-zinc-300 text-zinc-500">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading…
            </div>
          ) : payload?.error ? (
            <div className="rounded-2xl border dark:border-zinc-800 border-zinc-200 dark:bg-zinc-900 bg-white px-6 py-8 text-sm dark:text-zinc-200 text-zinc-700">
              {payload.error}
            </div>
          ) : (
            <div className="space-y-14 sm:space-y-16">
              {archetype ? (
                <>
                  <ProfileHero
                    title={archetype.archetype_title || 'Your system profile'}
                    summary={archetype.summary || ''}
                    daysUsed={archetype.days_used}
                    trustedEdgeCount={archetype.trusted_edge_count}
                    createdAt={archetype.created_at}
                    profileVersion={archetype.profile_version}
                    action={runButton}
                    footerNote={statusNote}
                  />

                  <InsightCards
                    insight={archetype.core_insight}
                    opportunity={archetype.strength}
                  />

                  <div className="grid gap-10 lg:grid-cols-2 lg:gap-8 lg:items-start">
                    <RelationshipNetwork viz={viz} />
                    <CorrelationChips correlations={keyCorrelations} compact />
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border dark:border-zinc-800 border-zinc-200 dark:bg-zinc-900 bg-white px-8 py-16 text-center">
                  <Sparkles className="w-8 h-8 mx-auto mb-4 dark:text-zinc-400 text-zinc-400" />
                  <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight dark:text-zinc-100 text-zinc-900 mb-2">
                    Your pattern profile is still forming
                  </h1>
                  <p className="text-sm dark:text-zinc-300 text-zinc-500 max-w-md mx-auto leading-relaxed">
                    {payload?.unavailable
                      ? 'Analytics is almost ready — the profile schema still needs to be applied.'
                      : 'Keep checking in for a bit longer. Once enough clear patterns show up, your archetype will appear here.'}
                  </p>
                  {!payload?.unavailable ? (
                    <div className="mt-5 flex flex-col items-center gap-2">
                      {runButton}
                      {statusNote ? (
                        <p className="text-[12px] dark:text-zinc-500 text-zinc-400 max-w-md">
                          {statusNote}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}

              {monthProgress ? (
                <MonthlyCheckInScatter
                  series={monthProgress.series}
                  metrics={monthProgress.metrics}
                  month={month}
                  onMonthChange={handleMonthChange}
                  loading={loadingMonth}
                />
              ) : null}

              <NutritionDayBrowser days={nutritionDays} />

              {monthProgress?.fitbit ? (
                <FitbitCharts
                  series={monthProgress.fitbit.series}
                  metrics={monthProgress.fitbit.metrics}
                  month={month}
                  onMonthChange={handleMonthChange}
                  loading={loadingMonth}
                  error={monthProgress.fitbit.error}
                />
              ) : null}
            </div>
          )}
        </main>
      </div>
    </ThemeProvider>
  );
}

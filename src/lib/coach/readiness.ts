import type { SupabaseClient } from '@supabase/supabase-js';

export type CoachReadiness = {
  forDate: string;
  hasOverall: boolean;
  hasGoal: boolean;
  hasPlan: boolean;
  hasBundle: boolean;
  hasStateHistory: boolean;
  fast_ready: boolean;
  slow_ready: boolean;
  /** Mirrors update_state — generation is allowed even when fast_ready is false. */
  canGeneratePlan: boolean;
  blockers: string[];
};

export async function getCoachReadiness(
  supabaseAdmin: SupabaseClient,
  userId: string,
  forDate: string
): Promise<CoachReadiness> {
  const [overallResult, goalResult, planResult, bundleResult, stateHistoryResult, currentStateResult] =
    await Promise.all([
      supabaseAdmin
        .from('daily_overall')
        .select('id')
        .eq('user_id', userId)
        .eq('date', forDate)
        .maybeSingle(),
      supabaseAdmin
        .from('user_goals1')
        .select('goal_id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from('daily_plans1')
        .select('plan_id')
        .eq('user_id', userId)
        .eq('for_date', forDate)
        .maybeSingle(),
      supabaseAdmin
        .from('daily_input_bundle_v12')
        .select('date')
        .eq('user_id', userId)
        .eq('date', forDate)
        .maybeSingle(),
      supabaseAdmin
        .from('user_state_history2')
        .select('date, state_snapshot_json')
        .eq('user_id', userId)
        .eq('date', forDate)
        .maybeSingle(),
      supabaseAdmin
        .from('user_state_current2')
        .select('as_of_date, state_json')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);

  const stateHistory = stateHistoryResult.data as
    | {
        date: string;
        state_snapshot_json?: {
          uncertainty?: { baseline_stability_flags?: { fast_ready?: boolean; slow_ready?: boolean } };
        };
      }
    | null;
  const currentState = currentStateResult.data as
    | {
        as_of_date: string;
        state_json?: {
          uncertainty?: { baseline_stability_flags?: { fast_ready?: boolean; slow_ready?: boolean } };
        };
      }
    | null;

  const currentFlags =
    currentState?.as_of_date === forDate
      ? currentState.state_json?.uncertainty?.baseline_stability_flags
      : null;
  const historyFlags = stateHistory?.state_snapshot_json?.uncertainty?.baseline_stability_flags ?? null;
  const flags = currentFlags ?? historyFlags;

  const hasOverall = !!overallResult.data;
  const hasGoal = !!goalResult.data;
  const hasPlan = !!planResult.data;
  const hasBundle = !!bundleResult.data;
  const hasStateHistory = !!stateHistory;

  const blockers: string[] = [];
  if (!hasGoal) blockers.push('no_active_goal');
  if (!hasOverall) blockers.push('no_daily_overall');
  if (!hasBundle) blockers.push('no_input_bundle');
  if (!hasStateHistory) blockers.push('no_state_history');
  if (!flags?.fast_ready) blockers.push('fast_baseline_not_ready');

  return {
    forDate,
    hasOverall,
    hasGoal,
    hasPlan,
    hasBundle,
    hasStateHistory,
    fast_ready: !!flags?.fast_ready,
    slow_ready: !!flags?.slow_ready,
    canGeneratePlan: hasGoal && hasOverall,
    blockers,
  };
}

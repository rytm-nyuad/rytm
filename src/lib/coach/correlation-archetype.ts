import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BEHAVIOR_PROFILE_MIN_FEATURE_DAYS,
  BEHAVIOR_PROFILE_MIN_NEW_FEATURE_DAYS,
  BEHAVIOR_PROFILE_REFRESH_DAYS,
  countFeatureDays,
  countFeatureDaysAfter,
  type BehaviorProfileDueState,
} from '@/lib/coach/behavior-profile';

/** Same numeric gates as behavior profiles; due state is against correlation archetype rows. */
export type CorrelationArchetypeDueState = BehaviorProfileDueState & {
  latestArchetypeId?: string;
};

export type CorrelationArchetypeJobSnapshot = {
  archetypeId: string;
  status: string;
  createdAt: string | null;
  errorKind?: string | null;
  rejectionReasons?: string[];
};

export async function getCorrelationArchetypeDueState(
  supabaseAdmin: SupabaseClient,
  userId: string,
  asOf: Date = new Date()
): Promise<CorrelationArchetypeDueState> {
  const featureDays = await countFeatureDays(supabaseAdmin, userId);

  if (featureDays < BEHAVIOR_PROFILE_MIN_FEATURE_DAYS) {
    return {
      due: false,
      reason: 'insufficient_feature_days',
      featureDays,
      minFeatureDays: BEHAVIOR_PROFILE_MIN_FEATURE_DAYS,
      minNewFeatureDays: BEHAVIOR_PROFILE_MIN_NEW_FEATURE_DAYS,
      newFeatureDays: 0,
    };
  }

  const { data: latest, error } = await supabaseAdmin
    .from('user_correlation_archetypes1')
    .select('archetype_id, created_at, data_window_end')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load active correlation archetype: ${error.message}`);
  }

  if (!latest?.created_at) {
    return {
      due: true,
      reason: 'no_active_archetype',
      featureDays,
      minFeatureDays: BEHAVIOR_PROFILE_MIN_FEATURE_DAYS,
      minNewFeatureDays: BEHAVIOR_PROFILE_MIN_NEW_FEATURE_DAYS,
      newFeatureDays: featureDays,
    };
  }

  const createdAt = new Date(latest.created_at);
  const nextDue = new Date(createdAt);
  nextDue.setUTCDate(nextDue.getUTCDate() + BEHAVIOR_PROFILE_REFRESH_DAYS);
  const nextDueDate = nextDue.toISOString().slice(0, 10);

  const dataWindowEnd =
    typeof latest.data_window_end === 'string' && latest.data_window_end
      ? latest.data_window_end.slice(0, 10)
      : null;

  const newFeatureDays = dataWindowEnd
    ? await countFeatureDaysAfter(supabaseAdmin, userId, dataWindowEnd)
    : featureDays;

  if (asOf < nextDue) {
    return {
      due: false,
      reason: 'not_due_yet',
      featureDays,
      minFeatureDays: BEHAVIOR_PROFILE_MIN_FEATURE_DAYS,
      minNewFeatureDays: BEHAVIOR_PROFILE_MIN_NEW_FEATURE_DAYS,
      newFeatureDays,
      latestArchetypeId: latest.archetype_id,
      latestCreatedAt: latest.created_at,
      latestDataWindowEnd: dataWindowEnd,
      nextDueDate,
    };
  }

  if (newFeatureDays < BEHAVIOR_PROFILE_MIN_NEW_FEATURE_DAYS) {
    return {
      due: false,
      reason: 'insufficient_new_feature_days',
      featureDays,
      minFeatureDays: BEHAVIOR_PROFILE_MIN_FEATURE_DAYS,
      minNewFeatureDays: BEHAVIOR_PROFILE_MIN_NEW_FEATURE_DAYS,
      newFeatureDays,
      latestArchetypeId: latest.archetype_id,
      latestCreatedAt: latest.created_at,
      latestDataWindowEnd: dataWindowEnd,
      nextDueDate,
    };
  }

  return {
    due: true,
    reason: 'refresh_interval_elapsed_with_new_data',
    featureDays,
    minFeatureDays: BEHAVIOR_PROFILE_MIN_FEATURE_DAYS,
    minNewFeatureDays: BEHAVIOR_PROFILE_MIN_NEW_FEATURE_DAYS,
    newFeatureDays,
    latestArchetypeId: latest.archetype_id,
    latestCreatedAt: latest.created_at,
    latestDataWindowEnd: dataWindowEnd,
    nextDueDate,
  };
}

export async function hasRunningCorrelationArchetypeJob(
  supabaseAdmin: SupabaseClient,
  userId: string,
  withinHours = 2
): Promise<boolean> {
  const cutoff = new Date();
  cutoff.setUTCHours(cutoff.getUTCHours() - withinHours);

  const { data, error } = await supabaseAdmin
    .from('user_correlation_archetypes1')
    .select('archetype_id')
    .eq('user_id', userId)
    .eq('status', 'running')
    .gte('created_at', cutoff.toISOString())
    .limit(1);

  if (error) {
    throw new Error(`Failed to check running correlation archetype jobs: ${error.message}`);
  }

  return (data ?? []).length > 0;
}

export async function getLatestCorrelationArchetypeJob(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<CorrelationArchetypeJobSnapshot | null> {
  const { data, error } = await supabaseAdmin
    .from('user_correlation_archetypes1')
    .select('archetype_id, status, created_at, error_json')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load latest correlation archetype job: ${error.message}`);
  }
  if (!data) return null;

  const errorJson =
    data.error_json && typeof data.error_json === 'object'
      ? (data.error_json as Record<string, unknown>)
      : null;
  const rejectionReasons = Array.isArray(errorJson?.rejection_reasons)
    ? (errorJson.rejection_reasons as unknown[]).map(String)
    : [];

  return {
    archetypeId: data.archetype_id,
    status: String(data.status || ''),
    createdAt: data.created_at ?? null,
    errorKind: errorJson?.kind ? String(errorJson.kind) : null,
    rejectionReasons,
  };
}

/** Analytics UI may force past refresh cadence; only hard-block on data / in-flight job. */
export function canForceCorrelationRefresh(
  dueState: CorrelationArchetypeDueState,
  opts?: { alreadyRunning?: boolean }
): boolean {
  if (opts?.alreadyRunning) return false;
  return dueState.reason !== 'insufficient_feature_days';
}

export function formatCorrelationDueMessage(
  dueState: CorrelationArchetypeDueState,
  opts?: { alreadyRunning?: boolean }
): string {
  if (opts?.alreadyRunning) {
    return 'A correlation refresh is already running. Try again in a few minutes.';
  }

  switch (dueState.reason) {
    case 'insufficient_feature_days':
      return `Need at least ${dueState.minFeatureDays} days of tracked features before a correlation profile can run (you have ${dueState.featureDays}).`;
    case 'not_due_yet':
    case 'insufficient_new_feature_days':
    case 'no_active_archetype':
    case 'refresh_interval_elapsed_with_new_data':
      return 'You can re-run the correlation pipeline from Analytics.';
    default:
      return dueState.due
        ? 'Ready to run the correlation pipeline.'
        : `Correlation refresh is blocked (${dueState.reason}).`;
  }
}

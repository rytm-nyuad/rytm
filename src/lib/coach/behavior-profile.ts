import type { SupabaseClient } from '@supabase/supabase-js';

export const BEHAVIOR_PROFILE_REFRESH_DAYS = 21;
export const BEHAVIOR_PROFILE_MIN_FEATURE_DAYS = 14;
export const BEHAVIOR_PROFILE_MIN_NEW_FEATURE_DAYS = 7;

/** Feature keys used by Python clustering (categories A/B/D + overall_score for ordering). */
const CLUSTERING_FEATURE_KEYS = [
  'sleep_duration_hours',
  'sleep_efficiency',
  'deep_ratio',
  'rem_ratio',
  'hrv_rmssd',
  'readiness_score',
  'bedtime_consistency_score',
  'sleep_start_time_variability_7d',
  'caffeine_cups',
  'steps',
  'total_active_minutes',
  'sedentary_minutes',
  'sedentary_burden_score',
  'resting_heart_rate',
  'breathing_rate',
  'blood_oxygen_avg',
  'calories_out',
  'activity_calories',
  'bmr_calories',
  'mood',
  'stress',
  'energy',
  'focus',
  'social_connectedness',
  'workload',
  'emotions_count',
  'negative_emotion_ratio',
  'overall_score',
] as const;

export type BehaviorProfileDueState = {
  due: boolean;
  reason: string;
  featureDays: number;
  minFeatureDays: number;
  minNewFeatureDays: number;
  newFeatureDays?: number;
  latestProfileId?: string;
  latestCreatedAt?: string;
  latestDataWindowEnd?: string | null;
  nextDueDate?: string;
};

async function collectDistinctFeatureDates(
  supabaseAdmin: SupabaseClient,
  userId: string,
  options?: { afterDateExclusive?: string }
): Promise<Set<string>> {
  const dates = new Set<string>();
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    let query = supabaseAdmin
      .from('daily_features1')
      .select('feature_date')
      .eq('user_id', userId)
      .in('feature_key', [...CLUSTERING_FEATURE_KEYS])
      .range(offset, offset + pageSize - 1);

    if (options?.afterDateExclusive) {
      query = query.gt('feature_date', options.afterDateExclusive);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to count daily_features1 rows: ${error.message}`);
    }

    const rows = data ?? [];
    for (const row of rows) {
      if (row.feature_date) {
        dates.add(row.feature_date);
      }
    }

    if (rows.length < pageSize) {
      break;
    }
    offset += pageSize;
  }

  return dates;
}

export async function countFeatureDays(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<number> {
  const dates = await collectDistinctFeatureDates(supabaseAdmin, userId);
  return dates.size;
}

export async function countFeatureDaysAfter(
  supabaseAdmin: SupabaseClient,
  userId: string,
  afterDateExclusive: string
): Promise<number> {
  const dates = await collectDistinctFeatureDates(supabaseAdmin, userId, {
    afterDateExclusive,
  });
  return dates.size;
}

export async function getBehaviorProfileDueState(
  supabaseAdmin: SupabaseClient,
  userId: string,
  asOf: Date = new Date()
): Promise<BehaviorProfileDueState> {
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
    .from('user_behavior_profiles1')
    .select('profile_id, created_at, data_window_end')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load active behavior profile: ${error.message}`);
  }

  if (!latest?.created_at) {
    return {
      due: true,
      reason: 'no_active_profile',
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
      latestProfileId: latest.profile_id,
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
      latestProfileId: latest.profile_id,
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
    latestProfileId: latest.profile_id,
    latestCreatedAt: latest.created_at,
    latestDataWindowEnd: dataWindowEnd,
    nextDueDate,
  };
}

export async function hasRunningBehaviorProfileJob(
  supabaseAdmin: SupabaseClient,
  userId: string,
  withinHours = 2
): Promise<boolean> {
  const cutoff = new Date();
  cutoff.setUTCHours(cutoff.getUTCHours() - withinHours);

  const { data, error } = await supabaseAdmin
    .from('user_behavior_profiles1')
    .select('profile_id')
    .eq('user_id', userId)
    .eq('status', 'running')
    .gte('created_at', cutoff.toISOString())
    .limit(1);

  if (error) {
    throw new Error(`Failed to check running behavior profile jobs: ${error.message}`);
  }

  return (data ?? []).length > 0;
}

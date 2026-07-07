import type { SupabaseClient } from '@supabase/supabase-js';

export const BEHAVIOR_PROFILE_REFRESH_DAYS = 21;
export const BEHAVIOR_PROFILE_MIN_FEATURE_DAYS = 7;

export type BehaviorProfileDueState = {
  due: boolean;
  reason: string;
  featureDays: number;
  minFeatureDays: number;
  latestProfileId?: string;
  latestCreatedAt?: string;
  nextDueDate?: string;
};

export async function countFeatureDays(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<number> {
  const dates = new Set<string>();
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('daily_features1')
      .select('feature_date')
      .eq('user_id', userId)
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(`Failed to count daily_features1 rows: ${error.message}`);
    }

    const rows = data ?? [];
    for (const row of rows) {
      dates.add(row.feature_date);
    }

    if (rows.length < pageSize) {
      break;
    }
    offset += pageSize;
  }

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
    };
  }

  const { data: latest, error } = await supabaseAdmin
    .from('user_behavior_profiles1')
    .select('profile_id, created_at')
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
    };
  }

  const createdAt = new Date(latest.created_at);
  const nextDue = new Date(createdAt);
  nextDue.setUTCDate(nextDue.getUTCDate() + BEHAVIOR_PROFILE_REFRESH_DAYS);
  const due = asOf >= nextDue;

  return {
    due,
    reason: due ? 'refresh_interval_elapsed' : 'not_due_yet',
    featureDays,
    minFeatureDays: BEHAVIOR_PROFILE_MIN_FEATURE_DAYS,
    latestProfileId: latest.profile_id,
    latestCreatedAt: latest.created_at,
    nextDueDate: nextDue.toISOString().slice(0, 10),
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

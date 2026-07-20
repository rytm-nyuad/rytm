import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  ActionRatingValue,
  ActionUserRating,
  ActiveGoal,
  CoachAction,
  DailyPlan,
} from '@/lib/coach/types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACTION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const RATING_LABELS: Record<ActionRatingValue, string> = {
  1: 'Not helpful',
  2: 'Slightly helpful',
  3: 'Somewhat helpful',
  4: 'Helpful',
  5: 'Very helpful',
};
const MAX_COMMENT_LEN = 2000;

export function isValidCoachDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function isValidActionId(value: string): boolean {
  return ACTION_ID_RE.test(value);
}

export function parseActionRatingValue(value: unknown): ActionRatingValue | null {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num) || num < 1 || num > 5) return null;
  return num as ActionRatingValue;
}

function sanitizeComment(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_COMMENT_LEN);
}

function mapRatingRow(row: Record<string, unknown>): ActionUserRating {
  const ratingNum = parseActionRatingValue(row.rating_value_num);
  return {
    rating_id: typeof row.rating_id === 'string' ? row.rating_id : undefined,
    action_id: String(row.action_id ?? ''),
    rating_value_num: ratingNum,
    rating_value_text:
      typeof row.rating_value_text === 'string' ? row.rating_value_text : null,
    comment: typeof row.comment === 'string' ? row.comment : null,
    provided_at: typeof row.provided_at === 'string' ? row.provided_at : null,
  };
}

function mapCoachAction(
  action: Record<string, unknown>,
  rating?: ActionUserRating | null
): CoachAction {
  const completedRaw = action.user_completed_at;
  return {
    action_id: String(action.action_id ?? ''),
    domain: String(action.domain ?? 'other'),
    title: String(action.title ?? ''),
    description: typeof action.description === 'string' ? action.description : undefined,
    duration_minutes: typeof action.duration_minutes === 'number' ? action.duration_minutes : undefined,
    effort_level:
      action.effort_level === 'low' || action.effort_level === 'medium' || action.effort_level === 'high'
        ? action.effort_level
        : 'medium',
    when:
      action.when === 'morning' ||
      action.when === 'midday' ||
      action.when === 'afternoon' ||
      action.when === 'evening' ||
      action.when === 'before_bed' ||
      action.when === 'anytime'
        ? (action.when as CoachAction['when'])
        : undefined,
    priority: typeof action.priority === 'number' ? action.priority : 999,
    rationale:
      typeof action.rationale === 'string'
        ? action.rationale
        : typeof action.reason === 'string'
          ? action.reason
          : '',
    user_completed_at:
      typeof completedRaw === 'string' && completedRaw.trim()
        ? completedRaw
        : null,
    user_rating: rating ?? null,
  };
}

async function loadRatingsByActionId(
  userId: string,
  forDate: string
): Promise<Map<string, ActionUserRating>> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('action_user_ratings1')
    .select(
      'rating_id, action_id, rating_value_num, rating_value_text, comment, provided_at'
    )
    .eq('user_id', userId)
    .eq('for_date', forDate);

  const map = new Map<string, ActionUserRating>();
  if (error) {
    // Table may not exist yet in some environments — don't fail the plan load.
    console.warn('action_user_ratings1 load skipped:', error.message);
    return map;
  }
  for (const row of data ?? []) {
    if (!row || typeof row !== 'object') continue;
    const rating = mapRatingRow(row as Record<string, unknown>);
    if (rating.action_id) map.set(rating.action_id, rating);
  }
  return map;
}

export async function getActiveGoal(userId: string): Promise<ActiveGoal | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('user_goals1')
    .select('goal_id, title, goal_type, status, goal_spec_json, created_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching active goal:', error);
    return null;
  }
  return data;
}

export async function getTodayPlan(userId: string, forDate: string): Promise<DailyPlan | null> {
  const supabase = createSupabaseAdminClient();
  const { data: plan, error: planError } = await supabase
    .from('daily_plans1')
    .select('*')
    .eq('user_id', userId)
    .eq('for_date', forDate)
    .maybeSingle();

  if (planError || !plan) return null;

  const [
    { data: stateHistory, error: stateHistoryError },
    { data: overallRow },
    ratingsByAction,
  ] = await Promise.all([
    supabase
      .from('user_state_history2')
      .select('actions_generated_json')
      .eq('user_id', userId)
      .eq('date', forDate)
      .maybeSingle(),
    supabase
      .from('daily_overall')
      .select('overall_score')
      .eq('user_id', userId)
      .eq('date', forDate)
      .maybeSingle(),
    loadRatingsByActionId(userId, forDate),
  ]);

  if (stateHistoryError) {
    console.error('Error fetching plan actions from state history:', stateHistoryError);
    return null;
  }

  const rawActions = Array.isArray(stateHistory?.actions_generated_json?.actions)
    ? stateHistory.actions_generated_json.actions
    : [];

  const parsedActions: CoachAction[] = rawActions
    .filter((action: unknown): action is Record<string, unknown> => !!action && typeof action === 'object')
    .map((action: Record<string, unknown>) =>
      mapCoachAction(action, ratingsByAction.get(String(action.action_id ?? '')) ?? null)
    )
    .sort((a, b) => a.priority - b.priority);

  const budgetApplied =
    plan.budget_applied_json && typeof plan.budget_applied_json === 'object'
      ? plan.budget_applied_json
      : {};
  const energyMode =
    typeof budgetApplied.energy_mode === 'string' ? budgetApplied.energy_mode : null;

  return {
    plan_id: plan.plan_id,
    morning_message: plan.morning_message,
    for_date: plan.for_date,
    updated_at: plan.updated_at,
    selected_domains: plan.selected_domains_json || plan.selected_domains || [],
    actions: parsedActions,
    overall_score:
      typeof overallRow?.overall_score === 'number' ? overallRow.overall_score : null,
    energy_mode: energyMode,
  };
}

/**
 * Toggle user completion for a coach action.
 * Persists to user_state_history2.actions_generated_json and best-effort to plan_actions1.
 */
export async function setCoachActionCompletion(
  userId: string,
  forDate: string,
  actionId: string,
  completed: boolean
): Promise<{ user_completed_at: string | null; actions: CoachAction[] }> {
  const supabase = createSupabaseAdminClient();

  const { data: stateHistory, error: loadError } = await supabase
    .from('user_state_history2')
    .select('actions_generated_json')
    .eq('user_id', userId)
    .eq('date', forDate)
    .maybeSingle();

  if (loadError) {
    throw new Error(`Failed to load actions: ${loadError.message}`);
  }
  if (!stateHistory) {
    throw new Error('No plan actions found for this date');
  }

  const payload =
    stateHistory.actions_generated_json &&
    typeof stateHistory.actions_generated_json === 'object'
      ? { ...stateHistory.actions_generated_json }
      : { actions: [] };

  const rawActions = Array.isArray(payload.actions) ? [...payload.actions] : [];
  const completedAt = completed ? new Date().toISOString() : null;
  let matched = false;

  const nextActions = rawActions.map((action: unknown) => {
    if (!action || typeof action !== 'object') return action;
    const row = action as Record<string, unknown>;
    if (String(row.action_id ?? '') !== actionId) return action;
    matched = true;
    return { ...row, user_completed_at: completedAt };
  });

  if (!matched) {
    throw new Error('Action not found on this plan');
  }

  const nextPayload = { ...payload, actions: nextActions };
  const { error: updateError } = await supabase
    .from('user_state_history2')
    .update({ actions_generated_json: nextPayload })
    .eq('user_id', userId)
    .eq('date', forDate);

  if (updateError) {
    throw new Error(`Failed to save completion: ${updateError.message}`);
  }

  // Best-effort mirror onto plan_actions1 (requires plan_actions_user_completion.sql).
  const { error: planActionError } = await supabase
    .from('plan_actions1')
    .update({ user_completed_at: completedAt })
    .eq('user_id', userId)
    .eq('for_date', forDate)
    .eq('action_id', actionId);

  if (planActionError) {
    console.warn(
      'plan_actions1 user_completed_at update skipped:',
      planActionError.message
    );
  }

  const ratingsByAction = await loadRatingsByActionId(userId, forDate);
  const actions = nextActions
    .filter((action: unknown): action is Record<string, unknown> => !!action && typeof action === 'object')
    .map((action: Record<string, unknown>) =>
      mapCoachAction(action, ratingsByAction.get(String(action.action_id ?? '')) ?? null)
    )
    .sort((a, b) => a.priority - b.priority);

  return { user_completed_at: completedAt, actions };
}

/**
 * Upsert a user's rating + optional comment for one coach action.
 * Uses parameterized Supabase queries only (no string-built SQL).
 */
export async function upsertCoachActionRating(
  userId: string,
  forDate: string,
  planId: string,
  actionId: string,
  ratingValue: ActionRatingValue,
  comment: string | null
): Promise<{ rating: ActionUserRating; actions: CoachAction[] }> {
  if (!isValidCoachDate(forDate)) {
    throw new Error('Invalid forDate');
  }
  if (!isValidActionId(actionId)) {
    throw new Error('Invalid actionId');
  }
  if (!/^[0-9a-f-]{36}$/i.test(planId)) {
    throw new Error('Invalid planId');
  }

  const sanitizedComment = sanitizeComment(comment);
  const supabase = createSupabaseAdminClient();

  // Ownership: plan must belong to this user + date.
  const { data: plan, error: planError } = await supabase
    .from('daily_plans1')
    .select('plan_id')
    .eq('plan_id', planId)
    .eq('user_id', userId)
    .eq('for_date', forDate)
    .maybeSingle();

  if (planError) {
    throw new Error(`Failed to verify plan: ${planError.message}`);
  }
  if (!plan) {
    throw new Error('Plan not found for this user and date');
  }

  // Action must exist on this day's generated plan (or plan_actions1).
  const { data: stateHistory } = await supabase
    .from('user_state_history2')
    .select('actions_generated_json')
    .eq('user_id', userId)
    .eq('date', forDate)
    .maybeSingle();

  const rawActions = Array.isArray(stateHistory?.actions_generated_json?.actions)
    ? stateHistory!.actions_generated_json.actions
    : [];
  const actionOnPlan = rawActions.some(
    (a: unknown) =>
      !!a &&
      typeof a === 'object' &&
      String((a as Record<string, unknown>).action_id ?? '') === actionId
  );

  const { data: planAction } = await supabase
    .from('plan_actions1')
    .select('plan_action_id')
    .eq('user_id', userId)
    .eq('for_date', forDate)
    .eq('plan_id', planId)
    .eq('action_id', actionId)
    .maybeSingle();

  if (!actionOnPlan && !planAction) {
    throw new Error('Action not found on this plan');
  }

  const now = new Date().toISOString();
  const sharedFields = {
    plan_id: planId,
    plan_action_id: planAction?.plan_action_id ?? null,
    rating_scale: 'likert_1_5' as const,
    rating_value_num: ratingValue,
    rating_value_text: RATING_LABELS[ratingValue],
    comment: sanitizedComment,
    provided_at: now,
    updated_at: now,
  };

  // Select-then-update/insert avoids depending on a specific unique-constraint name
  // already existing in production.
  const { data: existing, error: existingError } = await supabase
    .from('action_user_ratings1')
    .select('rating_id')
    .eq('user_id', userId)
    .eq('for_date', forDate)
    .eq('action_id', actionId)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to load existing rating: ${existingError.message}`);
  }

  let savedRow: Record<string, unknown> | null = null;
  if (existing?.rating_id) {
    const { data: updated, error: updateError } = await supabase
      .from('action_user_ratings1')
      .update(sharedFields)
      .eq('rating_id', existing.rating_id)
      .eq('user_id', userId)
      .select(
        'rating_id, action_id, rating_value_num, rating_value_text, comment, provided_at'
      )
      .single();
    if (updateError) {
      throw new Error(`Failed to update rating: ${updateError.message}`);
    }
    savedRow = (updated ?? null) as Record<string, unknown> | null;
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from('action_user_ratings1')
      .insert({
        user_id: userId,
        for_date: forDate,
        action_id: actionId,
        ...sharedFields,
      })
      .select(
        'rating_id, action_id, rating_value_num, rating_value_text, comment, provided_at'
      )
      .single();
    if (insertError) {
      throw new Error(`Failed to save rating: ${insertError.message}`);
    }
    savedRow = (inserted ?? null) as Record<string, unknown> | null;
  }

  const rating = mapRatingRow(savedRow ?? { action_id: actionId });
  const ratingsByAction = await loadRatingsByActionId(userId, forDate);
  ratingsByAction.set(actionId, rating);

  const actions = rawActions
    .filter((action: unknown): action is Record<string, unknown> => !!action && typeof action === 'object')
    .map((action: Record<string, unknown>) =>
      mapCoachAction(action, ratingsByAction.get(String(action.action_id ?? '')) ?? null)
    )
    .sort((a, b) => a.priority - b.priority);

  return { rating, actions };
}

export async function hasOverallScoreToday(userId: string, forDate: string): Promise<boolean> {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from('daily_overall')
    .select('id')
    .eq('user_id', userId)
    .eq('date', forDate)
    .maybeSingle();

  return !!data;
}

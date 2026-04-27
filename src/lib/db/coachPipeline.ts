import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ActiveGoal, CoachAction, DailyPlan } from '@/lib/coach/types';

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

  const { data: stateHistory, error: stateHistoryError } = await supabase
    .from('user_state_history2')
    .select('actions_generated_json')
    .eq('user_id', userId)
    .eq('date', forDate)
    .maybeSingle();

  if (stateHistoryError) {
    console.error('Error fetching plan actions from state history:', stateHistoryError);
    return null;
  }

  const rawActions = Array.isArray(stateHistory?.actions_generated_json?.actions)
    ? stateHistory.actions_generated_json.actions
    : [];

  const parsedActions: CoachAction[] = rawActions
    .filter((action: unknown): action is Record<string, unknown> => !!action && typeof action === 'object')
    .map((action: Record<string, unknown>) => ({
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
    }));

  return {
    plan_id: plan.plan_id,
    morning_message: plan.morning_message,
    for_date: plan.for_date,
    selected_domains: plan.selected_domains_json || plan.selected_domains || [],
    actions: parsedActions,
  };
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

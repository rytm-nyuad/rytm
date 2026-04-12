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
    .select('plan_id, morning_message, for_date, selected_domains')
    .eq('user_id', userId)
    .eq('for_date', forDate)
    .maybeSingle();

  if (planError || !plan) return null;

  const { data: actions, error: actionsError } = await supabase
    .from('plan_actions1')
    .select('action_id, domain, title, description, duration_minutes, effort_level, priority, rationale, tags')
    .eq('plan_id', plan.plan_id)
    .order('priority', { ascending: true });

  if (actionsError) {
    console.error('Error fetching plan actions:', actionsError);
    return null;
  }

  // Extract `when` from tags (stored as "when:morning" etc.)
  const parsedActions: CoachAction[] = (actions || []).map((a) => {
    const whenTag = (a.tags as string[] || []).find((t: string) => t.startsWith('when:'));
    return {
      ...a,
      when: whenTag ? whenTag.replace('when:', '') as CoachAction['when'] : undefined,
    };
  });

  return {
    plan_id: plan.plan_id,
    morning_message: plan.morning_message,
    for_date: plan.for_date,
    selected_domains: plan.selected_domains || [],
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

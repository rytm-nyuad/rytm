export interface CoachAction {
  action_id: string;
  domain: string;
  title: string;
  description?: string;
  duration_minutes?: number;
  effort_level: 'low' | 'medium' | 'high';
  when?: 'morning' | 'midday' | 'afternoon' | 'evening' | 'before_bed' | 'anytime';
  priority: number;
  rationale: string;
}

export interface MorningPlanResult {
  plan_id: string;
  morning_message: string;
  actions: CoachAction[];
  debug?: {
    energy_mode: string;
    selected_domains: string[];
    confidence: number;
    attempts: number;
    holistic_status_report?: any;
  };
}

export interface ActiveGoal {
  goal_id: string;
  title: string;
  goal_type: string;
  status: string;
  goal_spec_json: any;
  created_at: string;
}

export interface DailyPlan {
  plan_id: string;
  morning_message: string;
  for_date: string;
  updated_at?: string;
  selected_domains: string[];
  actions: CoachAction[];
}

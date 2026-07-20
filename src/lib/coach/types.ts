/** 1–5 Likert rating for a coach action (matches rating_scale_v1 = likert_1_5). */
export type ActionRatingValue = 1 | 2 | 3 | 4 | 5;

export interface ActionUserRating {
  rating_id?: string;
  action_id: string;
  rating_value_num: ActionRatingValue | null;
  rating_value_text?: string | null;
  comment?: string | null;
  provided_at?: string | null;
}

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
  /** ISO timestamp when the user checked this action off in the coach UI. */
  user_completed_at?: string | null;
  /** Latest user rating/comment from action_user_ratings1, if any. */
  user_rating?: ActionUserRating | null;
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
  overall_score?: number | null;
  energy_mode?: string | null;
}

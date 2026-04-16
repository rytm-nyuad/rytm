import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type DailyCheckinRow = {
  sleep_quality: number | null;
  energy_score: number | null;
  focus_score: number | null;
  workload_score: number | null;
  coping_capacity_score: number | null;
  stress_score: number | null;
  social_score: number | null;
  mood_score: number | null;
  mood_emotions: string[] | null;
};

export type DailyCheckinRelation2 = {
  stress_minus_workload: number | null;
  stress_minus_coping: number | null;
  coping_minus_workload: number | null;
  stress_minus_sleep: number | null;
  sleep_minus_energy: number | null;
  focus_minus_energy: number | null;
  focus_minus_stress: number | null;
  mood_minus_stress: number | null;
  mood_minus_energy: number | null;
  social_minus_mood: number | null;
  emotion_count: number;
};

function diff(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return a - b;
}

export function compute_checkin_relations(
  checkin_row: DailyCheckinRow | null | undefined
): DailyCheckinRelation2 | null {
  if (!checkin_row) {
    return null;
  }

  const emotions = Array.isArray(checkin_row.mood_emotions)
    ? checkin_row.mood_emotions
    : [];

  return {
    stress_minus_workload: diff(checkin_row.stress_score, checkin_row.workload_score),
    stress_minus_coping: diff(checkin_row.stress_score, checkin_row.coping_capacity_score),
    coping_minus_workload: diff(checkin_row.coping_capacity_score, checkin_row.workload_score),
    stress_minus_sleep: diff(checkin_row.stress_score, checkin_row.sleep_quality),
    sleep_minus_energy: diff(checkin_row.sleep_quality, checkin_row.energy_score),
    focus_minus_energy: diff(checkin_row.focus_score, checkin_row.energy_score),
    focus_minus_stress: diff(checkin_row.focus_score, checkin_row.stress_score),
    mood_minus_stress: diff(checkin_row.mood_score, checkin_row.stress_score),
    mood_minus_energy: diff(checkin_row.mood_score, checkin_row.energy_score),
    social_minus_mood: diff(checkin_row.social_score, checkin_row.mood_score),
    emotion_count: emotions.length,
  };
}

export async function upsert_daily_checkin_relation2(
  user_id: string,
  date: string,
  relations: DailyCheckinRelation2 | null,
  supabaseAdmin?: SupabaseClient
): Promise<DailyCheckinRelation2 | null> {
  if (!relations) {
    return null;
  }

  const client = supabaseAdmin ?? createSupabaseAdminClient();
  const payload = {
    user_id,
    checkin_date: date,
    ...relations,
  };

  const { error } = await client
    .from("daily_checkin_relation2")
    .upsert(payload, { onConflict: "user_id,checkin_date" });

  if (error) {
    throw new Error(`Failed to upsert daily_checkin_relation2: ${error.message}`);
  }

  return relations;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatLocalDate, getCanonicalTimeZone, type LocalDateString } from "@/lib/time";
import { withSupabaseRetry } from "./supabaseRetry";

type FitbitSleepDailyRow = {
  app_user_id: string;
  date: string;
  sleep_start_time: string | null;
  sleep_end_time: string | null;
  minutes_asleep: number | null;
  minutes_awake: number | null;
  time_in_bed: number | null;
  deep_minutes: number | null;
  rem_minutes: number | null;
  wake_minutes: number | null;
};

type FitbitActivityDailyRow = {
  app_user_id: string;
  date: string;
  steps: number | null;
  distance_total_km: number | null;
  energy_burned_calories_out: number | null;
  activity_calories: number | null;
  bmr_calories: number | null;
  lightly_active_minutes: number | null;
  fairly_active_minutes: number | null;
  very_active_minutes: number | null;
  sedentary_minutes: number | null;
  resting_heart_rate: number | null;
};

type FitbitHrvDailyRow = {
  app_user_id: string;
  date: string;
  hrv_daily_rmssd: number | null;
  hrv_deep_rmssd: number | null;
};

type FitbitSpo2DailyRow = {
  app_user_id: string;
  date: string;
  spo2_avg: number | null;
};

type FitbitOvernightDailyRow = {
  app_user_id: string;
  date: string;
  oxygen_variation: number | null;
  blood_oxygen_avg: number | null;
  breathing_rate: number | null;
  skin_temp_relative: number | null;
};

type DailyNutrition2Row = {
  total_kcal_day: number | null;
  protein_g_day: number | null;
  carbs_g_day: number | null;
  fat_g_day: number | null;
  sugar_g_day: number | null;
  meal_count_day: number;
  breakfast_logged: boolean;
  lunch_logged: boolean;
  dinner_logged: boolean;
  time_first_meal_minutes: number | null;
  time_last_meal_minutes: number | null;
  eating_window_minutes: number | null;
  nutrition_confidence_day: number;
  meals_missing_day: boolean;
};

type MealLogRow = {
  id: string;
  meal_type: string | null;
  meal_local_date: string;
  meal_datetime: string | null;
  description: string | null;
};

type MealProcessingRunRow = {
  meal_id: string;
  status: "queued" | "processing" | "success" | "failed";
  totals: {
    caffeine_mg?: number | null;
  } | null;
  processed_at: string | null;
  created_at: string;
};

type DailyCheckinRow = {
  sleep_quality: number | null;
  energy_score: number | null;
  focus_score: number | null;
  workload_score: number | null;
  coping_capacity_score: number | null;
  stress_score: number | null;
  stress_unexpected_score: number | null;
  social_score: number | null;
  mood_score: number | null;
  mood_stability_score: number | null;
  mood_emotions: string[] | null;
};

type DailyCheckinRelation2Row = {
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
  emotion_count: number | null;
};

type JournalSummary2Row = {
  themes: string[] | null;
  episodic_events:
    | Array<{
        event_type: string;
        status: "started" | "ongoing" | "resolved";
        time_horizon: "today" | "this_week" | "ongoing";
        confidence: number;
        evidence_message_ids?: string[];
      }>
    | null;
  stressor_types:
    | Array<{
        type: "academic" | "social" | "health" | "family" | "financial" | "time_pressure" | "uncertainty" | "other";
        confidence: number;
        controllability: "low" | "med" | "high";
        evidence_message_ids?: string[];
      }>
    | null;
  coping_actions:
    | Array<{
        action: string;
        effectiveness: "helped" | "didnt_help" | "unsure";
        evidence_message_ids?: string[];
      }>
    | null;
  barriers: string[] | null;
  tone_hint: "supportive" | "neutral" | "encouraging" | null;
  risk_flags: string[] | null;
  self_appraisal_style: "catastrophizing" | "balanced" | "optimistic" | null;
  self_efficacy_language: "low" | "med" | "high" | null;
  goals_conflict_today: string | null;
  evidence_quotes: string[] | null;
  extractor_confidence: number;
};

type StateHistoryCompactRow = {
  date: string;
  state_snapshot_json: {
    baselines?: Record<
      string,
      {
        fast_center?: number | null;
        fast_scale?: number | null;
        slow_center?: number | null;
        slow_scale?: number | null;
        z_fast_today?: number | null;
        z_slow_today?: number | null;
        vol_fast?: number | null;
        vol_class?: "stable" | "moderate" | "volatile";
      }
    >;
    uncertainty?: {
      baseline_stability_flags?: {
        fast_ready?: boolean;
        slow_ready?: boolean;
      };
    };
  } | null;
};

type UserStateCurrent2Row = {
  as_of_date: string;
  state_json: {
    baselines?: Record<
      string,
      {
        fast?: {
          n_valid?: number;
          center_ewma?: number | null;
          scale_robust?: number | null;
        };
        slow?: {
          n_valid?: number;
          center_ewma?: number | null;
          scale_robust?: number | null;
        };
      }
    >;
    uncertainty?: {
      baseline_stability_flags?: {
        fast_ready?: boolean;
        slow_ready?: boolean;
      };
    };
  } | null;
};

type ProxyBaselineStats = {
  center: number | null;
  scale: number | null;
  source: "slow" | "fast" | null;
};

type ProxyBaselineContext = {
  ready: boolean;
  feature_stats: Record<"hrv_daily_rmssd" | "resting_heart_rate" | "sleep_duration_hours", ProxyBaselineStats>;
};

type DailyOverallRow = {
  overall_score: number | null;
};

type BundleMissingness = {
  missing_sleep: boolean;
  missing_activity: boolean;
  missing_hrv: boolean;
  missing_overnight: boolean;
  missing_nutrition: boolean;
  missing_checkin: boolean;
  missing_journal: boolean;
  missing_goals: boolean;
  missing_proxy: boolean;
};

type BundleConfidence = {
  confidence_sleep: number;
  confidence_activity: number;
  confidence_recovery: number;
  confidence_nutrition: number;
  confidence_checkin: number;
  confidence_journal: number;
  confidence_goals: number;
  confidence_proxy: number;
};

export type DailyInputBundleV1 = {
  bundle_version: "v1";
  meta: {
    user_id: string;
    date: LocalDateString;
    source_local_date: LocalDateString;
    timezone: string | null;
    generated_at: string;
  };
  missingness: BundleMissingness;
  confidence: BundleConfidence;
  core_signals: {
    overall_true_today: number;
    physio_proxy_score_0_100: number | null;
    gap_today: number | null;
  };
  watch: {
    hrv: {
      hrv_daily_rmssd: number | null;
      hrv_deep_rmssd: number | null;
    };
    sleep: {
      sleep_duration_hours: number | null;
      sleep_efficiency: number | null;
      sleep_onset_time_minutes: number | null;
      wake_time_minutes: number | null;
      sleep_midpoint_minutes: number | null;
      deep_ratio_pct: number | null;
      rem_ratio_pct: number | null;
      wake_ratio_pct: number | null;
      sleep_fragmentation_index: number | null;
    };
    activity: {
      steps: number | null;
      distance_total_km: number | null;
      total_active_minutes: number | null;
      mvpa_minutes: number | null;
      sedentary_minutes: number | null;
      active_ratio: number | null;
      sedentary_ratio: number | null;
      energy_burned_calories_out: number | null;
      activity_calories: number | null;
      bmr_calories: number | null;
      resting_heart_rate: number | null;
    };
    overnight: {
      spo2_avg: number | null;
      oxygen_variation: number | null;
      blood_oxygen_avg: number | null;
      breathing_rate: number | null;
      skin_temp_relative: number | null;
    };
  };
  nutrition: {
    daily_nutrition: {
      total_kcal_day: number | null;
      protein_g_day: number | null;
      carbs_g_day: number | null;
      fat_g_day: number | null;
      sugar_g_day: number | null;
      meal_count_day: number;
      breakfast_logged: boolean;
      lunch_logged: boolean;
      dinner_logged: boolean;
      time_first_meal_minutes: number | null;
      time_last_meal_minutes: number | null;
      eating_window_minutes: number | null;
      nutrition_confidence_day: number;
      meals_missing_day: boolean;
    };
    meal_context: {
      meal_descriptions: Array<{
        meal_id: string;
        meal_type: string | null;
        logged_at_local: string | null;
        description: string;
        estimated_caffeine_mg: number | null;
      }>;
      estimated_caffeine_mg_day: number | null;
      caffeine_after_2pm: boolean | null;
    };
  };
  checkin: {
    raw: {
      mood_score: number | null;
      stress_score: number | null;
      energy_score: number | null;
      focus_score: number | null;
      workload_score: number | null;
      social_score: number | null;
      sleep_quality: number | null;
      coping_capacity_score: number | null;
      stress_unexpected_score: number | null;
      mood_stability_score: number | null;
      emotions: string[] | null;
    };
    intrarelations: {
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
      emotion_count: number | null;
    };
  };
  journal: {
    themes: string[];
    episodic_events: Array<{
      event_type: string;
      status: "started" | "ongoing" | "resolved";
      time_horizon: "today" | "this_week" | "ongoing";
      confidence: number;
    }>;
    stressor_types: Array<{
      type: "academic" | "social" | "health" | "family" | "financial" | "time_pressure" | "uncertainty" | "other";
      confidence: number;
      controllability: "low" | "med" | "high";
    }>;
    coping_actions: Array<{
      action: string;
      effectiveness: "helped" | "didnt_help" | "unsure";
    }>;
    barriers: string[];
    tone_hint: "supportive" | "neutral" | "encouraging" | null;
    risk_flags: string[];
    self_appraisal_style: "catastrophizing" | "balanced" | "optimistic" | null;
    self_efficacy_language: "low" | "med" | "high" | null;
    goals_conflict_today: string | null;
    evidence_quotes: string[];
  };
};

export type DailyInputBundleV12Row = {
  user_id: string;
  date: string;
  bundle_version: string;
  timezone: string | null;
  generated_at: string;
  overall_true_today: number;
  physio_proxy_score_0_100: number | null;
  gap_today: number | null;
  missingness_json: BundleMissingness;
  confidence_json: BundleConfidence;
  bundle_json: DailyInputBundleV1;
  created_at: string;
};

export type BuildDailyInputBundleV1Result = {
  localDate: LocalDateString;
  sourceLocalDate: LocalDateString;
  timezone: string;
  row: DailyInputBundleV12Row;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number | null, decimals = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function safeNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function ratio(numerator: number | null, denominator: number | null, decimals = 4): number | null {
  if (numerator === null || denominator === null || denominator === 0) {
    return null;
  }
  return roundTo(numerator / denominator, decimals);
}

function minutesFromMidnight(isoString: string | null, timezone: string): number | null {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;

  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const hour = Number(timeParts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(timeParts.find((part) => part.type === "minute")?.value ?? "0");

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function minutesFromStoredClockTime(isoString: string | null): number | null {
  if (!isoString) return null;

  const match = isoString.match(/T(\d{2}):(\d{2})/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function midpointIso(startIso: string | null, endIso: string | null): string | null {
  if (!startIso || !endIso) return null;
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return new Date((startMs + endMs) / 2).toISOString();
}

function computeZScore(value: number | null, center: number | null, scale: number | null): number | null {
  if (value === null || center === null || scale === null) return null;
  if (Math.abs(scale) < 1e-6) return null;
  return (value - center) / scale;
}

function clipProxyScore(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

function computePhysioProxyScore(
  hrvDailyRmssd: number | null,
  restingHeartRate: number | null,
  sleepDurationHours: number | null,
  baselineContext: ProxyBaselineContext | null
): number | null {
  if (!baselineContext?.ready) {
    return null;
  }

  const hrvZ = computeZScore(
    hrvDailyRmssd,
    baselineContext.feature_stats.hrv_daily_rmssd.center,
    baselineContext.feature_stats.hrv_daily_rmssd.scale
  );
  const rhrZ = computeZScore(
    restingHeartRate,
    baselineContext.feature_stats.resting_heart_rate.center,
    baselineContext.feature_stats.resting_heart_rate.scale
  );
  const sleepZ = computeZScore(
    sleepDurationHours,
    baselineContext.feature_stats.sleep_duration_hours.center,
    baselineContext.feature_stats.sleep_duration_hours.scale
  );

  if (hrvZ === null || rhrZ === null || sleepZ === null) {
    return null;
  }

  const proxyIndex = 0.5 * hrvZ - 0.3 * rhrZ + 0.2 * sleepZ;
  return clipProxyScore(50 + 15 * proxyIndex);
}

function computeProxyConfidence(
  baselineContext: ProxyBaselineContext | null,
  components: {
    hrvDailyRmssd: number | null;
    restingHeartRate: number | null;
    sleepDurationHours: number | null;
  }
): number {
  if (!baselineContext?.ready) return 0;
  const presentCount = [
    components.hrvDailyRmssd,
    components.restingHeartRate,
    components.sleepDurationHours,
  ].filter((value) => value !== null).length;

  if (presentCount < 3) return 0;

  const sourceScores = Object.values(baselineContext.feature_stats).map((stat) =>
    stat.source === "slow" ? 1 : stat.source === "fast" ? 0.75 : 0
  );

  const sourceConfidence =
    sourceScores.reduce<number>((sum, value) => sum + value, 0) / sourceScores.length;
  return roundTo(sourceConfidence, 4) ?? 0;
}

function getCompactFeatureBaseline(
  row: StateHistoryCompactRow | null,
  featureKey: "hrv_daily_rmssd" | "resting_heart_rate" | "sleep_duration_hours"
): ProxyBaselineStats {
  const baseline = row?.state_snapshot_json?.baselines?.[featureKey];
  if (!baseline) {
    return { center: null, scale: null, source: null };
  }

  if (baseline.slow_center != null && baseline.slow_scale != null) {
    return {
      center: safeNumber(baseline.slow_center),
      scale: safeNumber(baseline.slow_scale),
      source: "slow",
    };
  }

  if (baseline.fast_center != null && baseline.fast_scale != null) {
    return {
      center: safeNumber(baseline.fast_center),
      scale: safeNumber(baseline.fast_scale),
      source: "fast",
    };
  }

  return { center: null, scale: null, source: null };
}

function getCurrentStateFeatureBaseline(
  row: UserStateCurrent2Row | null,
  featureKey: "hrv_daily_rmssd" | "resting_heart_rate" | "sleep_duration_hours"
): ProxyBaselineStats {
  const baseline = row?.state_json?.baselines?.[featureKey];
  if (!baseline) {
    return { center: null, scale: null, source: null };
  }

  if (
    (baseline.slow?.n_valid ?? 0) >= 7 &&
    baseline.slow?.center_ewma != null &&
    baseline.slow?.scale_robust != null
  ) {
    return {
      center: safeNumber(baseline.slow.center_ewma),
      scale: safeNumber(baseline.slow.scale_robust),
      source: "slow",
    };
  }

  if (
    (baseline.fast?.n_valid ?? 0) >= 7 &&
    baseline.fast?.center_ewma != null &&
    baseline.fast?.scale_robust != null
  ) {
    return {
      center: safeNumber(baseline.fast.center_ewma),
      scale: safeNumber(baseline.fast.scale_robust),
      source: "fast",
    };
  }

  return { center: null, scale: null, source: null };
}

async function fetchProxyBaselineContext(
  client: SupabaseClient,
  userId: string,
  date: LocalDateString
): Promise<ProxyBaselineContext | null> {
  const [historyResult, currentResult] = await Promise.all([
    withSupabaseRetry("read latest user_state_history2 for proxy", () =>
      client
        .from("user_state_history2")
        .select("date, state_snapshot_json")
        .eq("user_id", userId)
        .lt("date", date)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle()
    ),
    withSupabaseRetry("read user_state_current2 for proxy", () =>
      client
        .from("user_state_current2")
        .select("as_of_date, state_json")
        .eq("user_id", userId)
        .maybeSingle()
    ),
  ]);

  if (historyResult.error) {
    throw new Error(`Failed to read user_state_history2 for proxy: ${historyResult.error.message}`);
  }
  if (currentResult.error) {
    throw new Error(`Failed to read user_state_current2 for proxy: ${currentResult.error.message}`);
  }

  const historyRow = (historyResult.data as StateHistoryCompactRow | null) ?? null;
  const currentRow = (currentResult.data as UserStateCurrent2Row | null) ?? null;

  const shouldUseCurrent =
    currentRow != null && currentRow.as_of_date < date;

  const featureStats = shouldUseCurrent
    ? {
        hrv_daily_rmssd: getCurrentStateFeatureBaseline(currentRow, "hrv_daily_rmssd"),
        resting_heart_rate: getCurrentStateFeatureBaseline(currentRow, "resting_heart_rate"),
        sleep_duration_hours: getCurrentStateFeatureBaseline(currentRow, "sleep_duration_hours"),
      }
    : {
        hrv_daily_rmssd: getCompactFeatureBaseline(historyRow, "hrv_daily_rmssd"),
        resting_heart_rate: getCompactFeatureBaseline(historyRow, "resting_heart_rate"),
        sleep_duration_hours: getCompactFeatureBaseline(historyRow, "sleep_duration_hours"),
      };

  const ready = Object.values(featureStats).every(
    (stat) => stat.center !== null && stat.scale !== null
  );

  return {
    ready,
    feature_stats: featureStats,
  };
}

async function fetchMaybeSingle<T>(
  client: SupabaseClient,
  table: string,
  userColumn: string,
  userId: string,
  dateColumn: string,
  localDate: LocalDateString,
  select = "*"
): Promise<T | null> {
  const { data, error } = await withSupabaseRetry(
    `read ${table}`,
    () =>
      client
        .from(table)
        .select(select)
        .eq(userColumn, userId)
        .eq(dateColumn, localDate)
        .maybeSingle()
  );

  if (error) {
    throw new Error(`Failed to read ${table}: ${error.message}`);
  }

  return (data as T | null) ?? null;
}

function buildSleepBundle(sleep: FitbitSleepDailyRow | null, timezone: string) {
  const minutesAsleep = safeNumber(sleep?.minutes_asleep);
  const timeInBed = safeNumber(sleep?.time_in_bed);
  const minutesAwake = safeNumber(sleep?.minutes_awake);
  const deepMinutes = safeNumber(sleep?.deep_minutes);
  const remMinutes = safeNumber(sleep?.rem_minutes);
  const wakeMinutes = safeNumber(sleep?.wake_minutes);
  const midpoint = midpointIso(sleep?.sleep_start_time ?? null, sleep?.sleep_end_time ?? null);

  return {
    sleep_duration_hours: minutesAsleep === null ? null : roundTo(minutesAsleep / 60, 2),
    sleep_efficiency: minutesAsleep !== null && timeInBed ? roundTo((minutesAsleep / timeInBed) * 100, 2) : null,
    sleep_onset_time_minutes: minutesFromStoredClockTime(sleep?.sleep_start_time ?? null),
    wake_time_minutes: minutesFromStoredClockTime(sleep?.sleep_end_time ?? null),
    sleep_midpoint_minutes: midpoint ? minutesFromMidnight(midpoint, timezone) : null,
    deep_ratio_pct: deepMinutes !== null && timeInBed ? roundTo((deepMinutes / timeInBed) * 100, 2) : null,
    rem_ratio_pct: remMinutes !== null && timeInBed ? roundTo((remMinutes / timeInBed) * 100, 2) : null,
    wake_ratio_pct: wakeMinutes !== null && timeInBed ? roundTo((wakeMinutes / timeInBed) * 100, 2) : null,
    sleep_fragmentation_index: ratio(minutesAwake, timeInBed, 4),
  };
}

function buildActivityBundle(
  activity: FitbitActivityDailyRow | null,
  sleep: FitbitSleepDailyRow | null
) {
  const lightly = safeNumber(activity?.lightly_active_minutes) ?? 0;
  const fairly = safeNumber(activity?.fairly_active_minutes) ?? 0;
  const very = safeNumber(activity?.very_active_minutes) ?? 0;
  const totalActiveMinutes =
    activity == null ? null : lightly + fairly + very;
  const mvpaMinutes = activity == null ? null : fairly + very;
  const timeInBed = safeNumber(sleep?.time_in_bed);
  const awakeWindow = timeInBed !== null ? Math.max(1440 - timeInBed, 0) : 1440;
  const sedentaryMinutes = safeNumber(activity?.sedentary_minutes);

  return {
    steps: safeNumber(activity?.steps),
    distance_total_km: safeNumber(activity?.distance_total_km),
    total_active_minutes: totalActiveMinutes,
    mvpa_minutes: mvpaMinutes,
    sedentary_minutes: sedentaryMinutes,
    active_ratio:
      totalActiveMinutes === null ? null : ratio(totalActiveMinutes, awakeWindow, 4),
    sedentary_ratio:
      sedentaryMinutes === null ? null : ratio(sedentaryMinutes, awakeWindow, 4),
    energy_burned_calories_out: safeNumber(activity?.energy_burned_calories_out),
    activity_calories: safeNumber(activity?.activity_calories),
    bmr_calories: safeNumber(activity?.bmr_calories),
    resting_heart_rate: safeNumber(activity?.resting_heart_rate),
  };
}

function buildNutritionBundle(nutrition: DailyNutrition2Row | null) {
  return {
    total_kcal_day: safeNumber(nutrition?.total_kcal_day),
    protein_g_day: safeNumber(nutrition?.protein_g_day),
    carbs_g_day: safeNumber(nutrition?.carbs_g_day),
    fat_g_day: safeNumber(nutrition?.fat_g_day),
    sugar_g_day: safeNumber(nutrition?.sugar_g_day),
    meal_count_day: nutrition?.meal_count_day ?? 0,
    breakfast_logged: nutrition?.breakfast_logged ?? false,
    lunch_logged: nutrition?.lunch_logged ?? false,
    dinner_logged: nutrition?.dinner_logged ?? false,
    time_first_meal_minutes: nutrition?.time_first_meal_minutes ?? null,
    time_last_meal_minutes: nutrition?.time_last_meal_minutes ?? null,
    eating_window_minutes: nutrition?.eating_window_minutes ?? null,
    nutrition_confidence_day: nutrition?.nutrition_confidence_day ?? 0,
    meals_missing_day: nutrition?.meals_missing_day ?? true,
  };
}

function buildThreeDayUtcWindow(localDate: LocalDateString) {
  const baseUtc = new Date(`${localDate}T00:00:00.000Z`);
  const start = new Date(baseUtc);
  start.setUTCDate(start.getUTCDate() - 1);

  const end = new Date(baseUtc);
  end.setUTCDate(end.getUTCDate() + 2);

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function formatLocalTime(isoString: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(isoString));
}

async function fetchMealContext(
  client: SupabaseClient,
  userId: string,
  date: LocalDateString,
  timezone: string
) {
  const { data: mealData, error: mealError } = await withSupabaseRetry(
    "read meal_logs for input bundle",
    () =>
      client
        .from("meal_logs")
        .select("id, meal_type, meal_local_date, meal_datetime, description")
        .eq("user_id", userId)
        .eq("meal_local_date", date)
        .order("meal_datetime", { ascending: true, nullsFirst: false })
  );

  if (mealError) {
    throw new Error(`Failed to read meal_logs for input bundle: ${mealError.message}`);
  }

  const meals = (mealData as MealLogRow[] | null) ?? [];

  if (meals.length === 0) {
    return {
      meal_descriptions: [],
      estimated_caffeine_mg_day: null,
      caffeine_after_2pm: null,
    };
  }

  const mealIds = meals.map((meal) => meal.id);
  const { data: runData, error: runError } = await withSupabaseRetry(
    "read meal_processing_runs for input bundle",
    () =>
      client
        .from("meal_processing_runs")
        .select("meal_id, status, totals, processed_at, created_at")
        .eq("user_id", userId)
        .eq("status", "success")
        .in("meal_id", mealIds)
        .order("processed_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
  );

  if (runError) {
    throw new Error(`Failed to read meal_processing_runs for input bundle: ${runError.message}`);
  }

  const latestRunByMealId = new Map<string, MealProcessingRunRow>();
  for (const run of (runData as MealProcessingRunRow[] | null) ?? []) {
    if (!latestRunByMealId.has(run.meal_id)) {
      latestRunByMealId.set(run.meal_id, run);
    }
  }

  let caffeineDayTotal = 0;
  let hasAnyCaffeineValue = false;
  let caffeineAfter2pm = false;

  const mealDescriptions = meals
    .filter((meal) => typeof meal.description === "string" && meal.description.trim().length > 0)
    .map((meal) => {
      const latestRun = latestRunByMealId.get(meal.id);
      const caffeineMg = safeNumber(latestRun?.totals?.caffeine_mg);

      if (caffeineMg !== null) {
        hasAnyCaffeineValue = true;
        caffeineDayTotal += caffeineMg;
        const localMinutes = minutesFromMidnight(meal.meal_datetime, timezone);
        if (localMinutes !== null && localMinutes >= 14 * 60 && caffeineMg > 0) {
          caffeineAfter2pm = true;
        }
      }

      return {
        meal_id: meal.id,
        meal_type: meal.meal_type,
        logged_at_local: meal.meal_datetime ? formatLocalTime(meal.meal_datetime, timezone) : null,
        description: meal.description!.trim(),
        estimated_caffeine_mg: caffeineMg,
      };
    });

  return {
    meal_descriptions: mealDescriptions,
    estimated_caffeine_mg_day: hasAnyCaffeineValue ? roundTo(caffeineDayTotal, 2) : null,
    caffeine_after_2pm: hasAnyCaffeineValue ? caffeineAfter2pm : null,
  };
}

function buildJournalBundle(journal: JournalSummary2Row | null) {
  return {
    themes: journal?.themes ?? [],
    episodic_events: journal?.episodic_events?.map((event) => ({
      event_type: event.event_type,
      status: event.status,
      time_horizon: event.time_horizon,
      confidence: clamp(safeNumber(event.confidence) ?? 0, 0, 1),
    })) ?? [],
    stressor_types: journal?.stressor_types?.map((type) => ({
      type: type.type,
      confidence: clamp(safeNumber(type.confidence) ?? 0, 0, 1),
      controllability: type.controllability,
    })) ?? [],
    coping_actions: journal?.coping_actions?.map((action) => ({
      action: action.action,
      effectiveness: action.effectiveness,
    })) ?? [],
    barriers: journal?.barriers ?? [],
    tone_hint: journal?.tone_hint ?? null,
    risk_flags: journal?.risk_flags ?? [],
    self_appraisal_style: journal?.self_appraisal_style ?? null,
    self_efficacy_language: journal?.self_efficacy_language ?? null,
    goals_conflict_today: journal?.goals_conflict_today ?? null,
    evidence_quotes: journal?.evidence_quotes ?? [],
  };
}

export async function build_daily_input_bundle_v1(
  user_id: string,
  submissionDate: LocalDateString,
  sourceDate: LocalDateString,
  supabaseAdmin?: SupabaseClient,
  timezoneOverride?: string
): Promise<BuildDailyInputBundleV1Result> {
  const client = supabaseAdmin ?? createSupabaseAdminClient();
  const timezone = timezoneOverride || (await getCanonicalTimeZone(client, user_id));
  const generatedAt = new Date().toISOString();

  const [
    sleep,
    activity,
    hrv,
    spo2,
    overnight,
    nutrition,
    checkin,
    checkinRelations,
    journal,
    overall,
  ] = await Promise.all([
    fetchMaybeSingle<FitbitSleepDailyRow>(client, "fitbit_sleep_daily", "app_user_id", user_id, "date", submissionDate),
    fetchMaybeSingle<FitbitActivityDailyRow>(client, "fitbit_activity_daily", "app_user_id", user_id, "date", sourceDate),
    fetchMaybeSingle<FitbitHrvDailyRow>(client, "fitbit_hrv_daily", "app_user_id", user_id, "date", sourceDate),
    fetchMaybeSingle<FitbitSpo2DailyRow>(client, "fitbit_spo2_daily", "app_user_id", user_id, "date", submissionDate),
    fetchMaybeSingle<FitbitOvernightDailyRow>(client, "fitbit_overnight_daily", "app_user_id", user_id, "date", submissionDate),
    fetchMaybeSingle<DailyNutrition2Row>(client, "daily_nutrition2", "user_id", user_id, "date", sourceDate),
    fetchMaybeSingle<DailyCheckinRow>(client, "daily_checkins", "user_id", user_id, "checkin_date", sourceDate),
    fetchMaybeSingle<DailyCheckinRelation2Row>(client, "daily_checkin_relation2", "user_id", user_id, "checkin_date", sourceDate),
    fetchMaybeSingle<JournalSummary2Row>(client, "journal_summary2", "user_id", user_id, "date", sourceDate),
    fetchMaybeSingle<DailyOverallRow>(client, "daily_overall", "user_id", user_id, "date", submissionDate, "overall_score"),
  ]);
  const proxyBaselineContext = await fetchProxyBaselineContext(client, user_id, submissionDate);
  const mealContext = await fetchMealContext(client, user_id, sourceDate, timezone);

  const sleepBundle = buildSleepBundle(sleep, timezone);
  const activityBundle = buildActivityBundle(activity, sleep);
  const nutritionBundle = buildNutritionBundle(nutrition);
  const journalBundle = buildJournalBundle(journal);

  const overallScore = safeNumber(overall?.overall_score) ?? 0;
  const physioProxyScore = computePhysioProxyScore(
    safeNumber(hrv?.hrv_daily_rmssd),
    safeNumber(activity?.resting_heart_rate),
    sleepBundle.sleep_duration_hours,
    proxyBaselineContext
  );
  const gapToday =
    physioProxyScore === null || overall?.overall_score == null
      ? null
      : Math.round(overallScore - physioProxyScore);

  const missingness: BundleMissingness = {
    missing_sleep: sleep == null,
    missing_activity: activity == null,
    missing_hrv: hrv == null,
    missing_overnight: overnight == null && spo2 == null,
    missing_nutrition: nutrition == null || nutritionBundle.meals_missing_day,
    missing_checkin: checkin == null,
    missing_journal: journal == null,
    missing_goals: true,
    missing_proxy: physioProxyScore == null,
  };

  const confidence: BundleConfidence = {
    confidence_sleep: missingness.missing_sleep ? 0 : 1,
    confidence_activity: missingness.missing_activity ? 0 : 1,
    confidence_recovery:
      missingness.missing_hrv || missingness.missing_overnight ? 0 : 1,
    confidence_nutrition: nutrition?.nutrition_confidence_day ?? 0,
    confidence_checkin: missingness.missing_checkin ? 0 : 1,
    confidence_journal: clamp(journal?.extractor_confidence ?? 0, 0, 1),
    confidence_goals: 0,
    confidence_proxy: computeProxyConfidence(proxyBaselineContext, {
      hrvDailyRmssd: safeNumber(hrv?.hrv_daily_rmssd),
      restingHeartRate: safeNumber(activity?.resting_heart_rate),
      sleepDurationHours: sleepBundle.sleep_duration_hours,
    }),
  };

  const bundle: DailyInputBundleV1 = {
    bundle_version: "v1",
    meta: {
      user_id,
      date: submissionDate,
      source_local_date: sourceDate,
      timezone,
      generated_at: generatedAt,
    },
    missingness,
    confidence,
    core_signals: {
      overall_true_today: overallScore,
      physio_proxy_score_0_100: physioProxyScore,
      gap_today: gapToday,
    },
    watch: {
      hrv: {
        hrv_daily_rmssd: safeNumber(hrv?.hrv_daily_rmssd),
        hrv_deep_rmssd: safeNumber(hrv?.hrv_deep_rmssd),
      },
      sleep: sleepBundle,
      activity: activityBundle,
      overnight: {
        spo2_avg: safeNumber(spo2?.spo2_avg),
        oxygen_variation: safeNumber(overnight?.oxygen_variation),
        blood_oxygen_avg: safeNumber(overnight?.blood_oxygen_avg),
        breathing_rate: safeNumber(overnight?.breathing_rate),
        skin_temp_relative: safeNumber(overnight?.skin_temp_relative),
      },
    },
    nutrition: {
      daily_nutrition: nutritionBundle,
      meal_context: mealContext,
    },
    checkin: {
      raw: {
        mood_score: checkin?.mood_score ?? null,
        stress_score: checkin?.stress_score ?? null,
        energy_score: checkin?.energy_score ?? null,
        focus_score: checkin?.focus_score ?? null,
        workload_score: checkin?.workload_score ?? null,
        social_score: checkin?.social_score ?? null,
        sleep_quality: checkin?.sleep_quality ?? null,
        coping_capacity_score: checkin?.coping_capacity_score ?? null,
        stress_unexpected_score: checkin?.stress_unexpected_score ?? null,
        mood_stability_score: checkin?.mood_stability_score ?? null,
        emotions: checkin?.mood_emotions ?? null,
      },
      intrarelations: {
        stress_minus_workload: checkinRelations?.stress_minus_workload ?? null,
        stress_minus_coping: checkinRelations?.stress_minus_coping ?? null,
        coping_minus_workload: checkinRelations?.coping_minus_workload ?? null,
        stress_minus_sleep: checkinRelations?.stress_minus_sleep ?? null,
        sleep_minus_energy: checkinRelations?.sleep_minus_energy ?? null,
        focus_minus_energy: checkinRelations?.focus_minus_energy ?? null,
        focus_minus_stress: checkinRelations?.focus_minus_stress ?? null,
        mood_minus_stress: checkinRelations?.mood_minus_stress ?? null,
        mood_minus_energy: checkinRelations?.mood_minus_energy ?? null,
        social_minus_mood: checkinRelations?.social_minus_mood ?? null,
        emotion_count: checkinRelations?.emotion_count ?? null,
      },
    },
    journal: journalBundle,
  };

  const upsertPayload = {
    user_id,
    date: submissionDate,
    bundle_version: bundle.bundle_version,
    timezone,
    generated_at: generatedAt,
    overall_true_today: bundle.core_signals.overall_true_today,
    physio_proxy_score_0_100: bundle.core_signals.physio_proxy_score_0_100,
    gap_today: bundle.core_signals.gap_today,
    missingness_json: missingness,
    confidence_json: confidence,
    bundle_json: bundle,
  };

  const { data, error } = await withSupabaseRetry(
    "upsert daily_input_bundle_v12",
    () =>
      client
        .from("daily_input_bundle_v12")
        .upsert(upsertPayload, { onConflict: "user_id,date" })
        .select("*")
        .single()
  );

  if (error) {
    throw new Error(`Failed to upsert daily_input_bundle_v12: ${error.message}`);
  }

  return {
    localDate: submissionDate,
    sourceLocalDate: sourceDate,
    timezone,
    row: data as DailyInputBundleV12Row,
  };
}

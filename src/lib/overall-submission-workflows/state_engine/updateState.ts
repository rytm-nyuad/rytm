import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { DailyInputBundleV1 } from "../inputBundleV1";
import { withSupabaseRetry } from "../supabaseRetry";

const STATE_VERSION = "v1";
const FAST_EFFECTIVE_DAYS = 7;
const SLOW_EFFECTIVE_DAYS_CAP = 30;
const CORRELATION_WINDOW_DAYS = 14;

const TRACKED_FEATURE_KEYS = [
  "overall_true_today",
  "physio_proxy_score_0_100",
  "gap_today",
  "sleep_duration_hours",
  "sleep_efficiency",
  "wake_ratio_pct",
  "sleep_onset_time_minutes",
  "wake_time_minutes",
  "hrv_daily_rmssd",
  "resting_heart_rate",
  "steps",
  "mvpa_minutes",
  "sedentary_minutes",
  "total_kcal_day",
  "protein_g_day",
  "meal_count_day",
  "time_last_meal_minutes",
  "nutrition_confidence_day",
  "mood_score",
  "stress_score",
  "energy_score",
  "focus_score",
  "workload_score",
  "coping_capacity_score",
  "sleep_quality",
  "social_score",
  "stress_minus_workload",
  "stress_minus_coping",
  "focus_minus_stress",
  "mood_minus_stress",
  "emotion_count",
] as const;

const CORE_FEATURE_KEYS = [
  "overall_true_today",
  "physio_proxy_score_0_100",
  "gap_today",
  "sleep_duration_hours",
  "hrv_daily_rmssd",
  "stress_score",
  "energy_score",
] as const;

const HISTORY_FEATURE_KEYS = [
  "overall_true_today",
  "physio_proxy_score_0_100",
  "gap_today",
  "sleep_duration_hours",
  "sleep_efficiency",
  "sleep_onset_time_minutes",
  "wake_time_minutes",
  "hrv_daily_rmssd",
  "resting_heart_rate",
  "steps",
  "mvpa_minutes",
  "sedentary_minutes",
  "total_kcal_day",
  "protein_g_day",
  "meal_count_day",
  "time_last_meal_minutes",
  "mood_score",
  "stress_score",
  "energy_score",
  "focus_score",
  "workload_score",
  "coping_capacity_score",
  "sleep_quality",
  "social_score",
  "stress_minus_workload",
  "stress_minus_coping",
  "focus_minus_stress",
  "mood_minus_stress",
  "emotion_count",
] as const;

const LAG_RELATION_DEFS = [
  { name: "sleep_duration_vs_overall", xKey: "sleep_duration_hours", yKey: "overall_true_today" },
  { name: "hrv_vs_overall", xKey: "hrv_daily_rmssd", yKey: "overall_true_today" },
  { name: "workload_vs_stress", xKey: "workload_score", yKey: "stress_score" },
  { name: "stress_vs_sleep_quality", xKey: "stress_score", yKey: "sleep_quality" },
  { name: "mvpa_vs_sleep_duration", xKey: "mvpa_minutes", yKey: "sleep_duration_hours" },
  { name: "mvpa_vs_hrv", xKey: "mvpa_minutes", yKey: "hrv_daily_rmssd" },
  { name: "protein_vs_energy", xKey: "protein_g_day", yKey: "energy_score" },
] as const;

type FeatureKey = (typeof TRACKED_FEATURE_KEYS)[number];
type HistoryFeatureKey = (typeof HISTORY_FEATURE_KEYS)[number];
type CoreFeatureKey = (typeof CORE_FEATURE_KEYS)[number];

type FeatureValues = Record<FeatureKey, number | null>;

type HistoricalBundleRow = {
  date: string;
  bundle_json: DailyInputBundleV1;
  missingness_json: DailyInputBundleV1["missingness"];
  confidence_json: DailyInputBundleV1["confidence"];
};

type AdviceMemory = {
  last_themes: string[];
  theme_repeat_count: Record<string, number>;
  last_questions: string[];
};

type StateHistorySnapshot = {
  baselines: Record<
    string,
    {
      fast_center: number | null;
      fast_scale: number | null;
      slow_center: number | null;
      slow_scale: number | null;
      z_fast_today: number | null;
      z_slow_today: number | null;
      vol_fast: number | null;
      vol_class: "stable" | "moderate" | "volatile";
    }
  >;
  slopes: Record<
    string,
    {
      slope_fast: number | null;
      slope_slow: number | null;
    }
  >;
  residual_signature: Record<string, unknown>;
  lag_relations: Array<Record<string, unknown>>;
  uncertainty: Record<string, unknown>;
  episodic_memory: Record<string, unknown>;
  advice_memory: AdviceMemory;
};

type UpdateStateResult = {
  localDate: string;
  shouldRunSummary: boolean;
  stateReady: {
    fast_ready: boolean;
    slow_ready: boolean;
  };
  currentStateRow: {
    user_id: string;
    as_of_date: string;
    state_version: string;
    updated_at: string;
    state_json: Record<string, unknown>;
  };
  historyRow: {
    user_id: string;
    date: string;
    state_version: string;
    overall_true_today: number;
    physio_proxy_score_0_100: number | null;
    gap_today: number | null;
    deviations_json: Record<string, unknown>;
    state_snapshot_json: StateHistorySnapshot;
    actions_generated_json: {
      themes: string[];
      actions: unknown[];
      questions: string[];
    };
    outcomes_json: null;
  };
};

type UpdateStateParams = {
  userId: string;
  date: string;
  inputBundle: DailyInputBundleV1;
  supabaseAdmin?: SupabaseClient;
};

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundTo(value: number | null, decimals = 4): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function mad(values: number[]): number | null {
  const med = median(values);
  if (med === null) return null;
  const deviations = values.map((value) => Math.abs(value - med));
  const deviationMedian = median(deviations);
  if (deviationMedian === null) return null;
  return deviationMedian * 1.4826;
}

function ewma(values: number[], effectiveDays: number): number | null {
  if (values.length === 0) return null;
  const alpha = 2 / (effectiveDays + 1);
  let acc = values[0];
  for (let index = 1; index < values.length; index += 1) {
    acc = alpha * values[index] + (1 - alpha) * acc;
  }
  return acc;
}

function ewmaDelta(values: number[], effectiveDays: number): number | null {
  if (values.length < 2) return null;
  const current = ewma(values, effectiveDays);
  const previous = ewma(values.slice(0, -1), effectiveDays);
  if (current === null || previous === null) return null;
  return current - previous;
}

function computeZScore(value: number | null, center: number | null, scale: number | null): number | null {
  if (value === null || center === null || scale === null) return null;
  if (Math.abs(scale) < 1e-6) {
    return Math.abs(value - center) < 1e-6 ? 0 : null;
  }
  return roundTo((value - center) / scale, 4);
}

function classifyVolatility(center: number | null, scale: number | null): "stable" | "moderate" | "volatile" {
  if (center === null || scale === null) return "stable";
  const relative = Math.abs(scale) / Math.max(Math.abs(center), 1);
  if (relative >= 0.25) return "volatile";
  if (relative >= 0.1) return "moderate";
  return "stable";
}

function pearsonCorrelation(xValues: number[], yValues: number[]): number | null {
  if (xValues.length !== yValues.length || xValues.length < 2) return null;
  const xMean = mean(xValues);
  const yMean = mean(yValues);
  if (xMean === null || yMean === null) return null;

  let numerator = 0;
  let xDenominator = 0;
  let yDenominator = 0;

  for (let index = 0; index < xValues.length; index += 1) {
    const x = xValues[index] - xMean;
    const y = yValues[index] - yMean;
    numerator += x * y;
    xDenominator += x * x;
    yDenominator += y * y;
  }

  if (xDenominator === 0 || yDenominator === 0) return null;
  return roundTo(numerator / Math.sqrt(xDenominator * yDenominator), 4);
}

function directionFromGap(gap: number | null): "overall_lt_proxy" | "overall_gt_proxy" | "aligned" {
  if (gap === null) return "aligned";
  if (gap <= -5) return "overall_lt_proxy";
  if (gap >= 5) return "overall_gt_proxy";
  return "aligned";
}

function extractFeatureValues(bundle: DailyInputBundleV1): FeatureValues {
  return {
    overall_true_today: safeNumber(bundle.core_signals.overall_true_today),
    physio_proxy_score_0_100: safeNumber(bundle.core_signals.physio_proxy_score_0_100),
    gap_today: safeNumber(bundle.core_signals.gap_today),
    sleep_duration_hours: safeNumber(bundle.watch.sleep.sleep_duration_hours),
    sleep_efficiency: safeNumber(bundle.watch.sleep.sleep_efficiency),
    wake_ratio_pct: safeNumber(bundle.watch.sleep.wake_ratio_pct),
    sleep_onset_time_minutes: safeNumber(bundle.watch.sleep.sleep_onset_time_minutes),
    wake_time_minutes: safeNumber(bundle.watch.sleep.wake_time_minutes),
    hrv_daily_rmssd: safeNumber(bundle.watch.hrv.hrv_daily_rmssd),
    resting_heart_rate: safeNumber(bundle.watch.activity.resting_heart_rate),
    steps: safeNumber(bundle.watch.activity.steps),
    mvpa_minutes: safeNumber(bundle.watch.activity.mvpa_minutes),
    sedentary_minutes: safeNumber(bundle.watch.activity.sedentary_minutes),
    total_kcal_day: safeNumber(bundle.nutrition.daily_nutrition.total_kcal_day),
    protein_g_day: safeNumber(bundle.nutrition.daily_nutrition.protein_g_day),
    meal_count_day: safeNumber(bundle.nutrition.daily_nutrition.meal_count_day),
    time_last_meal_minutes: safeNumber(bundle.nutrition.daily_nutrition.time_last_meal_minutes),
    nutrition_confidence_day: safeNumber(bundle.nutrition.daily_nutrition.nutrition_confidence_day),
    mood_score: safeNumber(bundle.checkin.raw.mood_score),
    stress_score: safeNumber(bundle.checkin.raw.stress_score),
    energy_score: safeNumber(bundle.checkin.raw.energy_score),
    focus_score: safeNumber(bundle.checkin.raw.focus_score),
    workload_score: safeNumber(bundle.checkin.raw.workload_score),
    coping_capacity_score: safeNumber(bundle.checkin.raw.coping_capacity_score),
    sleep_quality: safeNumber(bundle.checkin.raw.sleep_quality),
    social_score: safeNumber(bundle.checkin.raw.social_score),
    stress_minus_workload: safeNumber(bundle.checkin.intrarelations.stress_minus_workload),
    stress_minus_coping: safeNumber(bundle.checkin.intrarelations.stress_minus_coping),
    focus_minus_stress: safeNumber(bundle.checkin.intrarelations.focus_minus_stress),
    mood_minus_stress: safeNumber(bundle.checkin.intrarelations.mood_minus_stress),
    emotion_count: safeNumber(bundle.checkin.intrarelations.emotion_count),
  };
}

async function fetchHistoricalBundles(
  client: SupabaseClient,
  userId: string,
  date: string
): Promise<HistoricalBundleRow[]> {
  const { data, error } = await withSupabaseRetry(
    "read historical daily_input_bundle_v12",
    () =>
      client
        .from("daily_input_bundle_v12")
        .select("date, bundle_json, missingness_json, confidence_json")
        .eq("user_id", userId)
        .lt("date", date)
        .order("date", { ascending: false })
        .limit(SLOW_EFFECTIVE_DAYS_CAP - 1)
  );

  if (error) {
    throw new Error(`Failed to read daily_input_bundle_v12 history: ${error.message}`);
  }

  return ((data as HistoricalBundleRow[] | null) ?? []).reverse();
}

async function fetchExistingStateAdviceMemory(
  client: SupabaseClient,
  userId: string,
  date: string
): Promise<AdviceMemory> {
  const { data: historyData, error: historyError } = await withSupabaseRetry(
    "read historical advice memory from user_state_history2",
    () =>
      client
        .from("user_state_history2")
        .select("state_snapshot_json")
        .eq("user_id", userId)
        .lt("date", date)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle()
  );

  if (historyError) {
    throw new Error(`Failed to read user_state_history2: ${historyError.message}`);
  }

  let adviceMemory: unknown =
    (historyData as { state_snapshot_json?: { advice_memory?: unknown } } | null)
      ?.state_snapshot_json?.advice_memory;

  if (adviceMemory == null) {
    const { data, error } = await withSupabaseRetry(
      "read user_state_current2 advice memory",
      () =>
        client
          .from("user_state_current2")
          .select("state_json")
          .eq("user_id", userId)
          .maybeSingle()
    );

    if (error) {
      throw new Error(`Failed to read user_state_current2: ${error.message}`);
    }

    adviceMemory = (data as { state_json?: Record<string, unknown> } | null)?.state_json?.advice_memory;
  }

  const record = typeof adviceMemory === "object" && adviceMemory !== null ? adviceMemory as Record<string, unknown> : null;

  return {
    last_themes: Array.isArray(record?.last_themes) ? record!.last_themes.filter((value): value is string => typeof value === "string") : [],
    theme_repeat_count:
      typeof record?.theme_repeat_count === "object" && record?.theme_repeat_count !== null
        ? Object.fromEntries(
            Object.entries(record.theme_repeat_count as Record<string, unknown>)
              .filter(([, value]) => typeof value === "number")
              .map(([key, value]) => [key, value as number])
          )
        : {},
    last_questions: Array.isArray(record?.last_questions) ? record!.last_questions.filter((value): value is string => typeof value === "string") : [],
  };
}

function computeFeatureState(
  key: FeatureKey,
  history: Array<{ date: string; values: FeatureValues }>
) {
  const validSeries = history
    .map((entry) => ({ date: entry.date, value: entry.values[key] }))
    .filter((entry): entry is { date: string; value: number } => entry.value !== null);

  const fastWindow = validSeries.slice(-FAST_EFFECTIVE_DAYS);
  const slowWindow =
    validSeries.length >= FAST_EFFECTIVE_DAYS
      ? validSeries.slice(-Math.min(validSeries.length, SLOW_EFFECTIVE_DAYS_CAP))
      : [];

  const fastValues = fastWindow.map((entry) => entry.value);
  const slowValues = slowWindow.map((entry) => entry.value);

  const fastCenter = roundTo(ewma(fastValues, FAST_EFFECTIVE_DAYS));
  const fastScale = roundTo(mad(fastValues));
  const slowEffectiveDaysCurrent =
    slowValues.length >= FAST_EFFECTIVE_DAYS ? Math.min(slowValues.length, SLOW_EFFECTIVE_DAYS_CAP) : 0;
  const slowCenter =
    slowEffectiveDaysCurrent > 0 ? roundTo(ewma(slowValues, slowEffectiveDaysCurrent)) : null;
  const slowScale = slowEffectiveDaysCurrent > 0 ? roundTo(mad(slowValues)) : null;
  const todayValue = history.at(-1)?.values[key] ?? null;

  return {
    key,
    todayValue,
    fast: {
      effective_days: FAST_EFFECTIVE_DAYS,
      n_valid: fastValues.length,
      center_ewma: fastCenter,
      scale_robust: fastScale,
      last_value: fastWindow.at(-1)?.value ?? null,
      last_updated: history.at(-1)?.date ?? null,
      z_today: computeZScore(todayValue, fastCenter, fastScale),
    },
    slow: {
      effective_days_cap: SLOW_EFFECTIVE_DAYS_CAP,
      effective_days_current: slowEffectiveDaysCurrent,
      n_valid: slowValues.length,
      center_ewma: slowCenter,
      scale_robust: slowScale,
      last_value: slowWindow.at(-1)?.value ?? null,
      last_updated: history.at(-1)?.date ?? null,
      z_today: computeZScore(todayValue, slowCenter, slowScale),
    },
    slopes: {
      slope_fast: roundTo(ewmaDelta(fastValues, FAST_EFFECTIVE_DAYS)),
      slope_slow:
        slowEffectiveDaysCurrent > 0
          ? roundTo(ewmaDelta(slowValues, slowEffectiveDaysCurrent))
          : null,
      method: "ewma_delta",
    },
    volatility: {
      vol_fast: fastScale,
      class: classifyVolatility(fastCenter, fastScale),
      n_valid: fastValues.length,
    },
    regime_shift:
      fastCenter !== null && slowCenter !== null && slowScale !== null && slowScale > 1e-6
        ? roundTo((fastCenter - slowCenter) / slowScale)
        : null,
  };
}

function buildLagRelations(history: Array<{ values: FeatureValues }>) {
  const recent = history.slice(-CORRELATION_WINDOW_DAYS);

  return LAG_RELATION_DEFS.map((relation) => {
    const paired = recent
      .map((entry) => ({
        x: entry.values[relation.xKey as FeatureKey],
        y: entry.values[relation.yKey as FeatureKey],
      }))
      .filter((entry): entry is { x: number; y: number } => entry.x !== null && entry.y !== null);

    const corr =
      paired.length >= CORRELATION_WINDOW_DAYS
        ? pearsonCorrelation(
            paired.map((entry) => entry.x),
            paired.map((entry) => entry.y)
          )
        : null;

    return {
      name: relation.name,
      x_key: relation.xKey,
      y_key: relation.yKey,
      window_days: CORRELATION_WINDOW_DAYS,
      corr,
      n_points: paired.length,
      confidence: roundTo(clamp(paired.length / CORRELATION_WINDOW_DAYS, 0, 1), 4) ?? 0,
    };
  });
}

function buildResidualSignature(history: Array<{ values: FeatureValues }>) {
  const gapSeries = history
    .map((entry) => entry.values.gap_today)
    .filter((value): value is number => value !== null);

  const fastGapValues = gapSeries.slice(-FAST_EFFECTIVE_DAYS);
  const slowGapValues =
    gapSeries.length >= FAST_EFFECTIVE_DAYS
      ? gapSeries.slice(-Math.min(gapSeries.length, SLOW_EFFECTIVE_DAYS_CAP))
      : [];

  const recentDirections = gapSeries.slice(-CORRELATION_WINDOW_DAYS).map(directionFromGap);
  const overallLtProxyRate =
    roundTo(
      recentDirections.length === 0
        ? null
        : recentDirections.filter((value) => value === "overall_lt_proxy").length /
            recentDirections.length
    ) ?? null;
  const overallGtProxyRate =
    roundTo(
      recentDirections.length === 0
        ? null
        : recentDirections.filter((value) => value === "overall_gt_proxy").length /
            recentDirections.length
    ) ?? null;
  const alignedRate =
    roundTo(
      recentDirections.length === 0
        ? null
        : recentDirections.filter((value) => value === "aligned").length /
            recentDirections.length
    ) ?? null;

  let currentMismatchDays = 0;
  let currentDirection: "overall_lt_proxy" | "overall_gt_proxy" | "aligned" = "aligned";
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const direction = directionFromGap(history[index].values.gap_today);
    if (index === history.length - 1) {
      currentDirection = direction;
    }
    if (direction !== currentDirection) break;
    currentMismatchDays += 1;
  }

  return {
    gap: {
      fast: {
        center: roundTo(ewma(fastGapValues, FAST_EFFECTIVE_DAYS)),
        scale: roundTo(mad(fastGapValues)),
        n_valid: fastGapValues.length,
      },
      slow: {
        center:
          slowGapValues.length >= FAST_EFFECTIVE_DAYS
            ? roundTo(ewma(slowGapValues, Math.min(slowGapValues.length, SLOW_EFFECTIVE_DAYS_CAP)))
            : null,
        scale: slowGapValues.length >= FAST_EFFECTIVE_DAYS ? roundTo(mad(slowGapValues)) : null,
        n_valid: slowGapValues.length,
      },
      direction_bias: {
        overall_lt_proxy_rate: overallLtProxyRate,
        overall_gt_proxy_rate: overallGtProxyRate,
        aligned_rate: alignedRate,
      },
      run_length: {
        current_mismatch_days: currentMismatchDays,
        current_direction: currentDirection,
      },
    },
  };
}

function buildEpisodicMemory(history: Array<{ date: string; bundle: DailyInputBundleV1 }>) {
  const recent = history.slice(-CORRELATION_WINDOW_DAYS);
  const activeEventMap = new Map<
    string,
    {
      event_type: string;
      status: "started" | "ongoing" | "resolved";
      start_date: string;
      last_seen_date: string;
      confidence: number;
    }
  >();
  const stressorMap = new Map<
    string,
    {
      type: string;
      count_14d: number;
      confidence_sum: number;
    }
  >();

  for (const entry of recent) {
    for (const event of entry.bundle.journal.episodic_events ?? []) {
      const existing = activeEventMap.get(event.event_type);
      if (!existing) {
        activeEventMap.set(event.event_type, {
          event_type: event.event_type,
          status: event.status,
          start_date: entry.date,
          last_seen_date: entry.date,
          confidence: event.confidence,
        });
      } else {
        existing.status = event.status;
        existing.last_seen_date = entry.date;
        existing.confidence = Math.max(existing.confidence, event.confidence);
      }
    }

    for (const stressor of entry.bundle.journal.stressor_types ?? []) {
      const existing = stressorMap.get(stressor.type);
      if (!existing) {
        stressorMap.set(stressor.type, {
          type: stressor.type,
          count_14d: 1,
          confidence_sum: stressor.confidence,
        });
      } else {
        existing.count_14d += 1;
        existing.confidence_sum += stressor.confidence;
      }
    }
  }

  return {
    active_events: Array.from(activeEventMap.values())
      .filter((event) => event.status !== "resolved")
      .slice(0, 5)
      .map((event) => ({
        event_type: event.event_type,
        status: event.status,
        start_date: event.start_date,
        last_seen_date: event.last_seen_date,
        confidence: roundTo(event.confidence) ?? 0,
      })),
    recent_stressor_distribution: Array.from(stressorMap.values())
      .sort((a, b) => b.count_14d - a.count_14d)
      .slice(0, 5)
      .map((stressor) => ({
        type: stressor.type,
        count_14d: stressor.count_14d,
        confidence: roundTo(stressor.confidence_sum / stressor.count_14d) ?? 0,
      })),
  };
}

function buildUncertainty(history: Array<{ bundle: DailyInputBundleV1 }>, fastReady: boolean, slowReady: boolean) {
  const recent = history.slice(-CORRELATION_WINDOW_DAYS);
  const denominator = Math.max(recent.length, 1);

  const rate = (presentCount: number) => roundTo(presentCount / denominator) ?? 0;

  return {
    modality_availability_rates_14d: {
      sleep: rate(recent.filter((entry) => !entry.bundle.missingness.missing_sleep).length),
      activity: rate(recent.filter((entry) => !entry.bundle.missingness.missing_activity).length),
      hrv: rate(recent.filter((entry) => !entry.bundle.missingness.missing_hrv).length),
      nutrition: rate(recent.filter((entry) => !entry.bundle.missingness.missing_nutrition).length),
      checkin: rate(recent.filter((entry) => !entry.bundle.missingness.missing_checkin).length),
      journal: rate(recent.filter((entry) => !entry.bundle.missingness.missing_journal).length),
      proxy: rate(recent.filter((entry) => !entry.bundle.missingness.missing_proxy).length),
    },
    baseline_stability_flags: {
      fast_ready: fastReady,
      slow_ready: slowReady,
    },
  };
}

function buildCompactSnapshot(
  featureStateMap: Record<string, ReturnType<typeof computeFeatureState>>,
  residualSignature: Record<string, unknown>,
  lagRelations: Array<Record<string, unknown>>,
  uncertainty: Record<string, unknown>,
  episodicMemory: Record<string, unknown>,
  adviceMemory: AdviceMemory
): StateHistorySnapshot {
  const baselines = Object.fromEntries(
    HISTORY_FEATURE_KEYS.map((key) => {
      const featureState = featureStateMap[key];
      return [
        key,
        {
          fast_center: featureState.fast.center_ewma,
          fast_scale: featureState.fast.scale_robust,
          slow_center: featureState.slow.center_ewma,
          slow_scale: featureState.slow.scale_robust,
          z_fast_today: featureState.fast.z_today,
          z_slow_today: featureState.slow.z_today,
          vol_fast: featureState.volatility.vol_fast,
          vol_class: featureState.volatility.class,
        },
      ];
    })
  );

  const slopes = Object.fromEntries(
    HISTORY_FEATURE_KEYS.map((key) => {
      const featureState = featureStateMap[key];
      return [
        key,
        {
          slope_fast: featureState.slopes.slope_fast,
          slope_slow: featureState.slopes.slope_slow,
        },
      ];
    })
  );

  return {
    baselines,
    slopes,
    residual_signature: residualSignature,
    lag_relations: lagRelations,
    uncertainty,
    episodic_memory: episodicMemory,
    advice_memory: adviceMemory,
  };
}

function buildDeviations(featureStateMap: Record<string, ReturnType<typeof computeFeatureState>>) {
  const anomalies = Object.values(featureStateMap)
    .map((featureState) => {
      const zFast = featureState.fast.z_today;
      const zSlow = featureState.slow.z_today;
      const magnitude = Math.max(Math.abs(zFast ?? 0), Math.abs(zSlow ?? 0));
      return {
        feature_key: featureState.key,
        z_fast: zFast,
        z_slow: zSlow,
        direction:
          ((zSlow ?? zFast ?? 0) < 0 ? "low" : "high") as "low" | "high",
        confidence:
          roundTo(
            Math.max(
              featureState.fast.n_valid / FAST_EFFECTIVE_DAYS,
              featureState.slow.n_valid / Math.max(featureState.slow.effective_days_current, 1)
            )
          ) ?? 0,
        magnitude,
      };
    })
    .filter((entry) => entry.magnitude > 0)
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, 5)
    .map(({ magnitude, ...entry }) => entry);

  const trends = Object.values(featureStateMap)
    .map((featureState) => {
      const slope = featureState.slopes.slope_fast ?? 0;
      return {
        feature_key: featureState.key,
        slope_fast: featureState.slopes.slope_fast,
        direction:
          Math.abs(slope) < 1e-6 ? "flat" : slope > 0 ? "up" : "down",
        confidence:
          roundTo(featureState.fast.n_valid / FAST_EFFECTIVE_DAYS) ?? 0,
        magnitude: Math.abs(slope),
      };
    })
    .filter((entry) => entry.magnitude > 0)
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, 5)
    .map(({ magnitude, ...entry }) => entry);

  return {
    top_anomalies: anomalies,
    top_trends: trends,
  };
}

function buildStateJson(
  userId: string,
  date: string,
  updatedAt: string,
  featureStateMap: Record<string, ReturnType<typeof computeFeatureState>>,
  lagRelations: Array<Record<string, unknown>>,
  residualSignature: Record<string, unknown>,
  episodicMemory: Record<string, unknown>,
  uncertainty: Record<string, unknown>,
  adviceMemory: AdviceMemory
) {
  const volatilityValues = Object.values(featureStateMap)
    .map((feature) => {
      const center = feature.fast.center_ewma;
      const scale = feature.fast.scale_robust;
      if (center === null || scale === null) return null;
      return Math.abs(scale) / Math.max(Math.abs(center), 1);
    })
    .filter((value): value is number => value !== null);

  const globalVolatility = roundTo(mean(volatilityValues));

  return {
    state_version: STATE_VERSION,
    user_id: userId,
    updated_at: updatedAt,
    as_of_date: date,
    tracked_feature_keys: [...TRACKED_FEATURE_KEYS],
    baselines: Object.fromEntries(
      Object.entries(featureStateMap).map(([key, featureState]) => [
        key,
        {
          fast: {
            effective_days: featureState.fast.effective_days,
            n_valid: featureState.fast.n_valid,
            center_ewma: featureState.fast.center_ewma,
            scale_robust: featureState.fast.scale_robust,
            last_value: featureState.fast.last_value,
            last_updated: updatedAt,
          },
          slow: {
            effective_days_cap: featureState.slow.effective_days_cap,
            effective_days_current: featureState.slow.effective_days_current,
            n_valid: featureState.slow.n_valid,
            center_ewma: featureState.slow.center_ewma,
            scale_robust: featureState.slow.scale_robust,
            last_value: featureState.slow.last_value,
            last_updated: updatedAt,
          },
        },
      ])
    ),
    slopes: Object.fromEntries(
      Object.entries(featureStateMap).map(([key, featureState]) => [
        key,
        featureState.slopes,
      ])
    ),
    volatility: {
      ...Object.fromEntries(
        Object.entries(featureStateMap).map(([key, featureState]) => [
          key,
          featureState.volatility,
        ])
      ),
      global: {
        volatility_index: globalVolatility,
        class:
          globalVolatility === null
            ? "stable"
            : globalVolatility >= 0.25
              ? "volatile"
              : globalVolatility >= 0.1
                ? "moderate"
                : "stable",
      },
    },
    lag_relations: lagRelations,
    residual_signature: residualSignature,
    episodic_memory: episodicMemory,
    uncertainty,
    advice_memory: adviceMemory,
  };
}

function computeReadiness(featureStateMap: Record<string, ReturnType<typeof computeFeatureState>>) {
  const fastReadyCount = CORE_FEATURE_KEYS.filter(
    (key) => featureStateMap[key].fast.n_valid >= FAST_EFFECTIVE_DAYS
  ).length;
  const slowReadyCount = CORE_FEATURE_KEYS.filter(
    (key) => featureStateMap[key].slow.n_valid >= FAST_EFFECTIVE_DAYS
  ).length;

  return {
    fast_ready:
      featureStateMap.overall_true_today.fast.n_valid >= FAST_EFFECTIVE_DAYS &&
      featureStateMap.sleep_duration_hours.fast.n_valid >= FAST_EFFECTIVE_DAYS &&
      fastReadyCount >= 4,
    slow_ready:
      featureStateMap.overall_true_today.slow.n_valid >= FAST_EFFECTIVE_DAYS &&
      featureStateMap.sleep_duration_hours.slow.n_valid >= FAST_EFFECTIVE_DAYS &&
      slowReadyCount >= 4,
  };
}

async function upsertStateCurrent(
  client: SupabaseClient,
  userId: string,
  date: string,
  updatedAt: string,
  stateJson: Record<string, unknown>
) {
  const payload = {
    user_id: userId,
    state_version: STATE_VERSION,
    as_of_date: date,
    updated_at: updatedAt,
    state_json: stateJson,
  };

  const { data, error } = await withSupabaseRetry(
    "upsert user_state_current2",
    () =>
      client
        .from("user_state_current2")
        .upsert(payload, { onConflict: "user_id" })
        .select("*")
        .single()
  );

  if (error) {
    throw new Error(`Failed to upsert user_state_current2: ${error.message}`);
  }

  return data as UpdateStateResult["currentStateRow"];
}

async function upsertStateHistoryStub(
  client: SupabaseClient,
  userId: string,
  date: string,
  inputBundle: DailyInputBundleV1,
  deviationsJson: Record<string, unknown>,
  stateSnapshot: StateHistorySnapshot
) {
  const payload = {
    user_id: userId,
    date,
    state_version: STATE_VERSION,
    overall_true_today: inputBundle.core_signals.overall_true_today,
    physio_proxy_score_0_100: inputBundle.core_signals.physio_proxy_score_0_100,
    gap_today: inputBundle.core_signals.gap_today,
    deviations_json: deviationsJson,
    state_snapshot_json: stateSnapshot,
    actions_generated_json: {
      themes: [],
      actions: [],
      questions: [],
    },
    outcomes_json: null,
  };

  const { data, error } = await withSupabaseRetry(
    "upsert user_state_history2",
    () =>
      client
        .from("user_state_history2")
        .upsert(payload, { onConflict: "user_id,date" })
        .select("*")
        .single()
  );

  if (error) {
    throw new Error(`Failed to upsert user_state_history2: ${error.message}`);
  }

  return data as UpdateStateResult["historyRow"];
}

export async function update_state(
  user_id: string,
  date: string,
  input_bundle: DailyInputBundleV1,
  supabaseAdmin?: SupabaseClient
): Promise<UpdateStateResult> {
  const client = supabaseAdmin ?? createSupabaseAdminClient();
  const updatedAt = new Date().toISOString();
  const historicalRows = await fetchHistoricalBundles(client, user_id, date);
  const adviceMemory = await fetchExistingStateAdviceMemory(client, user_id, date);

  const history = [
    ...historicalRows.map((row) => ({
      date: row.date,
      bundle: row.bundle_json,
      values: extractFeatureValues(row.bundle_json),
    })),
    {
      date,
      bundle: input_bundle,
      values: extractFeatureValues(input_bundle),
    },
  ];

  const featureStateMap = Object.fromEntries(
    TRACKED_FEATURE_KEYS.map((key) => [key, computeFeatureState(key, history)])
  ) as Record<string, ReturnType<typeof computeFeatureState>>;

  const readiness = computeReadiness(
    featureStateMap as Record<string, ReturnType<typeof computeFeatureState>>
  );
  const lagRelations = buildLagRelations(history);
  const residualSignature = buildResidualSignature(history);
  const episodicMemory = buildEpisodicMemory(history);
  const uncertainty = buildUncertainty(history, readiness.fast_ready, readiness.slow_ready);
  const deviations = buildDeviations(
    featureStateMap as Record<string, ReturnType<typeof computeFeatureState>>
  );
  const compactSnapshot = buildCompactSnapshot(
    featureStateMap as Record<string, ReturnType<typeof computeFeatureState>>,
    residualSignature,
    lagRelations as Array<Record<string, unknown>>,
    uncertainty,
    episodicMemory,
    adviceMemory
  );
  const stateJson = buildStateJson(
    user_id,
    date,
    updatedAt,
    featureStateMap as Record<string, ReturnType<typeof computeFeatureState>>,
    lagRelations as Array<Record<string, unknown>>,
    residualSignature,
    episodicMemory,
    uncertainty,
    adviceMemory
  );

  const currentStateRow = await upsertStateCurrent(
    client,
    user_id,
    date,
    updatedAt,
    stateJson
  );
  const historyRow = await upsertStateHistoryStub(
    client,
    user_id,
    date,
    input_bundle,
    deviations,
    compactSnapshot
  );

  return {
    localDate: date,
    shouldRunSummary: readiness.fast_ready,
    stateReady: readiness,
    currentStateRow,
    historyRow,
  };
}

export async function updateState(
  params: UpdateStateParams
): Promise<UpdateStateResult> {
  return update_state(
    params.userId,
    params.date,
    params.inputBundle,
    params.supabaseAdmin
  );
}

export type { UpdateStateParams, UpdateStateResult, DailyInputBundleV1 };

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatLocalDate, getCanonicalTimeZone, type LocalDateString } from "@/lib/time";
import { processMeal } from "@/lib/meal-processing/process-meal";

type MealLogRow = {
  id: string;
  meal_datetime: string;
};

type DailyNutrition2Row = {
  user_id: string;
  date: string;
  aggregation_pipeline_version: string;
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

export type EnsureDailyNutrition2Params = {
  userId: string;
  localDate: LocalDateString;
  timezone?: string;
  supabaseAdmin?: SupabaseClient;
};

export type EnsureDailyNutrition2Result = {
  localDate: LocalDateString;
  timezone: string;
  mealsFound: number;
  mealsProcessedNow: number;
  mealsAlreadyProcessed: number;
  row: DailyNutrition2Row | null;
};

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

async function getMealsForLocalDate(
  supabaseAdmin: SupabaseClient,
  userId: string,
  localDate: LocalDateString,
  timezone: string
): Promise<MealLogRow[]> {
  const { startIso, endIso } = buildThreeDayUtcWindow(localDate);

  const { data, error } = await supabaseAdmin
    .from("meal_logs")
    .select("id, meal_datetime")
    .eq("user_id", userId)
    .gte("meal_datetime", startIso)
    .lt("meal_datetime", endIso)
    .order("meal_datetime", { ascending: true });

  if (error) {
    throw new Error(`Failed to read meal_logs for daily_nutrition2 workflow: ${error.message}`);
  }

  return (data ?? []).filter((meal) => {
    if (!meal.meal_datetime) return false;
    return formatLocalDate(new Date(meal.meal_datetime), timezone) === localDate;
  });
}

async function getMealIdsWithSuccessfulRuns(
  supabaseAdmin: SupabaseClient,
  userId: string,
  mealIds: string[]
): Promise<Set<string>> {
  if (mealIds.length === 0) {
    return new Set<string>();
  }

  const { data, error } = await supabaseAdmin
    .from("meal_processing_runs")
    .select("meal_id")
    .eq("user_id", userId)
    .eq("status", "success")
    .in("meal_id", mealIds);

  if (error) {
    throw new Error(`Failed to read meal_processing_runs for daily_nutrition2 workflow: ${error.message}`);
  }

  return new Set((data ?? []).map((row) => row.meal_id as string));
}

async function ensureSuccessfulMealProcessingRuns(
  supabaseAdmin: SupabaseClient,
  mealIds: string[]
): Promise<number> {
  let processedNow = 0;

  for (const mealId of mealIds) {
    const result = await processMeal(mealId, supabaseAdmin);
    if (!result.success) {
      throw new Error(result.error || `Meal processing failed for meal ${mealId}`);
    }
    if (!result.skipped) {
      processedNow += 1;
    }
  }

  return processedNow;
}

export async function ensureDailyNutrition2(
  params: EnsureDailyNutrition2Params
): Promise<EnsureDailyNutrition2Result> {
  const supabaseAdmin = params.supabaseAdmin ?? createSupabaseAdminClient();
  const timezone =
    params.timezone || (await getCanonicalTimeZone(supabaseAdmin, params.userId));

  const meals = await getMealsForLocalDate(
    supabaseAdmin,
    params.userId,
    params.localDate,
    timezone
  );

  const mealIds = meals.map((meal) => meal.id);
  const successMealIds = await getMealIdsWithSuccessfulRuns(
    supabaseAdmin,
    params.userId,
    mealIds
  );

  const missingMealIds = mealIds.filter((mealId) => !successMealIds.has(mealId));
  const mealsProcessedNow = await ensureSuccessfulMealProcessingRuns(
    supabaseAdmin,
    missingMealIds
  );

  const { data, error } = await supabaseAdmin.rpc("compute_daily_nutrition2", {
    p_user_id: params.userId,
    p_date: params.localDate,
    p_tz: timezone,
  });

  if (error) {
    throw new Error(`compute_daily_nutrition2 RPC failed: ${error.message}`);
  }

  return {
    localDate: params.localDate,
    timezone,
    mealsFound: meals.length,
    mealsProcessedNow,
    mealsAlreadyProcessed: meals.length - missingMealIds.length,
    row: (data as DailyNutrition2Row | null) ?? null,
  };
}

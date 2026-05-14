import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCanonicalTimeZone, type LocalDateString } from "@/lib/time";
import { processMeal } from "@/lib/meal-processing/process-meal";

type MealLogRow = {
  id: string;
  meal_local_date: string;
  meal_datetime: string | null;
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
  mealProcessingSkipped: number;
  skippedMealIds: string[];
  row: DailyNutrition2Row | null;
};

const MEAL_PROCESSING_MAX_RETRIES = Math.max(
  1,
  Number.parseInt(process.env.MEAL_PROCESSING_MAX_RETRIES || "3", 10) || 3
);
const SKIP_MEAL_PROCESSING_FAILURES =
  process.env.SKIP_MEAL_PROCESSING_FAILURES?.toLowerCase() === "true";

function isRetryableMealProcessingError(errorMessage: string | undefined): boolean {
  if (!errorMessage) return false;
  const normalized = errorMessage.toLowerCase();
  return [
    "connection error",
    "timeout",
    "timed out",
    "fetch failed",
    "econnreset",
    "etimedout",
    "connecttimeouterror",
    "rate limit",
    "temporarily unavailable",
    "503",
    "502",
    "504",
  ].some((pattern) => normalized.includes(pattern));
}

async function getMealsForLocalDate(
  supabaseAdmin: SupabaseClient,
  userId: string,
  localDate: LocalDateString,
): Promise<MealLogRow[]> {
  const { data, error } = await supabaseAdmin
    .from("meal_logs")
    .select("id, meal_local_date, meal_datetime")
    .eq("user_id", userId)
    .eq("meal_local_date", localDate)
    .order("meal_datetime", { ascending: true, nullsFirst: false });

  if (error) {
    throw new Error(`Failed to read meal_logs for daily_nutrition2 workflow: ${error.message}`);
  }

  return (data as MealLogRow[] | null) ?? [];
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
): Promise<{ processedNow: number; skippedMealIds: string[] }> {
  let processedNow = 0;
  const skippedMealIds: string[] = [];

  for (const mealId of mealIds) {
    let attempt = 0;
    let result: Awaited<ReturnType<typeof processMeal>> | null = null;

    while (attempt < MEAL_PROCESSING_MAX_RETRIES) {
      attempt += 1;
      result = await processMeal(mealId, supabaseAdmin);
      if (result.success) {
        break;
      }

      const shouldRetry =
        attempt < MEAL_PROCESSING_MAX_RETRIES &&
        isRetryableMealProcessingError(result.error);

      if (!shouldRetry) {
        break;
      }

      console.warn(
        `[dailyNutrition2] Retrying meal processing for meal ${mealId} after error: ${result.error || "unknown error"} (attempt ${attempt}/${MEAL_PROCESSING_MAX_RETRIES})`
      );
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }

    if (!result) {
      throw new Error(`Meal processing failed for meal ${mealId}`);
    }

    if (!result.success) {
      if (SKIP_MEAL_PROCESSING_FAILURES) {
        skippedMealIds.push(mealId);
        console.warn(
          `[dailyNutrition2] Skipping failed meal processing for meal ${mealId}: ${result.error || "unknown error"}`
        );
        continue;
      }
      throw new Error(result.error || `Meal processing failed for meal ${mealId}`);
    }
    if (!result.skipped) {
      processedNow += 1;
    }
  }

  return { processedNow, skippedMealIds };
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
    params.localDate
  );

  const mealIds = meals.map((meal) => meal.id);
  const successMealIds = await getMealIdsWithSuccessfulRuns(
    supabaseAdmin,
    params.userId,
    mealIds
  );

  const missingMealIds = mealIds.filter((mealId) => !successMealIds.has(mealId));
  const mealProcessing = await ensureSuccessfulMealProcessingRuns(
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
    mealsProcessedNow: mealProcessing.processedNow,
    mealsAlreadyProcessed: meals.length - missingMealIds.length,
    mealProcessingSkipped: mealProcessing.skippedMealIds.length,
    skippedMealIds: mealProcessing.skippedMealIds,
    row: (data as DailyNutrition2Row | null) ?? null,
  };
}

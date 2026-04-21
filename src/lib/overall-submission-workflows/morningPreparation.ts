import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCanonicalTimeZone, shiftLocalDate, type LocalDateString } from "@/lib/time";
import { ensureDailyCheckinRelation2 } from "./dailyCheckinRelation2";
import { ensureDailyNutrition2 } from "./dailyNutrition2";
import { build_daily_input_bundle_v1 } from "./inputBundleV1";
import { ensureJournalSummary2 } from "./journalSummary2";
import { updateState } from "./state_engine";

export type RunMorningPreparationParams = {
  userId: string;
  submissionLocalDate: LocalDateString;
  timezone?: string;
  supabaseAdmin?: SupabaseClient;
};

export type RunMorningPreparationResult = {
  submissionLocalDate: LocalDateString;
  processedLocalDate: LocalDateString;
  timezone: string;
  nutrition: Awaited<ReturnType<typeof ensureDailyNutrition2>>;
  checkinRelations: Awaited<ReturnType<typeof ensureDailyCheckinRelation2>>;
  journal: Awaited<ReturnType<typeof ensureJournalSummary2>>;
  bundle: Awaited<ReturnType<typeof build_daily_input_bundle_v1>>;
  state: Awaited<ReturnType<typeof updateState>>;
};

export async function runMorningPreparationForSubmissionDate(
  params: RunMorningPreparationParams
): Promise<RunMorningPreparationResult> {
  const supabaseAdmin = params.supabaseAdmin ?? createSupabaseAdminClient();
  const timezone =
    params.timezone || (await getCanonicalTimeZone(supabaseAdmin, params.userId));
  const processedLocalDate = shiftLocalDate(params.submissionLocalDate, -1);

  const nutrition = await ensureDailyNutrition2({
    userId: params.userId,
    localDate: processedLocalDate,
    timezone,
    supabaseAdmin,
  });

  const checkinRelations = await ensureDailyCheckinRelation2({
    userId: params.userId,
    localDate: processedLocalDate,
    supabaseAdmin,
  });

  const journal = await ensureJournalSummary2({
    userId: params.userId,
    localDate: processedLocalDate,
    timezone,
    supabaseAdmin,
  });

  const bundle = await build_daily_input_bundle_v1(
    params.userId,
    params.submissionLocalDate,
    processedLocalDate,
    supabaseAdmin,
    timezone
  );

  const state = await updateState({
    userId: params.userId,
    date: params.submissionLocalDate,
    inputBundle: bundle.row.bundle_json,
    supabaseAdmin,
  });

  return {
    submissionLocalDate: params.submissionLocalDate,
    processedLocalDate,
    timezone,
    nutrition,
    checkinRelations,
    journal,
    bundle,
    state,
  };
}

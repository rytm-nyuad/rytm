import {
  build_daily_input_bundle_v1,
  ensureDailyCheckinRelation2,
  ensureDailyNutrition2,
  ensureJournalSummary2,
  updateState,
} from "@/lib/overall-submission-workflows";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { shiftLocalDate } from "@/lib/time";

async function main() {
  const [, , userId, localDate, timezoneArg] = process.argv;

  if (!userId || !localDate) {
    throw new Error(
      "Usage: npx tsx scripts/test_overall_submission_workflows.ts <userId> <YYYY-MM-DD> [timezone]"
    );
  }

  const supabaseAdmin = createSupabaseAdminClient();

  const sourceLocalDate = shiftLocalDate(localDate, -1);

  const nutrition = await ensureDailyNutrition2({
    userId,
    localDate: sourceLocalDate,
    timezone: timezoneArg,
    supabaseAdmin,
  });

  const checkinRelations = await ensureDailyCheckinRelation2({
    userId,
    localDate: sourceLocalDate,
    supabaseAdmin,
  });

  const journal = await ensureJournalSummary2({
    userId,
    localDate: sourceLocalDate,
    timezone: timezoneArg,
    supabaseAdmin,
  });

  const bundle = await build_daily_input_bundle_v1(
    userId,
    localDate,
    sourceLocalDate,
    supabaseAdmin,
    timezoneArg
  );

  const state = await updateState({
    userId,
    date: localDate,
    inputBundle: bundle.row.bundle_json,
    supabaseAdmin,
  });

  console.dir(
    {
      nutrition,
      checkinRelations,
      journal,
      bundle,
      state,
    },
    { depth: null }
  );
}

void main();

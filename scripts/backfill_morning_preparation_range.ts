import { runMorningPreparationForSubmissionDate } from "@/lib/overall-submission-workflows";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCanonicalTimeZone, shiftLocalDate } from "@/lib/time";

async function main() {
  const [, , userId, startSubmissionDate, endSubmissionDate, timezoneArg] = process.argv;

  if (!userId || !startSubmissionDate || !endSubmissionDate) {
    throw new Error(
      "Usage: npx tsx scripts/backfill_morning_preparation_range.ts <userId> <startSubmissionDate> <endSubmissionDate> [timezone]"
    );
  }

  const supabaseAdmin = createSupabaseAdminClient();
  const timezone =
    timezoneArg || (await getCanonicalTimeZone(supabaseAdmin, userId));

  let currentSubmissionDate = startSubmissionDate;
  const results: Array<{
    submissionLocalDate: string;
    processedLocalDate: string;
    shouldRunSummary: boolean;
  }> = [];

  while (currentSubmissionDate <= endSubmissionDate) {
    const result = await runMorningPreparationForSubmissionDate({
      userId,
      submissionLocalDate: currentSubmissionDate,
      timezone,
      supabaseAdmin,
    });

    console.log(
      `[morning-prep] submission=${result.submissionLocalDate} processed=${result.processedLocalDate} shouldRunSummary=${result.state.shouldRunSummary}`
    );

    results.push({
      submissionLocalDate: result.submissionLocalDate,
      processedLocalDate: result.processedLocalDate,
      shouldRunSummary: result.state.shouldRunSummary,
    });

    currentSubmissionDate = shiftLocalDate(currentSubmissionDate, 1);
  }

  console.dir(
    {
      userId,
      timezone,
      startSubmissionDate,
      endSubmissionDate,
      processedDateRange: {
        start: shiftLocalDate(startSubmissionDate, -1),
        end: shiftLocalDate(endSubmissionDate, -1),
      },
      results,
    },
    { depth: null }
  );
}

void main();

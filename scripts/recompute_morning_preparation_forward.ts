import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCanonicalTimeZone } from "@/lib/time";
import { recomputeForwardFromSubmissionDate } from "@/lib/overall-submission-workflows";

async function main() {
  const [, , userId, startSubmissionDate, endSubmissionDate, timezoneArg] = process.argv;

  if (!userId || !startSubmissionDate) {
    throw new Error(
      "Usage: npx tsx scripts/recompute_morning_preparation_forward.ts <userId> <startSubmissionDate> [endSubmissionDate] [timezone]"
    );
  }

  const supabaseAdmin = createSupabaseAdminClient();
  const timezone =
    timezoneArg || (await getCanonicalTimeZone(supabaseAdmin, userId));

  const result = await recomputeForwardFromSubmissionDate({
    userId,
    startSubmissionDate,
    endSubmissionDate,
    timezone,
    supabaseAdmin,
  });

  console.dir(result, { depth: null });
}

void main();

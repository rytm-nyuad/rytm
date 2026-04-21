import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatLocalDate, getCanonicalTimeZone } from "@/lib/time";
import { refreshFitbitProfileTimezoneForUser } from "@/lib/fitbit";
import {
  queueForwardRecomputeFromChangedDate,
  runMorningPreparationForSubmissionDate,
} from "@/lib/overall-submission-workflows";

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHENTICATED" },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => null);
    const score = Number(body?.score);
    const providedLocalDate = typeof body?.localDate === "string" ? body.localDate : null;

    if (!Number.isInteger(score) || score < 0 || score > 100) {
      return NextResponse.json(
        { ok: false, error: "BAD_REQUEST", message: "score must be an integer between 0 and 100" },
        { status: 400 }
      );
    }

    if (providedLocalDate && !isIsoDate(providedLocalDate)) {
      return NextResponse.json(
        { ok: false, error: "BAD_REQUEST", message: "localDate must be YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const timezoneRefresh = await refreshFitbitProfileTimezoneForUser(supabaseAdmin, user.id);
    const canonicalTimezone = await getCanonicalTimeZone(supabaseAdmin, user.id);

    const localDate =
      providedLocalDate ||
      formatLocalDate(new Date(), canonicalTimezone);

    const { data, error } = await supabase.rpc("submit_overall_for_date", {
      p_user_id: user.id,
      p_local_date: localDate,
      p_score: score,
    });

    if (error || data !== true) {
      console.error("[Dashboard] submit_overall_for_date failed:", error);
      return NextResponse.json(
        { ok: false, error: "SUBMIT_FAILED", message: error?.message || "submit_overall_for_date returned false" },
        { status: 500 }
      );
    }

    const todayLocalDate = formatLocalDate(new Date(), canonicalTimezone);
    let morningPreparation:
      | { ok: true; processedLocalDate: string; shouldRunSummary: boolean }
      | { ok: false; error: string }
      | null = null;

    if (localDate === todayLocalDate) {
      try {
        const result = await runMorningPreparationForSubmissionDate({
          userId: user.id,
          submissionLocalDate: localDate,
          timezone: canonicalTimezone,
          supabaseAdmin,
        });

        morningPreparation = {
          ok: true,
          processedLocalDate: result.processedLocalDate,
          shouldRunSummary: result.state.shouldRunSummary,
        };
      } catch (workflowError: any) {
        console.error("[Dashboard] Morning preparation workflow failed:", workflowError);
        morningPreparation = {
          ok: false,
          error: workflowError?.message || "Unknown morning preparation error",
        };
      }
    } else if (localDate < todayLocalDate) {
      await queueForwardRecomputeFromChangedDate({
        userId: user.id,
        changedLocalDate: localDate,
        semantic: "submission",
        timezone: canonicalTimezone,
        supabaseAdmin,
      });
    }

    return NextResponse.json({
      ok: true,
      localDate,
      timezoneRefresh,
      morningPreparation,
    });
  } catch (error: any) {
    console.error("[Dashboard] Unexpected error in submit-overall route:", error);
    return NextResponse.json(
      { ok: false, error: "UNKNOWN_ERROR", message: error?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

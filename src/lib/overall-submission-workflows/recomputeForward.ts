import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatLocalDate, getCanonicalTimeZone, shiftLocalDate, type LocalDateString } from "@/lib/time";
import { runMorningPreparationForSubmissionDate } from "./morningPreparation";

export type RecomputeChangeSemantic = "source" | "submission";

export type RecomputeForwardParams = {
  userId: string;
  startSubmissionDate: LocalDateString;
  endSubmissionDate?: LocalDateString;
  timezone?: string;
  supabaseAdmin?: SupabaseClient;
};

export type RecomputeForwardResult = {
  userId: string;
  timezone: string;
  startSubmissionDate: LocalDateString;
  endSubmissionDate: LocalDateString;
  processedCount: number;
  results: Array<{
    submissionLocalDate: LocalDateString;
    processedLocalDate: LocalDateString;
    shouldRunSummary: boolean;
  }>;
};

export type QueueForwardRecomputeParams = {
  userId: string;
  changedLocalDate: LocalDateString;
  semantic: RecomputeChangeSemantic;
  timezone?: string;
  supabaseAdmin?: SupabaseClient;
};

export async function recomputeForwardFromSubmissionDate(
  params: RecomputeForwardParams
): Promise<RecomputeForwardResult> {
  const supabaseAdmin = params.supabaseAdmin ?? createSupabaseAdminClient();
  const timezone =
    params.timezone || (await getCanonicalTimeZone(supabaseAdmin, params.userId));
  const endSubmissionDate =
    params.endSubmissionDate || formatLocalDate(new Date(), timezone);

  let currentSubmissionDate = params.startSubmissionDate;
  const results: RecomputeForwardResult["results"] = [];

  while (currentSubmissionDate <= endSubmissionDate) {
    const result = await runMorningPreparationForSubmissionDate({
      userId: params.userId,
      submissionLocalDate: currentSubmissionDate,
      timezone,
      supabaseAdmin,
    });

    console.log(
      `[recompute-forward] user=${params.userId} submission=${result.submissionLocalDate} processed=${result.processedLocalDate} shouldRunSummary=${result.state.shouldRunSummary}`
    );

    results.push({
      submissionLocalDate: result.submissionLocalDate,
      processedLocalDate: result.processedLocalDate,
      shouldRunSummary: result.state.shouldRunSummary,
    });

    currentSubmissionDate = shiftLocalDate(currentSubmissionDate, 1);
  }

  return {
    userId: params.userId,
    timezone,
    startSubmissionDate: params.startSubmissionDate,
    endSubmissionDate,
    processedCount: results.length,
    results,
  };
}

export async function queueForwardRecomputeFromChangedDate(
  params: QueueForwardRecomputeParams
): Promise<{
  scheduled: boolean;
  backlogDetected: boolean;
  startSubmissionDate: LocalDateString;
  endSubmissionDate: LocalDateString;
  timezone: string;
}> {
  const supabaseAdmin = params.supabaseAdmin ?? createSupabaseAdminClient();
  const timezone =
    params.timezone || (await getCanonicalTimeZone(supabaseAdmin, params.userId));
  const todayLocalDate = formatLocalDate(new Date(), timezone);
  const startSubmissionDate =
    params.semantic === "source"
      ? shiftLocalDate(params.changedLocalDate, 1)
      : params.changedLocalDate;

  const backlogDetected = startSubmissionDate < todayLocalDate;

  if (!backlogDetected) {
    return {
      scheduled: false,
      backlogDetected,
      startSubmissionDate,
      endSubmissionDate: todayLocalDate,
      timezone,
    };
  }

  queueMicrotask(() => {
    void recomputeForwardFromSubmissionDate({
      userId: params.userId,
      startSubmissionDate,
      endSubmissionDate: todayLocalDate,
      timezone,
      supabaseAdmin,
    }).catch((error) => {
      console.error(
        `[recompute-forward] Failed queued recompute for user ${params.userId} from ${startSubmissionDate}:`,
        error
      );
    });
  });

  return {
    scheduled: true,
    backlogDetected,
    startSubmissionDate,
    endSubmissionDate: todayLocalDate,
    timezone,
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyInputBundleV1 } from "./inputBundleV1";
import { shiftLocalDate } from "@/lib/time";
import { withSupabaseRetry } from "./supabaseRetry";

type EvaluationMode = "auto" | "user_rating" | "mixed" | "none";

type SignalRef = {
  source: "bundle" | "state" | "history";
  path: string;
  operator?: ">=" | "<=" | ">" | "<" | "==" | "!=" | "includes" | "exists" | "not_exists";
  threshold_num?: number;
  expected_value?: unknown;
  label?: string;
};

type ActionEvaluation = {
  mode?: EvaluationMode;
  signal_refs?: SignalRef[];
  completion_prompt?: string | null;
  success_definition?: string | null;
};

type ActionEvidence = {
  bundle_refs?: string[];
  state_refs?: string[];
  history_refs?: string[];
};

type ActionLike = {
  action_id?: string;
  title?: string;
  domain?: string;
  evaluation?: ActionEvaluation;
  evidence?: ActionEvidence;
};

type CurrentStateRow = {
  state_json: Record<string, unknown>;
};

function getValueAtPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  const segments = path.split(".").filter(Boolean);
  let current: unknown = obj;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function isBlockedRef(source: SignalRef["source"], path: string) {
  const normalized = path.trim().toLowerCase();
  if (!normalized) return true;
  if (source === "bundle" && normalized.startsWith("journal.")) return true;
  if (source === "state" && normalized.startsWith("episodic_memory.")) return true;
  return false;
}

function sanitizeSignalRefs(signalRefs: unknown): SignalRef[] {
  if (!Array.isArray(signalRefs)) return [];
  return signalRefs
    .filter((ref): ref is Record<string, unknown> => !!ref && typeof ref === "object")
    .map((ref): SignalRef => {
      const source: SignalRef["source"] =
        ref.source === "bundle" || ref.source === "state" || ref.source === "history"
          ? ref.source
          : "bundle";
      const operator: SignalRef["operator"] =
        ref.operator === ">=" ||
        ref.operator === "<=" ||
        ref.operator === ">" ||
        ref.operator === "<" ||
        ref.operator === "==" ||
        ref.operator === "!=" ||
        ref.operator === "includes" ||
        ref.operator === "exists" ||
        ref.operator === "not_exists"
          ? ref.operator
          : undefined;
      return {
        source,
        path: typeof ref.path === "string" ? ref.path : "",
        operator,
        threshold_num: typeof ref.threshold_num === "number" ? ref.threshold_num : undefined,
        expected_value: ref.expected_value,
        label: typeof ref.label === "string" ? ref.label : undefined,
      };
    })
    .filter((ref) => ref.path && !isBlockedRef(ref.source, ref.path) && ref.source !== "history");
}

function compareSignal(ref: SignalRef, value: unknown) {
  const operator = ref.operator ?? "exists";
  const missing = value === null || value === undefined;

  if (operator === "exists") {
    return {
      status: missing ? "fail" : "success",
      reason: missing ? "value missing" : "value present",
    } as const;
  }

  if (operator === "not_exists") {
    return {
      status: missing ? "success" : "fail",
      reason: missing ? "value absent as expected" : "value present",
    } as const;
  }

  if (missing) {
    return {
      status: "tbd",
      reason: "value missing",
    } as const;
  }

  if (operator === "includes") {
    if (!Array.isArray(value)) {
      return { status: "tbd", reason: "value is not an array" } as const;
    }
    const success = value.includes(ref.expected_value);
    return {
      status: success ? "success" : "fail",
      reason: success ? "array includes expected value" : "array does not include expected value",
    } as const;
  }

  if (operator === "==" || operator === "!=") {
    const success = operator === "==" ? value === ref.expected_value : value !== ref.expected_value;
    return {
      status: success ? "success" : "fail",
      reason: success ? `comparison ${operator} passed` : `comparison ${operator} failed`,
    } as const;
  }

  if (typeof value !== "number" || typeof ref.threshold_num !== "number") {
    return { status: "tbd", reason: "numeric comparison unavailable" } as const;
  }

  const success =
    operator === ">="
      ? value >= ref.threshold_num
      : operator === "<="
        ? value <= ref.threshold_num
        : operator === ">"
          ? value > ref.threshold_num
          : value < ref.threshold_num;

  return {
    status: success ? "success" : "fail",
    reason: success ? `comparison ${operator} passed` : `comparison ${operator} failed`,
  } as const;
}

function evaluateSingleAction(
  action: ActionLike,
  inputBundle: DailyInputBundleV1,
  currentState: Record<string, unknown>
) {
  const evaluation = (action.evaluation ?? {}) as ActionEvaluation;
  const mode: EvaluationMode = evaluation.mode ?? "none";
  const signalRefs = sanitizeSignalRefs(evaluation.signal_refs);

  if (mode === "none") {
    return {
      action_id: action.action_id ?? null,
      title: action.title ?? null,
      outcome_score: "tbd",
      reason: "No deterministic evaluation configured",
      evidence_used: { bundle: {}, state: {}, ignored_refs: [] as string[] },
      requires_user_rating_next_time: false,
      evaluation_mode: mode,
    };
  }

  if (mode === "user_rating") {
    return {
      action_id: action.action_id ?? null,
      title: action.title ?? null,
      outcome_score: "tbd",
      reason: "Action requires user-reported completion",
      evidence_used: { bundle: {}, state: {}, ignored_refs: [] as string[] },
      requires_user_rating_next_time: true,
      evaluation_mode: mode,
    };
  }

  if (signalRefs.length === 0) {
    return {
      action_id: action.action_id ?? null,
      title: action.title ?? null,
      outcome_score: "tbd",
      reason: "No supported non-journal signal refs available for deterministic evaluation",
      evidence_used: { bundle: {}, state: {}, ignored_refs: [] as string[] },
      requires_user_rating_next_time: mode === "mixed",
      evaluation_mode: mode,
    };
  }

  const bundleEvidence: Record<string, unknown> = {};
  const stateEvidence: Record<string, unknown> = {};
  const statuses: Array<"success" | "fail" | "tbd"> = [];
  const reasons: string[] = [];

  for (const ref of signalRefs) {
    const target = ref.source === "state" ? currentState : inputBundle;
    const observed = getValueAtPath(target, ref.path);
    const comparison = compareSignal(ref, observed);
    statuses.push(comparison.status);
    reasons.push(`${ref.label ?? ref.path}: ${comparison.reason}`);

    if (ref.source === "state") {
      stateEvidence[ref.path] = observed ?? null;
    } else {
      bundleEvidence[ref.path] = observed ?? null;
    }
  }

  let outcomeScore: "success" | "fail" | "tbd";
  if (statuses.includes("fail")) {
    outcomeScore = "fail";
  } else if (statuses.every((status) => status === "success")) {
    outcomeScore = "success";
  } else {
    outcomeScore = "tbd";
  }

  return {
    action_id: action.action_id ?? null,
    title: action.title ?? null,
    outcome_score: outcomeScore,
    reason: reasons.join("; "),
    evidence_used: {
      bundle: bundleEvidence,
      state: stateEvidence,
      ignored_refs: [] as string[],
    },
    requires_user_rating_next_time: outcomeScore === "tbd" || mode === "mixed",
    evaluation_mode: mode,
  };
}

export async function evaluatePreviousStateHistoryActions(params: {
  client: SupabaseClient;
  userId: string;
  submissionDate: string;
  inputBundle: DailyInputBundleV1;
  currentStateRow: CurrentStateRow;
}) {
  const previousSubmissionDate = shiftLocalDate(params.submissionDate, -1);
  const { data: previousRow, error: previousError } = await withSupabaseRetry(
    "read previous user_state_history2 actions for outcome evaluation",
    () =>
      params.client
        .from("user_state_history2")
        .select("actions_generated_json, outcomes_json")
        .eq("user_id", params.userId)
        .eq("date", previousSubmissionDate)
        .maybeSingle()
  );

  if (previousError) {
    throw new Error(`Failed to read previous user_state_history2: ${previousError.message}`);
  }

  const actions = Array.isArray(previousRow?.actions_generated_json?.actions)
    ? (previousRow.actions_generated_json.actions as ActionLike[])
    : [];

  if (actions.length === 0) {
    return null;
  }

  const actionResults = actions.map((action) =>
    evaluateSingleAction(action, params.inputBundle, params.currentStateRow.state_json)
  );

  const outcomesPayload = {
    evaluated_at: new Date().toISOString(),
    evaluated_on_submission_date: params.submissionDate,
    evaluation_source_date: previousSubmissionDate,
    action_results: actionResults,
  };

  const { error: updateError } = await withSupabaseRetry(
    "update previous user_state_history2 outcomes",
    () =>
      params.client
        .from("user_state_history2")
        .update({ outcomes_json: outcomesPayload })
        .eq("user_id", params.userId)
        .eq("date", previousSubmissionDate)
  );

  if (updateError) {
    throw new Error(`Failed to update previous user_state_history2 outcomes: ${updateError.message}`);
  }

  return outcomesPayload;
}

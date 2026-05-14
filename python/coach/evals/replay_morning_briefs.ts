import { spawn } from "child_process";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

import { runMorningPreparationForSubmissionDate } from "@/lib/overall-submission-workflows";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCanonicalTimeZone, shiftLocalDate } from "@/lib/time";

dotenv.config({ path: ".env.local" });
dotenv.config();

type ReplayStatus = "generated" | "skipped_not_ready" | "failed";

type ReplayManifestEntry = {
  submissionDate: string;
  sourceLocalDate: string;
  timezone: string;
  status: ReplayStatus;
  planId: string | null;
  judgeInputPath: string | null;
  error: string | null;
};

type DailyPlanRow = {
  plan_id: string;
  for_date: string;
  morning_message: string;
  selected_domains_json: string[] | null;
  day_constraints_json: Record<string, unknown> | null;
  updated_at: string | null;
};

type StateHistoryRow = {
  date: string;
  state_version: string;
  state_snapshot_json: Record<string, unknown> | null;
  actions_generated_json: Record<string, unknown> | null;
  outcomes_json?: Record<string, unknown> | null;
};

type InputBundleRow = {
  user_id: string;
  date: string;
  bundle_version: string;
  timezone: string | null;
  generated_at: string;
  overall_true_today: number | null;
  physio_proxy_score_0_100: number | null;
  gap_today: number | null;
  missingness_json: Record<string, unknown> | null;
  confidence_json: Record<string, unknown> | null;
  bundle_json: Record<string, unknown>;
};

type GoalRow = {
  goal_id: string;
  title: string;
  goal_type: string;
  status: string;
  goal_spec_json: Record<string, unknown> | null;
  created_at: string;
};

type MorningPipelineResult = {
  plan_id: string;
  morning_message: string;
  actions: unknown[];
  debug: Record<string, unknown>;
};

type JudgeInputRecord = {
  export_version: "v1";
  exported_at: string;
  user_id: string;
  morning_briefing_id: string;
  brief_date: string;
  source_local_date: string;
  timezone: string | null;
  candidate_model: string;
  candidate_prompt_version: string;
  bundle_version: string;
  state_version: string;
  goal_context: GoalRow | null;
  full_morning_briefing: {
    definition: "Evaluate the morning_message together with the same-day generated_actions, because both are shown to the user as one morning briefing experience.";
    morning_message: string;
    generated_actions: unknown[];
  };
  morning_briefing: {
    plan_id: string;
    morning_message: string;
    selected_domains: string[];
    day_constraints: Record<string, unknown> | null;
    updated_at: string | null;
  };
  generated_actions: unknown[];
  previous_day_generated_actions: unknown[];
  previous_day_briefing: {
    brief_date: string;
    plan_id: string | null;
    morning_message: string | null;
  } | null;
  prepared_context: {
    input_bundle_row: InputBundleRow;
    state_history_row: StateHistoryRow;
    previous_state_history_row: StateHistoryRow | null;
  };
};

const EVALS_DIR = path.join(process.cwd(), "python", "coach", "evals");
const RUNS_DIR = path.join(EVALS_DIR, "runs");
const GENERATION_RUNS_DIR = path.join(RUNS_DIR, "generation");

function usage(): never {
  throw new Error(
    "Usage: npm run coach-evals:replay -- <userId> <startSubmissionDate> <endSubmissionDate> [timezone] [--continue-on-error]"
  );
}

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function makeRunId(prefix: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}__${stamp}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readPythonConstant(filePath: string, constantName: string): string {
  const content = fs.readFileSync(filePath, "utf8");
  const regex = new RegExp(`${escapeRegExp(constantName)}\\s*=\\s*["']([^"']+)["']`);
  const match = regex.exec(content);
  if (!match) {
    throw new Error(`Could not find ${constantName} in ${filePath}`);
  }
  return match[1];
}

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let continueOnError = false;

  for (const token of argv) {
    if (token === "--continue-on-error") {
      continueOnError = true;
    } else {
      positional.push(token);
    }
  }

  const [userId, startSubmissionDate, endSubmissionDate, timezone] = positional;
  if (!userId || !startSubmissionDate || !endSubmissionDate) {
    usage();
  }

  return {
    userId,
    startSubmissionDate,
    endSubmissionDate,
    timezone,
    continueOnError,
  };
}

function resolvePythonBinary(): string {
  const venvPython = path.join(process.cwd(), "python", "coach", "venv", "bin", "python3");
  return fs.existsSync(venvPython) ? venvPython : "python3";
}

function runPythonPipeline(
  userId: string,
  forDate: string,
  overallScore: number,
  ingestionRunId: string
): Promise<MorningPipelineResult> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), "python", "coach", "run_pipeline.py");
    const pythonBin = resolvePythonBinary();
    const child = spawn(pythonBin, [scriptPath, userId, forDate, String(overallScore), ingestionRunId]);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        const details = (stdout || stderr || "").trim();
        reject(
          new Error(
            details
              ? `Python process exited with code ${code}: ${details}`
              : `Python process exited with code ${code}`
          )
        );
        return;
      }

      try {
        resolve(JSON.parse(stdout) as MorningPipelineResult);
      } catch (error) {
        reject(new Error(`Failed to parse Python output: ${stdout}`));
      }
    });
  });
}

function getActionArray(payload: Record<string, unknown> | null | undefined): unknown[] {
  const actions = payload?.actions;
  return Array.isArray(actions) ? actions : [];
}

async function updateStateHistoryActions(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  submissionDate: string,
  result: MorningPipelineResult
) {
  const payload = {
    themes: Array.isArray(result?.debug?.selected_domains)
      ? (result.debug.selected_domains as unknown[])
      : [],
    actions: Array.isArray(result?.actions) ? result.actions : [],
    questions: [],
  };

  const { error } = await supabaseAdmin
    .from("user_state_history2")
    .update({
      actions_generated_json: payload,
    })
    .eq("user_id", userId)
    .eq("date", submissionDate);

  if (error) {
    throw new Error(`Failed to update user_state_history2 actions_generated_json: ${error.message}`);
  }
}

async function fetchOverallScore(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  submissionDate: string
): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("daily_overall")
    .select("overall_score")
    .eq("user_id", userId)
    .eq("date", submissionDate)
    .maybeSingle();

  if (error || !data || typeof data.overall_score !== "number") {
    throw new Error(`No overall_score found for ${submissionDate}`);
  }

  return data.overall_score;
}

async function fetchActiveGoal(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string
): Promise<GoalRow | null> {
  const { data, error } = await supabaseAdmin
    .from("user_goals1")
    .select("goal_id, title, goal_type, status, goal_spec_json, created_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read active goal: ${error.message}`);
  }

  return (data as GoalRow | null) ?? null;
}

async function fetchPlanRow(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  submissionDate: string
): Promise<DailyPlanRow> {
  const { data, error } = await supabaseAdmin
    .from("daily_plans1")
    .select("plan_id, for_date, morning_message, selected_domains_json, day_constraints_json, updated_at")
    .eq("user_id", userId)
    .eq("for_date", submissionDate)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Failed to read daily_plans1 for ${submissionDate}`);
  }

  return data as DailyPlanRow;
}

async function fetchStateHistoryRow(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  submissionDate: string
): Promise<StateHistoryRow> {
  const { data, error } = await supabaseAdmin
    .from("user_state_history2")
    .select("date, state_version, state_snapshot_json, actions_generated_json, outcomes_json")
    .eq("user_id", userId)
    .eq("date", submissionDate)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Failed to read user_state_history2 for ${submissionDate}`);
  }

  return data as StateHistoryRow;
}

async function fetchPreviousStateHistoryRow(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  submissionDate: string
): Promise<StateHistoryRow | null> {
  const previousDate = shiftLocalDate(submissionDate, -1);
  const { data, error } = await supabaseAdmin
    .from("user_state_history2")
    .select("date, state_version, state_snapshot_json, actions_generated_json, outcomes_json")
    .eq("user_id", userId)
    .eq("date", previousDate)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read previous user_state_history2 for ${previousDate}`);
  }

  return (data as StateHistoryRow | null) ?? null;
}

async function fetchBundleRow(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  submissionDate: string
): Promise<InputBundleRow> {
  const { data, error } = await supabaseAdmin
    .from("daily_input_bundle_v12")
    .select(
      "user_id, date, bundle_version, timezone, generated_at, overall_true_today, physio_proxy_score_0_100, gap_today, missingness_json, confidence_json, bundle_json"
    )
    .eq("user_id", userId)
    .eq("date", submissionDate)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Failed to read daily_input_bundle_v12 for ${submissionDate}`);
  }

  return data as InputBundleRow;
}

async function fetchPreviousPlanSummary(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  submissionDate: string
): Promise<JudgeInputRecord["previous_day_briefing"]> {
  const previousDate = shiftLocalDate(submissionDate, -1);
  const { data, error } = await supabaseAdmin
    .from("daily_plans1")
    .select("plan_id, morning_message")
    .eq("user_id", userId)
    .eq("for_date", previousDate)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read previous daily_plans1 for ${previousDate}`);
  }

  if (!data) {
    return null;
  }

  return {
    brief_date: previousDate,
    plan_id: typeof data.plan_id === "string" ? data.plan_id : null,
    morning_message: typeof data.morning_message === "string" ? data.morning_message : null,
  };
}

async function exportJudgeInput(params: {
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
  userId: string;
  submissionDate: string;
  outputDir: string;
  promptVersion: string;
  candidateModel: string;
  goal: GoalRow | null;
}): Promise<{ planId: string; outputPath: string }> {
  const bundleRow = await params.supabaseAdmin
    .from("daily_input_bundle_v12")
    .select(
      "user_id, date, bundle_version, timezone, generated_at, overall_true_today, physio_proxy_score_0_100, gap_today, missingness_json, confidence_json, bundle_json"
    )
    .eq("user_id", params.userId)
    .eq("date", params.submissionDate)
    .single();

  if (bundleRow.error) {
    throw new Error(`Failed to fetch bundle row for export: ${bundleRow.error.message}`);
  }

  const inputBundleRow = bundleRow.data as InputBundleRow;
  const planRow = await fetchPlanRow(params.supabaseAdmin, params.userId, params.submissionDate);
  const stateHistoryRow = await fetchStateHistoryRow(params.supabaseAdmin, params.userId, params.submissionDate);
  const previousStateHistoryRow = await fetchPreviousStateHistoryRow(
    params.supabaseAdmin,
    params.userId,
    params.submissionDate
  );
  const previousDayBriefing = await fetchPreviousPlanSummary(
    params.supabaseAdmin,
    params.userId,
    params.submissionDate
  );

  const record: JudgeInputRecord = {
    export_version: "v1",
    exported_at: new Date().toISOString(),
    user_id: params.userId,
    morning_briefing_id: planRow.plan_id,
    brief_date: planRow.for_date,
    source_local_date: shiftLocalDate(planRow.for_date, -1),
    timezone: inputBundleRow.timezone,
    candidate_model: params.candidateModel,
    candidate_prompt_version: params.promptVersion,
    bundle_version: inputBundleRow.bundle_version,
    state_version: stateHistoryRow.state_version,
    goal_context: params.goal,
    full_morning_briefing: {
      definition:
        "Evaluate the morning_message together with the same-day generated_actions, because both are shown to the user as one morning briefing experience.",
      morning_message: planRow.morning_message,
      generated_actions: getActionArray(stateHistoryRow.actions_generated_json),
    },
    morning_briefing: {
      plan_id: planRow.plan_id,
      morning_message: planRow.morning_message,
      selected_domains: Array.isArray(planRow.selected_domains_json) ? planRow.selected_domains_json : [],
      day_constraints: planRow.day_constraints_json,
      updated_at: planRow.updated_at,
    },
    generated_actions: getActionArray(stateHistoryRow.actions_generated_json),
    previous_day_generated_actions: getActionArray(previousStateHistoryRow?.actions_generated_json),
    previous_day_briefing: previousDayBriefing,
    prepared_context: {
      input_bundle_row: inputBundleRow,
      state_history_row: stateHistoryRow,
      previous_state_history_row: previousStateHistoryRow,
    },
  };

  const outputPath = path.join(
    params.outputDir,
    `${record.brief_date}__${record.morning_briefing_id}.json`
  );
  fs.writeFileSync(outputPath, JSON.stringify(record, null, 2));
  return { planId: planRow.plan_id, outputPath };
}

async function main() {
  const { userId, startSubmissionDate, endSubmissionDate, timezone, continueOnError } = parseArgs(
    process.argv.slice(2)
  );
  const supabaseAdmin = createSupabaseAdminClient();
  const promptVersion = readPythonConstant(
    path.join(process.cwd(), "python", "coach", "prompts.py"),
    "PROMPT_VERSION"
  );
  const candidateModel = readPythonConstant(
    path.join(process.cwd(), "python", "coach", "langgraph_pipeline.py"),
    "self.model_name"
  );
  const goal = await fetchActiveGoal(supabaseAdmin, userId);

  if (!goal) {
    throw new Error(`No active goal found for user ${userId}`);
  }

  const runId = makeRunId(`generation__${userId}__${startSubmissionDate}__${endSubmissionDate}`);
  const runDir = path.join(GENERATION_RUNS_DIR, runId);
  const judgeInputsDir = path.join(runDir, "judge_inputs");
  ensureDir(judgeInputsDir);

  const manifestEntries: ReplayManifestEntry[] = [];
  let currentSubmissionDate = startSubmissionDate;

  while (currentSubmissionDate <= endSubmissionDate) {
    const activeTimezone = timezone || (await getCanonicalTimeZone(supabaseAdmin, userId));
    const sourceLocalDate = shiftLocalDate(currentSubmissionDate, -1);

    try {
      console.log(
        `[coach-evals:replay] start submission=${currentSubmissionDate} source=${sourceLocalDate} timezone=${activeTimezone}`
      );

      const prep = await runMorningPreparationForSubmissionDate({
        userId,
        submissionLocalDate: currentSubmissionDate,
        timezone: activeTimezone,
        supabaseAdmin,
      });

      if (!prep.state.shouldRunSummary) {
        console.log(
          `[coach-evals:replay] skip submission=${currentSubmissionDate} reason=not_ready`
        );
        manifestEntries.push({
          submissionDate: currentSubmissionDate,
          sourceLocalDate,
          timezone: activeTimezone,
          status: "skipped_not_ready",
          planId: null,
          judgeInputPath: null,
          error: null,
        });
        currentSubmissionDate = shiftLocalDate(currentSubmissionDate, 1);
        continue;
      }

      const overallScore = await fetchOverallScore(supabaseAdmin, userId, currentSubmissionDate);

      const { error: deleteError } = await supabaseAdmin
        .from("daily_plans1")
        .delete()
        .eq("user_id", userId)
        .eq("for_date", currentSubmissionDate);

      if (deleteError) {
        throw new Error(`Failed to delete existing daily_plans1 row: ${deleteError.message}`);
      }

      const { data: ingestionRun, error: ingestionError } = await supabaseAdmin
        .from("ingestion_runs1")
        .insert({
          user_id: userId,
          for_date: currentSubmissionDate,
          status: "success",
          pipeline_version: "mvp-v1-langgraph",
        })
        .select("ingestion_run_id")
        .single();

      if (ingestionError || !ingestionRun) {
        throw new Error(`Failed to create ingestion run: ${ingestionError?.message || "unknown"}`);
      }

      const result = await runPythonPipeline(
        userId,
        currentSubmissionDate,
        overallScore,
        ingestionRun.ingestion_run_id
      );

      await updateStateHistoryActions(supabaseAdmin, userId, currentSubmissionDate, result);
      const exportResult = await exportJudgeInput({
        supabaseAdmin,
        userId,
        submissionDate: currentSubmissionDate,
        outputDir: judgeInputsDir,
        promptVersion,
        candidateModel,
        goal,
      });

      console.log(
        `[coach-evals:replay] generated submission=${currentSubmissionDate} plan_id=${exportResult.planId}`
      );

      manifestEntries.push({
        submissionDate: currentSubmissionDate,
        sourceLocalDate,
        timezone: activeTimezone,
        status: "generated",
        planId: exportResult.planId,
        judgeInputPath: exportResult.outputPath,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[coach-evals:replay] failed submission=${currentSubmissionDate}: ${message}`);
      manifestEntries.push({
        submissionDate: currentSubmissionDate,
        sourceLocalDate,
        timezone: activeTimezone,
        status: "failed",
        planId: null,
        judgeInputPath: null,
        error: message,
      });
      if (!continueOnError) {
        break;
      }
    }

    currentSubmissionDate = shiftLocalDate(currentSubmissionDate, 1);
  }

  const manifestPath = path.join(runDir, "manifest.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        run_id: runId,
        created_at: new Date().toISOString(),
        user_id: userId,
        start_submission_date: startSubmissionDate,
        end_submission_date: endSubmissionDate,
        prompt_version: promptVersion,
        candidate_model: candidateModel,
        judge_inputs_dir: judgeInputsDir,
        entries: manifestEntries,
      },
      null,
      2
    )
  );

  console.log(`[coach-evals:replay] manifest=${manifestPath}`);
}

void main();

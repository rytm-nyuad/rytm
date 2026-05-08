import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: ".env.local" });
dotenv.config();

type RubricQuestion = {
  id: string;
  dimension: string;
  statement: string;
};

type RubricDefinition = {
  rubric_id: string;
  rubric_version: string;
  scale: {
    min: number;
    max: number;
    labels: Record<string, string>;
  };
  system_context: {
    coaching_goal: string;
    user_profile: string;
    timing_notes: string[];
  };
  questions: RubricQuestion[];
};

type JudgeInputRecord = {
  export_version: string;
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
  goal_context: Record<string, unknown> | null;
  full_morning_briefing: {
    definition: string;
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
    input_bundle_row: Record<string, unknown>;
    state_history_row: Record<string, unknown>;
    previous_state_history_row: Record<string, unknown> | null;
  };
};

type JudgeQuestionScore = {
  question_id: string;
  score: number;
  rationale: string;
};

type JudgeResponse = {
  question_scores: JudgeQuestionScore[];
  overall_score: number;
  overall_rationale: string;
};

type JudgeRunRow = {
  morning_briefing_id: string;
  brief_date: string;
  source_local_date: string;
  timezone: string | null;
  user_id: string;
  candidate_model: string;
  candidate_prompt_version: string;
  bundle_version: string;
  state_version: string;
  judge_model: string;
  judge_prompt_version: string;
  rubric_id: string;
  rubric_version: string;
  overall_score: number;
  overall_rationale: string;
  judged_at: string;
  question_scores: Record<string, number>;
  question_rationales: Record<string, string>;
};

const DEFAULT_JUDGE_MODELS = [
  "openai/gpt-4.1",
  "anthropic/claude-sonnet-4.6",
  "google/gemini-2.5-pro",
];

const JUDGE_PROMPT_VERSION = "judge_prompt_v1";
const EVALS_DIR = path.join(process.cwd(), "python", "coach", "evals");
const RUBRIC_PATH = path.join(EVALS_DIR, "rubrics", "morning_brief_rubric_v1.json");
const JUDGING_RUNS_DIR = path.join(EVALS_DIR, "runs", "judging");
const MAX_JUDGE_ATTEMPTS = 3;

function usage(): never {
  throw new Error(
    "Usage: npm run coach-evals:judge -- --inputs-dir <dir> [--rubric <path>] [--judge-models model1,model2,...]"
  );
}

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function makeRunId(prefix: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}__${stamp}`;
}

function sanitizeFileToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function parseArgs(argv: string[]) {
  let inputsDir = "";
  let rubricPath = RUBRIC_PATH;
  let judgeModels = DEFAULT_JUDGE_MODELS;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--inputs-dir") {
      inputsDir = argv[index + 1] || "";
      index += 1;
    } else if (token === "--rubric") {
      rubricPath = argv[index + 1] || rubricPath;
      index += 1;
    } else if (token === "--judge-models") {
      const raw = argv[index + 1] || "";
      judgeModels = raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      index += 1;
    }
  }

  if (!inputsDir) {
    usage();
  }

  return { inputsDir, rubricPath, judgeModels };
}

function loadRubric(filePath: string): RubricDefinition {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as RubricDefinition;
}

function loadJudgeInputs(inputsDir: string): JudgeInputRecord[] {
  const fileNames = fs
    .readdirSync(inputsDir)
    .filter((name) => name.endsWith(".json"))
    .sort();

  return fileNames.map((fileName) =>
    JSON.parse(fs.readFileSync(path.join(inputsDir, fileName), "utf8")) as JudgeInputRecord
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Could not find JSON object in response: ${text}`);
  }
  return text.slice(start, end + 1);
}

function buildSystemPrompt(rubric: RubricDefinition): string {
  const questionLines = rubric.questions
    .map(
      (question) =>
        `- ${question.id} (${question.dimension}): ${question.statement}`
    )
    .join("\n");

  return [
    "You are an expert evaluator of personalized wellness coaching messages.",
    "",
    "Background:",
    rubric.system_context.coaching_goal,
    rubric.system_context.user_profile,
    "",
    "Critical timing guidance:",
    ...rubric.system_context.timing_notes.map((note) => `- ${note}`),
    "",
    "You will grade one morning briefing at a time using the rubric below.",
    "Important: the full morning briefing includes both the morning message and the same-day generated actions shown in the UI.",
    "Do not evaluate the morning message in isolation.",
    "Be strict about temporal correctness, specificity, and whether actions are realistic for the same day.",
    "Use the provided context JSON as the source of truth.",
    "If the summary gets timing wrong, that should lower relevant scores.",
    "",
    `Rating scale: ${rubric.scale.min}-${rubric.scale.max}`,
    ...Object.entries(rubric.scale.labels).map(([score, label]) => `- ${score}: ${label}`),
    "",
    "Rubric questions:",
    questionLines,
    "",
    "Output rules:",
    "- Return valid JSON only.",
    "- Score every rubric question exactly once.",
    "- Each rationale should be short and evidence-based.",
    "- Do not invent missing context.",
    "",
    "Required JSON schema:",
    "{",
    '  "question_scores": [',
    "    {",
    '      "question_id": "string",',
    '      "score": 1,',
    '      "rationale": "string"',
    "    }",
    "  ],",
    '  "overall_score": 1,',
    '  "overall_rationale": "string"',
    "}",
  ].join("\n");
}

function buildUserPrompt(rubric: RubricDefinition, record: JudgeInputRecord): string {
  return [
    "Evaluate the following morning briefing example.",
    "",
    "Important: score the full morning briefing as the user experiences it in the UI.",
    "That means you must evaluate both:",
    "- the morning message from daily_plans1",
    "- the same-day generated actions from user_state_history2.actions_generated_json",
    "",
    "Use the rubric statements exactly as written.",
    "The previous day's generated actions are included only as continuity context.",
    "Do not score continuity unless it changes how useful, specific, or realistic the current briefing feels.",
    "",
    "Rubric summary:",
    ...rubric.questions.map((question) => `- ${question.id}: ${question.statement}`),
    "",
    "Example JSON:",
    JSON.stringify(record, null, 2),
  ].join("\n");
}

async function callJudgeModel(
  judgeModel: string,
  rubric: RubricDefinition,
  record: JudgeInputRecord
): Promise<{ parsed: JudgeResponse; rawText: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://rytm.local",
      "X-Title": "rytm-coach-evals",
    },
    body: JSON.stringify({
      model: judgeModel,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(rubric),
        },
        {
          role: "user",
          content: buildUserPrompt(rubric, record),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Judge API request failed (${response.status}): ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawText = payload.choices?.[0]?.message?.content?.trim();

  if (!rawText) {
    throw new Error("Judge model returned empty content");
  }

  const parsed = JSON.parse(extractJsonObject(rawText)) as JudgeResponse;
  validateJudgeResponse(parsed, rubric);
  return { parsed, rawText };
}

async function callJudgeModelWithRetry(
  judgeModel: string,
  rubric: RubricDefinition,
  record: JudgeInputRecord
): Promise<{ parsed: JudgeResponse; rawText: string; attemptsUsed: number }> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_JUDGE_ATTEMPTS; attempt += 1) {
    try {
      const result = await callJudgeModel(judgeModel, rubric, record);
      return {
        ...result,
        attemptsUsed: attempt,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(
        `[coach-evals:judge] retry model=${judgeModel} brief_date=${record.brief_date} attempt=${attempt} error=${lastError.message}`
      );
      if (attempt < MAX_JUDGE_ATTEMPTS) {
        await sleep(attempt * 1500);
      }
    }
  }

  throw lastError ?? new Error("Unknown judge error");
}

function validateJudgeResponse(response: JudgeResponse, rubric: RubricDefinition) {
  if (!Array.isArray(response.question_scores)) {
    throw new Error("Judge response missing question_scores array");
  }

  const expectedIds = new Set(rubric.questions.map((question) => question.id));
  const seenIds = new Set<string>();

  for (const item of response.question_scores) {
    if (!expectedIds.has(item.question_id)) {
      throw new Error(`Unexpected question_id: ${item.question_id}`);
    }
    if (seenIds.has(item.question_id)) {
      throw new Error(`Duplicate question_id: ${item.question_id}`);
    }
    if (typeof item.score !== "number" || item.score < rubric.scale.min || item.score > rubric.scale.max) {
      throw new Error(`Invalid score for ${item.question_id}: ${item.score}`);
    }
    if (typeof item.rationale !== "string") {
      throw new Error(`Missing rationale for ${item.question_id}`);
    }
    seenIds.add(item.question_id);
  }

  if (seenIds.size !== rubric.questions.length) {
    throw new Error("Judge response did not score every rubric question");
  }
}

function buildRow(
  record: JudgeInputRecord,
  judgeModel: string,
  rubric: RubricDefinition,
  response: JudgeResponse
): JudgeRunRow {
  const questionScores: Record<string, number> = {};
  const questionRationales: Record<string, string> = {};

  for (const item of response.question_scores) {
    questionScores[item.question_id] = item.score;
    questionRationales[item.question_id] = item.rationale;
  }

  return {
    morning_briefing_id: record.morning_briefing_id,
    brief_date: record.brief_date,
    source_local_date: record.source_local_date,
    timezone: record.timezone,
    user_id: record.user_id,
    candidate_model: record.candidate_model,
    candidate_prompt_version: record.candidate_prompt_version,
    bundle_version: record.bundle_version,
    state_version: record.state_version,
    judge_model: judgeModel,
    judge_prompt_version: JUDGE_PROMPT_VERSION,
    rubric_id: rubric.rubric_id,
    rubric_version: rubric.rubric_version,
    overall_score: response.overall_score,
    overall_rationale: response.overall_rationale,
    judged_at: new Date().toISOString(),
    question_scores: questionScores,
    question_rationales: questionRationales,
  };
}

function escapeCsv(value: unknown): string {
  if (value == null) {
    return "";
  }
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCsv(
  filePath: string,
  rows: JudgeRunRow[],
  rubric: RubricDefinition
) {
  const headers = [
    "morning_briefing_id",
    "brief_date",
    "source_local_date",
    "timezone",
    "user_id",
    "candidate_model",
    "candidate_prompt_version",
    "bundle_version",
    "state_version",
    "judge_model",
    "judge_prompt_version",
    "rubric_id",
    "rubric_version",
    "overall_score",
    "overall_rationale",
    "judged_at",
    ...rubric.questions.flatMap((question) => [
      `${question.id}_score`,
      `${question.id}_rationale`,
    ]),
  ];

  const lines = [headers.join(",")];

  for (const row of rows) {
    const values = [
      row.morning_briefing_id,
      row.brief_date,
      row.source_local_date,
      row.timezone,
      row.user_id,
      row.candidate_model,
      row.candidate_prompt_version,
      row.bundle_version,
      row.state_version,
      row.judge_model,
      row.judge_prompt_version,
      row.rubric_id,
      row.rubric_version,
      row.overall_score,
      row.overall_rationale,
      row.judged_at,
      ...rubric.questions.flatMap((question) => [
        row.question_scores[question.id],
        row.question_rationales[question.id],
      ]),
    ];
    lines.push(values.map(escapeCsv).join(","));
  }

  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function writeManifest(filePath: string, manifest: Record<string, unknown>) {
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2));
}

async function main() {
  const { inputsDir, rubricPath, judgeModels } = parseArgs(process.argv.slice(2));
  const rubric = loadRubric(rubricPath);
  const records = loadJudgeInputs(inputsDir);

  if (records.length === 0) {
    throw new Error(`No judge-input JSON files found in ${inputsDir}`);
  }

  const runId = makeRunId(`judging__${records[0].user_id}__${records[0].brief_date}__${records.at(-1)?.brief_date}`);
  const runDir = path.join(JUDGING_RUNS_DIR, runId);
  const rawDir = path.join(runDir, "raw");
  const csvDir = path.join(runDir, "csv");
  ensureDir(rawDir);
  ensureDir(csvDir);
  const manifestPath = path.join(runDir, "manifest.json");

  const manifest: Record<string, unknown> = {
    run_id: runId,
    created_at: new Date().toISOString(),
    inputs_dir: inputsDir,
    rubric_path: rubricPath,
    rubric_id: rubric.rubric_id,
    rubric_version: rubric.rubric_version,
    judge_prompt_version: JUDGE_PROMPT_VERSION,
    judge_models: judgeModels,
    example_count: records.length,
    results: [],
  };
  writeManifest(manifestPath, manifest);

  for (const judgeModel of judgeModels) {
    console.log(`[coach-evals:judge] start judge_model=${judgeModel}`);

    const rows: JudgeRunRow[] = [];
    const rawPath = path.join(rawDir, `${sanitizeFileToken(judgeModel)}.jsonl`);
    const csvPath = path.join(csvDir, `${sanitizeFileToken(judgeModel)}.csv`);
    const modelResult = {
      judge_model: judgeModel,
      raw_path: rawPath,
      csv_path: csvPath,
      rows_written: 0,
      error_count: 0,
      errors: [] as Array<Record<string, unknown>>,
    };
    (manifest.results as Array<typeof modelResult>).push(modelResult);
    writeCsv(csvPath, rows, rubric);
    writeManifest(manifestPath, manifest);

    for (const record of records) {
      console.log(
        `[coach-evals:judge] model=${judgeModel} brief_date=${record.brief_date} plan_id=${record.morning_briefing_id}`
      );

      try {
        const { parsed, rawText, attemptsUsed } = await callJudgeModelWithRetry(
          judgeModel,
          rubric,
          record
        );
        const row = buildRow(record, judgeModel, rubric, parsed);
        rows.push(row);

        fs.appendFileSync(
          rawPath,
          `${JSON.stringify({
            morning_briefing_id: record.morning_briefing_id,
            brief_date: record.brief_date,
            judge_model: judgeModel,
            judge_prompt_version: JUDGE_PROMPT_VERSION,
            rubric_id: rubric.rubric_id,
            rubric_version: rubric.rubric_version,
            raw_response: rawText,
            parsed_response: parsed,
            judged_at: row.judged_at,
            attempts_used: attemptsUsed,
          })}\n`
        );
        modelResult.rows_written = rows.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        modelResult.error_count += 1;
        modelResult.errors.push({
          morning_briefing_id: record.morning_briefing_id,
          brief_date: record.brief_date,
          error: message,
        });
        fs.appendFileSync(
          rawPath,
          `${JSON.stringify({
            morning_briefing_id: record.morning_briefing_id,
            brief_date: record.brief_date,
            judge_model: judgeModel,
            judge_prompt_version: JUDGE_PROMPT_VERSION,
            rubric_id: rubric.rubric_id,
            rubric_version: rubric.rubric_version,
            error: message,
            judged_at: new Date().toISOString(),
          })}\n`
        );
        console.error(
          `[coach-evals:judge] skipped model=${judgeModel} brief_date=${record.brief_date} error=${message}`
        );
      }

      writeCsv(csvPath, rows, rubric);
      writeManifest(manifestPath, manifest);
    }
  }

  writeManifest(manifestPath, manifest);
  console.log(`[coach-evals:judge] manifest=${manifestPath}`);
}

void main();

import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatLocalDate, getCanonicalTimeZone, type LocalDateString } from "@/lib/time";

const JOURNAL_PROMPT_PATH = path.join(process.cwd(), "python", "prompts_journal.py");
const PROMPT_REGEX =
  /JOURNAL_SUMMARY2_SYSTEM_PROMPT\s*=\s*"""([\s\S]*?)"""/;

const DEFAULT_JOURNAL_SUMMARY2_MODEL =
  process.env.JOURNAL_SUMMARY2_MODEL || "anthropic/claude-3.5-haiku";
const JOURNAL_SUMMARY2_VERSION = "journal_summary_v1";
const SKIP_JOURNAL_SUMMARY2 =
  process.env.SKIP_JOURNAL_SUMMARY2?.toLowerCase() === "true";

type JournalMessageRow = {
  id: string;
  mode: "free" | "guided" | null;
  role: "user" | "assistant";
  content: string;
  local_date: string | null;
  created_at: string;
};

type JournalSummary2Row = {
  user_id: string;
  date: string;
  themes: string[];
  episodic_events: string[];
  stressor_types: string[];
  coping_actions: string[];
  barriers: string[];
  tone_hint: string | null;
  risk_flags: string[];
  self_appraisal_style: string | null;
  self_efficacy_language: string | null;
  goals_conflict_today: string | null;
  evidence_quotes: string[];
  extractor_version: string;
  extractor_confidence: number;
  created_at: string;
};

type JournalSummary2Draft = Omit<
  JournalSummary2Row,
  "user_id" | "date" | "created_at"
>;

export type EnsureJournalSummary2Params = {
  userId: string;
  localDate: LocalDateString;
  timezone?: string;
  supabaseAdmin?: SupabaseClient;
};

export type EnsureJournalSummary2Result =
  | {
      status: "existing";
      localDate: LocalDateString;
      timezone: string;
      messageCount: number;
      row: JournalSummary2Row;
    }
  | {
      status: "missing_journal";
      localDate: LocalDateString;
      timezone: string;
      messageCount: 0;
      row: null;
    }
  | {
      status: "skipped";
      localDate: LocalDateString;
      timezone: string;
      messageCount: number;
      row: JournalSummary2Row;
    }
  | {
      status: "created";
      localDate: LocalDateString;
      timezone: string;
      messageCount: number;
      row: JournalSummary2Row;
    };

type JournalExtractorResponse = {
  themes?: unknown;
  episodic_events?: unknown;
  stressor_types?: unknown;
  coping_actions?: unknown;
  barriers?: unknown;
  tone_hint?: unknown;
  risk_flags?: unknown;
  self_appraisal_style?: unknown;
  self_efficacy_language?: unknown;
  goals_conflict_today?: unknown;
  evidence_quotes?: unknown;
  extractor_confidence?: unknown;
};

function buildThreeDayUtcWindow(localDate: LocalDateString) {
  const baseUtc = new Date(`${localDate}T00:00:00.000Z`);
  const start = new Date(baseUtc);
  start.setUTCDate(start.getUTCDate() - 1);

  const end = new Date(baseUtc);
  end.setUTCDate(end.getUTCDate() + 2);

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function parseJsonResponse(raw: string): JournalExtractorResponse {
  const trimmed = raw.trim();
  const withoutCodeFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(withoutCodeFence) as JournalExtractorResponse;
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function normalizeScalarText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function truncateWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(" ");
}

function normalizeList(value: unknown, maxItems: number, maxWords?: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const cleaned: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    let normalized = item.trim();
    if (!normalized) continue;
    if (maxWords) {
      normalized = truncateWords(normalized, maxWords);
    }
    if (!normalized) continue;
    cleaned.push(normalized);
    if (cleaned.length >= maxItems) break;
  }

  return cleaned;
}

function buildSkippedSummaryDraft(): JournalSummary2Draft {
  return {
    themes: [],
    episodic_events: [],
    stressor_types: [],
    coping_actions: [],
    barriers: [],
    tone_hint: null,
    risk_flags: [],
    self_appraisal_style: null,
    self_efficacy_language: null,
    goals_conflict_today: null,
    evidence_quotes: [],
    extractor_version: `${JOURNAL_SUMMARY2_VERSION}_skipped`,
    extractor_confidence: 0,
  };
}

function sanitizeJournalSummaryDraft(
  parsed: JournalExtractorResponse
): JournalSummary2Draft {
  return {
    themes: normalizeList(parsed.themes, 3),
    episodic_events: normalizeList(parsed.episodic_events, 3),
    stressor_types: normalizeList(parsed.stressor_types, 3),
    coping_actions: normalizeList(parsed.coping_actions, 3),
    barriers: normalizeList(parsed.barriers, 3),
    tone_hint: normalizeScalarText(parsed.tone_hint),
    risk_flags: normalizeList(parsed.risk_flags, 2),
    self_appraisal_style: normalizeScalarText(parsed.self_appraisal_style),
    self_efficacy_language: normalizeScalarText(parsed.self_efficacy_language),
    goals_conflict_today: normalizeScalarText(parsed.goals_conflict_today),
    evidence_quotes: normalizeList(parsed.evidence_quotes, 2, 20),
    extractor_version: JOURNAL_SUMMARY2_VERSION,
    extractor_confidence: clampConfidence(parsed.extractor_confidence),
  };
}

async function loadJournalPrompt(): Promise<string> {
  const promptFile = await fs.readFile(JOURNAL_PROMPT_PATH, "utf8");
  const match = PROMPT_REGEX.exec(promptFile);
  if (!match?.[1]) {
    throw new Error(`Could not load JOURNAL_SUMMARY2_SYSTEM_PROMPT from ${JOURNAL_PROMPT_PATH}`);
  }
  return match[1];
}

function getOpenRouterClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY for journal_summary2 extraction");
  }

  return new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer":
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.NEXTAUTH_URL ||
        "http://localhost:3000",
      "X-Title": "RYTM Journal Summary 2",
    },
  });
}

async function getExistingJournalSummary2(
  supabaseAdmin: SupabaseClient,
  userId: string,
  localDate: LocalDateString
): Promise<JournalSummary2Row | null> {
  const { data, error } = await supabaseAdmin
    .from("journal_summary2")
    .select("*")
    .eq("user_id", userId)
    .eq("date", localDate)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read journal_summary2: ${error.message}`);
  }

  return (data as JournalSummary2Row | null) ?? null;
}

async function getUserJournalMessagesForLocalDate(
  supabaseAdmin: SupabaseClient,
  userId: string,
  localDate: LocalDateString,
  timezone: string
): Promise<JournalMessageRow[]> {
  const { startIso, endIso } = buildThreeDayUtcWindow(localDate);

  const { data, error } = await supabaseAdmin
    .from("journal_messages")
    .select("id, mode, role, content, local_date, created_at")
    .eq("user_id", userId)
    .eq("role", "user")
    .gte("created_at", startIso)
    .lt("created_at", endIso)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to read journal_messages for journal_summary2: ${error.message}`);
  }

  return (data as JournalMessageRow[] | null ?? []).filter((message) => {
    if (message.local_date) {
      return message.local_date === localDate;
    }

    return formatLocalDate(new Date(message.created_at), timezone) === localDate;
  });
}

function buildJournalExtractionUserPrompt(
  localDate: LocalDateString,
  timezone: string,
  messages: JournalMessageRow[]
): string {
  const renderedMessages = messages
    .map((message, index) => {
      return [
        `Message ${index + 1}`,
        `mode: ${message.mode ?? "unknown"}`,
        `created_at: ${message.created_at}`,
        `content: ${message.content.trim()}`,
      ].join("\n");
    })
    .join("\n\n");

  return [
    `Extract a structured daily journal summary for local date ${localDate} in timezone ${timezone}.`,
    "Use only the user's words in the messages below.",
    "If evidence is weak, prefer fewer items and null scalar fields.",
    "",
    renderedMessages,
  ].join("\n");
}

async function extractJournalSummaryDraft(
  localDate: LocalDateString,
  timezone: string,
  messages: JournalMessageRow[]
): Promise<JournalSummary2Draft> {
  const systemPrompt = await loadJournalPrompt();
  const client = getOpenRouterClient();
  const userPrompt = buildJournalExtractionUserPrompt(localDate, timezone, messages);

  const response = await client.chat.completions.create({
    model: DEFAULT_JOURNAL_SUMMARY2_MODEL,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("journal_summary2 extractor returned no content");
  }

  const parsed = parseJsonResponse(content);
  return sanitizeJournalSummaryDraft(parsed);
}

async function upsertJournalSummary2(
  supabaseAdmin: SupabaseClient,
  userId: string,
  localDate: LocalDateString,
  draft: JournalSummary2Draft
): Promise<JournalSummary2Row> {
  const payload = {
    user_id: userId,
    date: localDate,
    ...draft,
  };

  const { data, error } = await supabaseAdmin
    .from("journal_summary2")
    .upsert(payload, { onConflict: "user_id,date" })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to upsert journal_summary2: ${error.message}`);
  }

  return data as JournalSummary2Row;
}

export async function ensure_journal_summary2(
  userId: string,
  localDate: LocalDateString,
  timezone?: string,
  supabaseAdmin?: SupabaseClient
): Promise<EnsureJournalSummary2Result> {
  const admin = supabaseAdmin ?? createSupabaseAdminClient();
  const resolvedTimezone =
    timezone || (await getCanonicalTimeZone(admin, userId));

  const existing = await getExistingJournalSummary2(admin, userId, localDate);
  if (existing) {
    const existingMessages = await getUserJournalMessagesForLocalDate(
      admin,
      userId,
      localDate,
      resolvedTimezone
    );

    return {
      status: "existing",
      localDate,
      timezone: resolvedTimezone,
      messageCount: existingMessages.length,
      row: existing,
    };
  }

  const messages = await getUserJournalMessagesForLocalDate(
    admin,
    userId,
    localDate,
    resolvedTimezone
  );

  if (messages.length === 0) {
    return {
      status: "missing_journal",
      localDate,
      timezone: resolvedTimezone,
      messageCount: 0,
      row: null,
    };
  }

  if (SKIP_JOURNAL_SUMMARY2) {
    const row = await upsertJournalSummary2(
      admin,
      userId,
      localDate,
      buildSkippedSummaryDraft()
    );

    return {
      status: "skipped",
      localDate,
      timezone: resolvedTimezone,
      messageCount: messages.length,
      row,
    };
  }

  const draft = await extractJournalSummaryDraft(
    localDate,
    resolvedTimezone,
    messages
  );
  const row = await upsertJournalSummary2(admin, userId, localDate, draft);

  return {
    status: "created",
    localDate,
    timezone: resolvedTimezone,
    messageCount: messages.length,
    row,
  };
}

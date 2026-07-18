import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatLocalDate, getCanonicalTimeZone, type LocalDateString } from "@/lib/time";
import { withSupabaseRetry } from "./supabaseRetry";

const JOURNAL_PROMPT_PATH = path.join(process.cwd(), "python/coach", "prompts.py");
const PROMPT_REGEX =
  /JOURNAL_SUMMARY2_SYSTEM_PROMPT\s*=\s*"""([\s\S]*?)"""/;

const DEFAULT_OPENAI_JOURNAL_MODEL = "gpt-4o-mini";
const DEFAULT_OPENROUTER_JOURNAL_MODEL = "anthropic/claude-3.5-haiku";
const JOURNAL_SUMMARY2_VERSION = "journal_summary_v2";
const JOURNAL_CONTEXT_VERSION = "journal_context_v1";
const SKIP_JOURNAL_SUMMARY2 =
  process.env.SKIP_JOURNAL_SUMMARY2?.toLowerCase() === "true";

type JournalLlmProvider = "openai" | "openrouter";

type JournalLlmConfig = {
  provider: JournalLlmProvider;
  model: string;
  client: OpenAI;
};

type JournalMessageRow = {
  id: string;
  mode: "free" | "guided" | null;
  role: "user" | "assistant";
  content: string;
  local_date: string | null;
  created_at: string;
};

type JournalCommitment = {
  description: string;
  timeframe: "past" | "today" | "upcoming" | "ongoing";
  when_text: string | null;
  status: "mentioned" | "planned" | "done" | "missed" | "cancelled";
  confidence: number;
  evidence_message_ids: string[];
};

type JournalRecurringTopic = {
  topic: string;
  note: string | null;
  confidence: number;
  evidence_message_ids: string[];
};

type JournalSummary2Row = {
  user_id: string;
  date: string;
  narrative_summary: string | null;
  themes: string[];
  topics: string[];
  episodic_events: Array<{
    event_type: string;
    status: "started" | "ongoing" | "resolved";
    time_horizon: "today" | "this_week" | "ongoing";
    confidence: number;
    evidence_message_ids: string[];
  }>;
  commitments: JournalCommitment[];
  recurring_topics: JournalRecurringTopic[];
  stressor_types: Array<{
    type:
      | "academic"
      | "social"
      | "health"
      | "family"
      | "financial"
      | "time_pressure"
      | "uncertainty"
      | "other";
    confidence: number;
    controllability: "low" | "med" | "high";
    evidence_message_ids: string[];
  }>;
  coping_actions: Array<{
    action: string;
    effectiveness: "helped" | "didnt_help" | "unsure";
    evidence_message_ids: string[];
  }>;
  barriers: string[];
  tone_hint: "supportive" | "neutral" | "encouraging" | null;
  risk_flags: string[];
  self_appraisal_style: "catastrophizing" | "balanced" | "optimistic" | null;
  self_efficacy_language: "low" | "med" | "high" | null;
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
  narrative_summary?: unknown;
  themes?: unknown;
  topics?: unknown;
  episodic_events?: unknown;
  commitments?: unknown;
  recurring_topics?: unknown;
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

type JournalEpisodicEvent = JournalSummary2Row["episodic_events"][number];
type JournalStressorType = JournalSummary2Row["stressor_types"][number];
type JournalCopingAction = JournalSummary2Row["coping_actions"][number];

type UserJournalContextRow = {
  user_id: string;
  as_of_date: string;
  narrative_arc: string;
  open_commitments: JournalCommitment[];
  recurring_topics: JournalRecurringTopic[];
  recent_day_summaries: Array<{
    date: string;
    narrative_summary: string | null;
    topics: string[];
  }>;
  context_version: string;
  updated_at: string;
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

function normalizeMessageIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  const match = allowed.find((candidate) => candidate === normalized);
  return match ?? fallback;
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
    narrative_summary: null,
    themes: [],
    topics: [],
    episodic_events: [],
    commitments: [],
    recurring_topics: [],
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

function normalizeEpisodicEvents(value: unknown): JournalEpisodicEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const events: JournalEpisodicEvent[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;

    const eventType = normalizeScalarText(item.event_type);
    if (!eventType) continue;

    events.push({
      event_type: eventType,
      status: normalizeEnum(item.status, ["started", "ongoing", "resolved"] as const, "ongoing"),
      time_horizon: normalizeEnum(
        item.time_horizon,
        ["today", "this_week", "ongoing"] as const,
        "ongoing"
      ),
      confidence: clampConfidence(item.confidence),
      evidence_message_ids: normalizeMessageIdList(item.evidence_message_ids),
    });

    if (events.length >= 3) break;
  }

  return events;
}

function normalizeStressorTypes(value: unknown): JournalStressorType[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const stressors: JournalStressorType[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;

    stressors.push({
      type: normalizeEnum(
        item.type,
        [
          "academic",
          "social",
          "health",
          "family",
          "financial",
          "time_pressure",
          "uncertainty",
          "other",
        ] as const,
        "other"
      ),
      confidence: clampConfidence(item.confidence),
      controllability: normalizeEnum(
        item.controllability,
        ["low", "med", "high"] as const,
        "med"
      ),
      evidence_message_ids: normalizeMessageIdList(item.evidence_message_ids),
    });

    if (stressors.length >= 3) break;
  }

  return stressors;
}

function normalizeCommitments(value: unknown): JournalCommitment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const commitments: JournalCommitment[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const description = normalizeScalarText(item.description);
    if (!description) continue;

    commitments.push({
      description: truncateWords(description, 24),
      timeframe: normalizeEnum(
        item.timeframe,
        ["past", "today", "upcoming", "ongoing"] as const,
        "upcoming"
      ),
      when_text: (() => {
        const whenText = normalizeScalarText(item.when_text);
        return whenText ? truncateWords(whenText, 12) : null;
      })(),
      status: normalizeEnum(
        item.status,
        ["mentioned", "planned", "done", "missed", "cancelled"] as const,
        "mentioned"
      ),
      confidence: clampConfidence(item.confidence),
      evidence_message_ids: normalizeMessageIdList(item.evidence_message_ids),
    });

    if (commitments.length >= 6) break;
  }

  return commitments;
}

function normalizeRecurringTopics(value: unknown): JournalRecurringTopic[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const topics: JournalRecurringTopic[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const topic = normalizeScalarText(item.topic);
    if (!topic) continue;

    topics.push({
      topic: truncateWords(topic, 8),
      note: normalizeScalarText(item.note),
      confidence: clampConfidence(item.confidence),
      evidence_message_ids: normalizeMessageIdList(item.evidence_message_ids),
    });

    if (topics.length >= 5) break;
  }

  return topics;
}

function normalizeCopingActions(value: unknown): JournalCopingAction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const actions: JournalCopingAction[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;

    const action = normalizeScalarText(item.action);
    if (!action) continue;

    actions.push({
      action,
      effectiveness: normalizeEnum(
        item.effectiveness,
        ["helped", "didnt_help", "unsure"] as const,
        "unsure"
      ),
      evidence_message_ids: normalizeMessageIdList(item.evidence_message_ids),
    });

    if (actions.length >= 3) break;
  }

  return actions;
}

function sanitizeJournalSummaryDraft(
  parsed: JournalExtractorResponse
): JournalSummary2Draft {
  const narrative = normalizeScalarText(parsed.narrative_summary);
  return {
    narrative_summary: narrative ? truncateWords(narrative, 90) : null,
    themes: normalizeList(parsed.themes, 3),
    topics: normalizeList(parsed.topics, 8, 6),
    episodic_events: normalizeEpisodicEvents(parsed.episodic_events),
    commitments: normalizeCommitments(parsed.commitments),
    recurring_topics: normalizeRecurringTopics(parsed.recurring_topics),
    stressor_types: normalizeStressorTypes(parsed.stressor_types),
    coping_actions: normalizeCopingActions(parsed.coping_actions),
    barriers: normalizeList(parsed.barriers, 3),
    tone_hint:
      parsed.tone_hint == null
        ? null
        : normalizeEnum(
            parsed.tone_hint,
            ["supportive", "neutral", "encouraging"] as const,
            "neutral"
          ),
    risk_flags: normalizeList(parsed.risk_flags, 2),
    self_appraisal_style:
      parsed.self_appraisal_style == null
        ? null
        : normalizeEnum(
            parsed.self_appraisal_style,
            ["catastrophizing", "balanced", "optimistic"] as const,
            "balanced"
          ),
    self_efficacy_language:
      parsed.self_efficacy_language == null
        ? null
        : normalizeEnum(
            parsed.self_efficacy_language,
            ["low", "med", "high"] as const,
            "med"
          ),
    goals_conflict_today: normalizeScalarText(parsed.goals_conflict_today),
    evidence_quotes: normalizeList(parsed.evidence_quotes, 2, 20),
    extractor_version: JOURNAL_SUMMARY2_VERSION,
    extractor_confidence: clampConfidence(parsed.extractor_confidence),
  };
}

function commitmentKey(commitment: Pick<JournalCommitment, "description">): string {
  return commitment.description.trim().toLowerCase().replace(/\s+/g, " ");
}

function topicKey(topic: Pick<JournalRecurringTopic, "topic">): string {
  return topic.topic.trim().toLowerCase().replace(/\s+/g, " ");
}

function isOpenCommitment(commitment: JournalCommitment): boolean {
  if (
    commitment.status === "done" ||
    commitment.status === "cancelled" ||
    commitment.status === "missed"
  ) {
    return false;
  }
  return (
    commitment.timeframe === "today" ||
    commitment.timeframe === "upcoming" ||
    commitment.timeframe === "ongoing"
  );
}

function mergeOpenCommitments(
  previous: JournalCommitment[],
  todays: JournalCommitment[]
): JournalCommitment[] {
  const byKey = new Map<string, JournalCommitment>();

  for (const item of previous) {
    if (isOpenCommitment(item)) {
      byKey.set(commitmentKey(item), item);
    }
  }

  for (const item of todays) {
    const key = commitmentKey(item);
    if (
      item.status === "done" ||
      item.status === "cancelled" ||
      item.status === "missed"
    ) {
      byKey.delete(key);
      continue;
    }
    if (isOpenCommitment(item)) {
      byKey.set(key, item);
    }
  }

  return Array.from(byKey.values()).slice(0, 10);
}

function mergeRecurringTopics(
  previous: JournalRecurringTopic[],
  todays: JournalRecurringTopic[]
): JournalRecurringTopic[] {
  const byKey = new Map<string, JournalRecurringTopic>();

  for (const item of previous) {
    byKey.set(topicKey(item), item);
  }

  for (const item of todays) {
    const key = topicKey(item);
    const existing = byKey.get(key);
    if (!existing || item.confidence >= existing.confidence) {
      byKey.set(key, item);
    }
  }

  return Array.from(byKey.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);
}

function buildNarrativeArc(
  recentDaySummaries: UserJournalContextRow["recent_day_summaries"]
): string {
  const parts = recentDaySummaries
    .filter((entry) => Boolean(entry.narrative_summary))
    .slice(-5)
    .map((entry) => `${entry.date}: ${entry.narrative_summary}`);

  const joined = parts.join(" ").trim();
  if (!joined) {
    return "";
  }
  return truncateWords(joined, 160);
}

function coerceJournalSummary2Row(data: unknown): JournalSummary2Row | null {
  if (!isRecord(data)) {
    return null;
  }

  const userId = normalizeScalarText(data.user_id);
  const date = normalizeScalarText(data.date);
  if (!userId || !date) {
    return null;
  }

  return {
    user_id: userId,
    date,
    narrative_summary: normalizeScalarText(data.narrative_summary),
    themes: normalizeList(data.themes, 3),
    topics: normalizeList(data.topics, 8, 6),
    episodic_events: normalizeEpisodicEvents(data.episodic_events),
    commitments: normalizeCommitments(data.commitments),
    recurring_topics: normalizeRecurringTopics(data.recurring_topics),
    stressor_types: normalizeStressorTypes(data.stressor_types),
    coping_actions: normalizeCopingActions(data.coping_actions),
    barriers: normalizeList(data.barriers, 3),
    tone_hint:
      data.tone_hint == null
        ? null
        : normalizeEnum(
            data.tone_hint,
            ["supportive", "neutral", "encouraging"] as const,
            "neutral"
          ),
    risk_flags: normalizeList(data.risk_flags, 2),
    self_appraisal_style:
      data.self_appraisal_style == null
        ? null
        : normalizeEnum(
            data.self_appraisal_style,
            ["catastrophizing", "balanced", "optimistic"] as const,
            "balanced"
          ),
    self_efficacy_language:
      data.self_efficacy_language == null
        ? null
        : normalizeEnum(
            data.self_efficacy_language,
            ["low", "med", "high"] as const,
            "med"
          ),
    goals_conflict_today: normalizeScalarText(data.goals_conflict_today),
    evidence_quotes: normalizeList(data.evidence_quotes, 2, 20),
    extractor_version:
      normalizeScalarText(data.extractor_version) ?? JOURNAL_SUMMARY2_VERSION,
    extractor_confidence: clampConfidence(data.extractor_confidence),
    created_at:
      normalizeScalarText(data.created_at) ?? new Date().toISOString(),
  };
}

function isCurrentExtractorVersion(version: string): boolean {
  return (
    version === JOURNAL_SUMMARY2_VERSION ||
    version === `${JOURNAL_SUMMARY2_VERSION}_skipped` ||
    version.startsWith("journal_summary_v2")
  );
}

async function loadJournalPrompt(): Promise<string> {
  const promptFile = await fs.readFile(JOURNAL_PROMPT_PATH, "utf8");
  const match = PROMPT_REGEX.exec(promptFile);
  if (!match?.[1]) {
    throw new Error(`Could not load JOURNAL_SUMMARY2_SYSTEM_PROMPT from ${JOURNAL_PROMPT_PATH}`);
  }
  return match[1];
}

function resolveJournalSummaryProvider(): JournalLlmProvider {
  const raw = (process.env.JOURNAL_SUMMARY_LLM_PROVIDER || "").trim().toLowerCase();
  if (raw === "openai" || raw === "openrouter") {
    return raw;
  }
  if (raw) {
    throw new Error(
      `Invalid JOURNAL_SUMMARY_LLM_PROVIDER=${raw}. Expected 'openai' or 'openrouter'.`
    );
  }

  // Auto-select: prefer OpenRouter when configured (legacy default), else OpenAI.
  if (process.env.OPENROUTER_API_KEY) {
    return "openrouter";
  }
  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }
  throw new Error(
    "Missing credentials for journal_summary2 extraction. Set JOURNAL_SUMMARY_LLM_PROVIDER and the matching API key (OPENAI_API_KEY or OPENROUTER_API_KEY)."
  );
}

function getJournalSummaryLlmConfig(): JournalLlmConfig {
  const provider = resolveJournalSummaryProvider();
  const modelOverride = process.env.JOURNAL_SUMMARY2_MODEL?.trim();

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Missing OPENAI_API_KEY for journal_summary2 extraction (JOURNAL_SUMMARY_LLM_PROVIDER=openai)"
      );
    }
    return {
      provider,
      model: modelOverride || DEFAULT_OPENAI_JOURNAL_MODEL,
      client: new OpenAI({ apiKey }),
    };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing OPENROUTER_API_KEY for journal_summary2 extraction (JOURNAL_SUMMARY_LLM_PROVIDER=openrouter)"
    );
  }

  return {
    provider,
    model: modelOverride || DEFAULT_OPENROUTER_JOURNAL_MODEL,
    client: new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer":
          process.env.NEXT_PUBLIC_APP_URL ||
          process.env.NEXTAUTH_URL ||
          "http://localhost:3000",
        "X-Title": "RYTM Journal Summary 2",
      },
    }),
  };
}

async function getExistingJournalSummary2(
  supabaseAdmin: SupabaseClient,
  userId: string,
  localDate: LocalDateString
): Promise<JournalSummary2Row | null> {
  const { data, error } = await withSupabaseRetry(
    "read journal_summary2",
    () =>
      supabaseAdmin
        .from("journal_summary2")
        .select("*")
        .eq("user_id", userId)
        .eq("date", localDate)
        .maybeSingle()
  );

  if (error) {
    throw new Error(`Failed to read journal_summary2: ${error.message}`);
  }

  return coerceJournalSummary2Row(data);
}

async function getUserJournalContext(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<UserJournalContextRow | null> {
  const { data, error } = await withSupabaseRetry(
    "read user_journal_context2",
    () =>
      supabaseAdmin
        .from("user_journal_context2")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle()
  );

  if (error) {
    // Schema may not be applied yet; log and continue without rolling context.
    console.error("Failed to read user_journal_context2", {
      userId,
      error,
    });
    return null;
  }

  if (!data || !isRecord(data)) {
    return null;
  }

  return {
    user_id: userId,
    as_of_date: normalizeScalarText(data.as_of_date) ?? "",
    narrative_arc: normalizeScalarText(data.narrative_arc) ?? "",
    open_commitments: normalizeCommitments(data.open_commitments),
    recurring_topics: normalizeRecurringTopics(data.recurring_topics),
    recent_day_summaries: Array.isArray(data.recent_day_summaries)
      ? data.recent_day_summaries
          .filter(isRecord)
          .map((entry) => ({
            date: normalizeScalarText(entry.date) ?? "",
            narrative_summary: normalizeScalarText(entry.narrative_summary),
            topics: normalizeList(entry.topics, 8, 6),
          }))
          .filter((entry) => Boolean(entry.date))
      : [],
    context_version:
      normalizeScalarText(data.context_version) ?? JOURNAL_CONTEXT_VERSION,
    updated_at:
      normalizeScalarText(data.updated_at) ?? new Date().toISOString(),
  };
}

async function upsertUserJournalContext(
  supabaseAdmin: SupabaseClient,
  userId: string,
  localDate: LocalDateString,
  summary: JournalSummary2Row
): Promise<void> {
  const existing = await getUserJournalContext(supabaseAdmin, userId);

  const recentByDate = new Map<
    string,
    UserJournalContextRow["recent_day_summaries"][number]
  >();
  for (const entry of existing?.recent_day_summaries ?? []) {
    recentByDate.set(entry.date, entry);
  }
  recentByDate.set(localDate, {
    date: localDate,
    narrative_summary: summary.narrative_summary,
    topics: summary.topics,
  });

  const recentDaySummaries = Array.from(recentByDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14);

  const payload = {
    user_id: userId,
    as_of_date: localDate,
    narrative_arc: buildNarrativeArc(recentDaySummaries),
    open_commitments: mergeOpenCommitments(
      existing?.open_commitments ?? [],
      summary.commitments
    ),
    recurring_topics: mergeRecurringTopics(
      existing?.recurring_topics ?? [],
      summary.recurring_topics
    ),
    recent_day_summaries: recentDaySummaries,
    context_version: JOURNAL_CONTEXT_VERSION,
    updated_at: new Date().toISOString(),
  };

  const { error } = await withSupabaseRetry(
    "upsert user_journal_context2",
    () =>
      supabaseAdmin
        .from("user_journal_context2")
        .upsert(payload, { onConflict: "user_id" })
  );

  if (error) {
    console.error("Failed to upsert user_journal_context2", {
      userId,
      localDate,
      error,
    });
    // Do not fail morning prep if rolling context write fails (e.g. schema not applied).
  }
}

async function getUserJournalMessagesForLocalDate(
  supabaseAdmin: SupabaseClient,
  userId: string,
  localDate: LocalDateString,
  timezone: string
): Promise<JournalMessageRow[]> {
  const { startIso, endIso } = buildThreeDayUtcWindow(localDate);

  const { data, error } = await withSupabaseRetry(
    "read journal_messages for journal_summary2",
    () =>
      supabaseAdmin
        .from("journal_messages")
        .select("id, mode, role, content, local_date, created_at")
        .eq("user_id", userId)
        .eq("role", "user")
        .gte("created_at", startIso)
        .lt("created_at", endIso)
        .order("created_at", { ascending: true })
  );

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
  const { client, model, provider } = getJournalSummaryLlmConfig();
  const userPrompt = buildJournalExtractionUserPrompt(localDate, timezone, messages);

  try {
    const response = await client.chat.completions.create({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error("journal_summary2 extractor returned empty content", {
        localDate,
        timezone,
        provider,
        model,
        messageCount: messages.length,
      });
      throw new Error("journal_summary2 extractor returned no content");
    }

    const parsed = parseJsonResponse(content);
    return sanitizeJournalSummaryDraft(parsed);
  } catch (error) {
    console.error("journal_summary2 extraction failed", {
      localDate,
      timezone,
      provider,
      model,
      messageCount: messages.length,
      error,
    });
    throw error;
  }
}

async function upsertJournalSummary2(
  supabaseAdmin: SupabaseClient,
  userId: string,
  localDate: LocalDateString,
  draft: JournalSummary2Draft
): Promise<JournalSummary2Row> {
  console.error("journal_summary2 upsert payload", {
    userId,
    localDate,
    draft,
  });

  const payload = {
    user_id: userId,
    date: localDate,
    ...draft,
  };

  const { data, error } = await withSupabaseRetry(
    "upsert journal_summary2",
    () =>
      supabaseAdmin
        .from("journal_summary2")
        .upsert(payload, { onConflict: "user_id,date" })
        .select("*")
        .single()
  );

  if (error) {
    console.error("journal_summary2 upsert failed", {
      userId,
      localDate,
      payload,
      error,
    });
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
    await upsertUserJournalContext(admin, userId, localDate, row);

    return {
      status: "skipped",
      localDate,
      timezone: resolvedTimezone,
      messageCount: messages.length,
      row,
    };
  }

  const existing = await getExistingJournalSummary2(admin, userId, localDate);
  if (existing && isCurrentExtractorVersion(existing.extractor_version)) {
    const context = await getUserJournalContext(admin, userId);
    if (!context || context.as_of_date < localDate) {
      await upsertUserJournalContext(admin, userId, localDate, existing);
    }

    return {
      status: "existing",
      localDate,
      timezone: resolvedTimezone,
      messageCount: messages.length,
      row: existing,
    };
  }

  const draft = await extractJournalSummaryDraft(
    localDate,
    resolvedTimezone,
    messages
  );
  const row = await upsertJournalSummary2(admin, userId, localDate, draft);
  await upsertUserJournalContext(admin, userId, localDate, row);

  return {
    status: "created",
    localDate,
    timezone: resolvedTimezone,
    messageCount: messages.length,
    row,
  };
}

export async function ensureJournalSummary2(
  params: EnsureJournalSummary2Params
): Promise<EnsureJournalSummary2Result> {
  return ensure_journal_summary2(
    params.userId,
    params.localDate,
    params.timezone,
    params.supabaseAdmin
  );
}

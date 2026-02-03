import { createBrowserClient } from "@supabase/ssr";
import type { DailyOverall } from "@/types/dashboard";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ============================================================
   ADD: DailySummary row shape (matches public.daily_summary)
============================================================ */
type DailySummaryRow = {
  user_id: string;
  date: string; // YYYY-MM-DD
  timezone: string;
  has_overall: boolean;
  has_meal: boolean;
  has_water: boolean;
  has_journal: boolean;
  has_checkin: boolean;
  is_complete: boolean;
  streak_value: number;
  updated_at: string;
};

/* ============================================================
   ADD: Snapshot cache to achieve:
   - 1 RPC refresh (today)
   - 1 read query (last 7 days)
   Then all functions use the snapshot (no extra queries).
============================================================ */
type DashboardSnapshot = {
  tz: string;                 // canonical tz used
  todayLocal: string;         // YYYY-MM-DD in canonical tz
  todaySummary: DailySummaryRow;
  weeklyDates: string[];      // 7 dates, oldest->newest
  weeklyComplete: boolean[];  // aligned with weeklyDates
  streak: number;             // streak shown on dashboard (today if complete else yesterday)
};

const snapshotCache = new Map<string, { expiresAt: number; promise: Promise<DashboardSnapshot> }>();
const SNAPSHOT_TTL_MS = 15_000; // 15s is enough to dedupe load bursts

function cacheKey(userId: string) {
  return userId;
}

function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date); // YYYY-MM-DD
}

/* ============================================================
   ADD: Canonical timezone resolution (Option A)
   Priority:
   1) fitbit_profile.user_timezone
   2) profiles.timezone
   3) browser timezone (and we persist it into profiles via RPC ensure_profile_timezone)
============================================================ */
async function getCanonicalTimeZone(userId: string): Promise<string> {
  // 1) Fitbit timezone if present
  const { data: fitbit, error: fitbitErr } = await supabase
    .from("fitbit_profile")
    .select("user_timezone")
    .eq("app_user_id", userId)
    .maybeSingle();

  const fitbitTz = !fitbitErr && fitbit?.user_timezone ? fitbit.user_timezone : null;
  if (fitbitTz) return fitbitTz;

  // 2) profiles.timezone if present (skip if column doesn't exist)
  // Note: profiles table may not have timezone column in all environments
  try {
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("timezone")
      .eq("user_id", userId)
      .maybeSingle();

    const profileTz = !profileErr && profile?.timezone ? profile.timezone : null;
    if (profileTz) return profileTz;
  } catch {
    // profiles.timezone column may not exist, continue to fallback
  }

  // 3) fallback: browser timezone, persist to DB as canonical fallback
  const browserTz = getBrowserTimeZone();

  // store once via RPC (safe even if rerun; only sets if missing)
  await supabase.rpc("ensure_profile_timezone", {
    p_user_id: userId,
    p_timezone: browserTz,
  });

  return browserTz;
}

/* ============================================================
   ADD: Refresh daily summary via RPC for a specific local date
============================================================ */
async function refreshDailySummary(userId: string, localDate?: string): Promise<DailySummaryRow> {
  const { data, error } = await supabase.rpc("refresh_daily_summary", {
    p_user_id: userId,
    p_target_date: localDate ?? null,
  });

  if (error) {
    console.error("refresh_daily_summary failed:", error);
    // fail-safe: return a minimal row so UI doesn't crash
    return {
      user_id: userId,
      date: localDate ?? formatDateInTimeZone(new Date(), "UTC"),
      timezone: "UTC",
      has_overall: false,
      has_meal: false,
      has_water: false,
      has_journal: false,
      has_checkin: false,
      is_complete: false,
      streak_value: 0,
      updated_at: new Date().toISOString(),
    };
  }

  return data as DailySummaryRow;
}

/* ============================================================
   ADD: Fetch 7-day window from daily_summary (one query)
============================================================ */
async function fetchWeeklySummaries(userId: string, start: string, end: string) {
  const { data, error } = await supabase
    .from("daily_summary")
    .select("date,is_complete,streak_value,has_overall,has_meal,has_water,has_journal,has_checkin,timezone")
    .eq("user_id", userId)
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: true });

  if (error) {
    console.error("fetchWeeklySummaries failed:", error);
    return [] as Array<DailySummaryRow>;
  }
  return (data ?? []) as Array<DailySummaryRow>;
}

/* ============================================================
   ADD: Build snapshot (ONE RPC + ONE read)
============================================================ */
async function buildDashboardSnapshot(userId: string): Promise<DashboardSnapshot> {
  const tz = await getCanonicalTimeZone(userId);
  const now = new Date();
  const todayLocal = formatDateInTimeZone(now, tz);

  // 1) ONE RPC refresh for today
  const todaySummary = await refreshDailySummary(userId, todayLocal);

  // 2) ONE read for last 7 local dates (6 days ago -> today)
  const weeklyDates: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    weeklyDates.push(formatDateInTimeZone(d, tz));
  }
  const start = weeklyDates[0];
  const end = weeklyDates[weeklyDates.length - 1];

  const rows = await fetchWeeklySummaries(userId, start, end);
  const rowMap = new Map(rows.map((r) => [r.date, r]));

  const weeklyComplete = weeklyDates.map((d) => rowMap.get(d)?.is_complete ?? false);

  // Determine streak shown:
  // - if today complete -> today streak_value
  // - else -> yesterday streak_value if yesterday complete, else 0
  let streak = 0;
  if (todaySummary.is_complete) {
    streak = todaySummary.streak_value;
  } else {
    const yesterday = weeklyDates[weeklyDates.length - 2]; // second to last
    const yRow = rowMap.get(yesterday);
    streak = yRow?.is_complete ? (yRow.streak_value ?? 0) : 0;
  }

  return {
    tz,
    todayLocal,
    todaySummary,
    weeklyDates,
    weeklyComplete,
    streak,
  };
}

/* ============================================================
   ADD: Get snapshot with caching
============================================================ */
async function getSnapshot(userId: string): Promise<DashboardSnapshot> {
  const key = cacheKey(userId);
  const now = Date.now();
  const cached = snapshotCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = buildDashboardSnapshot(userId);
  snapshotCache.set(key, { expiresAt: now + SNAPSHOT_TTL_MS, promise });
  return promise;
}

function invalidateSnapshot(userId: string) {
  snapshotCache.delete(cacheKey(userId));
}

/* ============================================================
   EXPORTS (same function names; now backed by snapshot + daily_summary)
============================================================ */

/**
 * getTodayOverall:
 * - Still returns DailyOverall row (for compatibility)
 * - Uses canonical timezone date string to query daily_overall
 * - NOTE: dashboard can use snapshot.todaySummary.has_overall if it only needs boolean
 */
export async function getTodayOverall(userId: string, date?: Date): Promise<DailyOverall | null> {
  const tz = await getCanonicalTimeZone(userId);
  const target = date ?? new Date();
  const dateStr = formatDateInTimeZone(target, tz);

  const { data, error } = await supabase
    .from("daily_overall")
    .select("*")
    .eq("user_id", userId)
    .eq("date", dateStr)
    .maybeSingle();

  if (error) {
    console.error("Error fetching daily_overall:", error);
    return null;
  }

  return data ?? null;
}

export async function submitDailyOverall(userId: string, score: number, date?: Date): Promise<boolean> {
  const tz = await getCanonicalTimeZone(userId);
  const target = date ?? new Date();
  const localDate = formatDateInTimeZone(target, tz);

  const { error } = await supabase
    .from("daily_overall")
    .insert({ user_id: userId, date: localDate, overall_score: score });

  if (error) {
    console.error("Error submitting daily overall:", error);
    return false;
  }

  // refresh + invalidate cache so next reads reflect updates immediately
  await refreshDailySummary(userId, localDate);
  invalidateSnapshot(userId);
  return true;
}

export async function getTodayMealsCount(userId: string): Promise<number> {
  const snap = await getSnapshot(userId);
  return snap.todaySummary.has_meal ? 1 : 0;
}

export async function logMeal(
  userId: string,
  mealType: string,
  description?: string,
  photoUrl?: string,
  date?: Date,
  mealTime?: string // HH:MM format in 24h time
): Promise<boolean> {
  const tz = await getCanonicalTimeZone(userId);
  const target = date ?? new Date();
  const localDate = formatDateInTimeZone(target, tz);

  // Calculate meal_datetime:
  // - If mealTime provided: combine target date + specified time (what user says it happened)
  // - If not provided: use CURRENT timestamp (when user clicks "Log X meals")
  let mealDatetime: string;
  
  if (mealTime) {
    // Parse HH:MM and combine with the target date
    const [hours, minutes] = mealTime.split(':').map(Number);
    const mealDate = new Date(target);
    mealDate.setHours(hours, minutes, 0, 0);
    mealDatetime = mealDate.toISOString();
  } else {
    // No time provided, use ACTUAL current timestamp (NOW when logging)
    mealDatetime = new Date().toISOString();
  }

  const { error } = await supabase
    .from("meal_logs")
    .insert({
      user_id: userId,
      meal_type: mealType,
      description,
      photo_url: photoUrl,
      meal_datetime: mealDatetime, // When user says it happened (or NOW if not specified)
      // created_at is auto-set by DB - represents when row was inserted
    });

  if (error) {
    console.error("Error logging meal:", error);
    return false;
  }

  await refreshDailySummary(userId, localDate);
  invalidateSnapshot(userId);
  return true;
}

export async function hasWaterLoggedToday(userId: string): Promise<boolean> {
  const snap = await getSnapshot(userId);
  return snap.todaySummary.has_water;
}

export async function logWater(
  userId: string,
  amountMl: number,
  source: string,
  date?: Date
): Promise<boolean> {
  const tz = await getCanonicalTimeZone(userId);
  const target = date ?? new Date();
  const localDate = formatDateInTimeZone(target, tz);

  const { error } = await supabase
    .from("water_intake_logs")
    .insert({
      user_id: userId,
      amount_ml: amountMl,
      source,
      intake_datetime: target.toISOString(), // UTC
    });

  if (error) {
    console.error("Error logging water:", error);
    return false;
  }

  await refreshDailySummary(userId, localDate);
  invalidateSnapshot(userId);
  return true;
}

export async function hasCheckInToday(userId: string): Promise<boolean> {
  const snap = await getSnapshot(userId);
  return snap.todaySummary.has_checkin;
}

export async function submitDailyCheckIn(
  userId: string,
  sleepQuality: number,
  energy: number,
  focus: number,
  workload: number,
  copingCapacity: number,
  stress: number,
  stressUnexpected: number,
  social: number,
  mood: number,
  moodStability: number,
  emotions: string[],
  date?: Date
): Promise<boolean> {
  const tz = await getCanonicalTimeZone(userId);
  const target = date ?? new Date();
  const localDate = formatDateInTimeZone(target, tz);

  const { error } = await supabase
    .from("daily_checkins")
    .insert({
      user_id: userId,
      sleep_quality: sleepQuality,
      energy_score: energy,
      focus_score: focus,
      workload_score: workload,
      coping_capacity_score: copingCapacity,
      stress_score: stress,
      stress_unexpected_score: stressUnexpected,
      social_score: social,
      mood_score: mood,
      mood_stability_score: moodStability,
      mood_emotions: emotions,
      created_at: target.toISOString(), // UTC
    });

  if (error) {
    console.error("Error submitting check-in:", error);
    return false;
  }

  await refreshDailySummary(userId, localDate);
  invalidateSnapshot(userId);
  return true;
}

export async function getStreakData(userId: string): Promise<number> {
  const snap = await getSnapshot(userId);
  return snap.streak;
}
export async function getDashboardTimeZone(userId: string): Promise<string> {
  const snap = await getSnapshot(userId);
  return snap.tz;
}
/**
 * Weekly activity:
 * UI expects boolean[7] = last 7 days (oldest -> newest)
 * Uses snapshot.weeklyComplete (no extra queries beyond the snapshot load).
 */
export async function getWeeklyActivity(userId: string): Promise<boolean[]> {
  const snap = await getSnapshot(userId);
  return snap.weeklyComplete;
}

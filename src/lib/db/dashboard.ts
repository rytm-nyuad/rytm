import { createBrowserClient } from "@supabase/ssr";
import type { DailyOverall, MealLogEntry } from "@/types/dashboard";
import { formatLocalDate, getBrowserTimeZone } from "@/lib/time";
import { getCanonicalTimeZone } from "@/lib/time";


const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ============================================================
   DailySummary row shape (matches public.daily_summary)
============================================================ */
export type DailySummaryRow = {
  user_id: string;
  date: string; // YYYY-MM-DD (LOCAL date in canonical tz)
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

type DashboardSnapshot = {
  tz: string;
  todayLocal: string; // YYYY-MM-DD in canonical tz
  todaySummary: DailySummaryRow;
  weeklyDates: string[];      // 7 dates oldest->newest in canonical tz
  weeklyComplete: boolean[];  // aligned with weeklyDates
  streak: number;             // shown streak
};

const snapshotCache = new Map<
  string,
  { expiresAt: number; promise: Promise<DashboardSnapshot> }
>();
const SNAPSHOT_TTL_MS = 15_000;

function cacheKey(userId: string) {
  return userId;
}

/* ============================================================
   Refresh daily_summary via RPC for a local date
============================================================ */
async function refreshDailySummary(
  userId: string,
  localDate?: string
): Promise<DailySummaryRow> {
  const { data, error } = await supabase.rpc("refresh_daily_summary", {
    p_user_id: userId,
    p_target_date: localDate ?? null,
  });

  if (error) {
    console.error("refresh_daily_summary failed:", error);
    return {
      user_id: userId,
      date: localDate ?? formatLocalDate(new Date(), "UTC"),
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

async function fetchWeeklySummaries(userId: string, start: string, end: string) {
  const { data, error } = await supabase
    .from("daily_summary")
    .select(
      "date,is_complete,streak_value,has_overall,has_meal,has_water,has_journal,has_checkin,timezone"
    )
    .eq("user_id", userId)
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: true });

  if (error) {
    console.error("fetchWeeklySummaries failed:", error);
    return [] as DailySummaryRow[];
  }
  return (data ?? []) as DailySummaryRow[];
}

/* ============================================================
   Snapshot builder (fast dashboard header: today + weekly)
============================================================ */
async function buildDashboardSnapshot(userId: string): Promise<DashboardSnapshot> {
  const tz = await getCanonicalTimeZone(supabase, userId);
  const now = new Date();
  const todayLocal = formatLocalDate(now, tz);

  // ONE refresh for today
  const todaySummary = await refreshDailySummary(userId, todayLocal);

  // ONE read for last 7 days
  const weeklyDates: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    weeklyDates.push(formatLocalDate(d, tz));
  }
  const start = weeklyDates[0];
  const end = weeklyDates[weeklyDates.length - 1];

  const rows = await fetchWeeklySummaries(userId, start, end);
  const rowMap = new Map(rows.map((r) => [r.date, r]));
  const weeklyComplete = weeklyDates.map((d) => rowMap.get(d)?.is_complete ?? false);

  // streak shown: today if complete else yesterday if complete else 0
  let streak = 0;
  if (todaySummary.is_complete) {
    streak = todaySummary.streak_value;
  } else {
    const yesterday = weeklyDates[weeklyDates.length - 2];
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
   NEW: date-aware summary read for checklist/backlogging
   - Always refreshes that date so UI matches latest DB
============================================================ */
export async function getDailySummaryForDate(
  userId: string,
  date: Date
): Promise<DailySummaryRow> {
  const tz = await getCanonicalTimeZone(supabase, userId);
  const localDate = formatLocalDate(date, tz);
  // refresh & return row (RPC already returns daily_summary)
  const row = await refreshDailySummary(userId, localDate);
  invalidateSnapshot(userId); // keep header consistent if yesterday/today changed
  return row;
}

export async function getDashboardTimeZone(userId: string): Promise<string> {
  const snap = await getSnapshot(userId);
  return snap.tz;
}

/* ============================================================
   EXPORTS (existing names, now support optional date)
============================================================ */

export async function getTodayOverall(
  userId: string,
  date?: Date
): Promise<DailyOverall | null> {
  const tz = await getCanonicalTimeZone(supabase, userId);
  const target = date ?? new Date();
  const dateStr = formatLocalDate(target, tz);

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

/**
 * CHANGE: submitDailyOverall uses RPC wrapper so it can backlog safely.
 */
export async function submitDailyOverall(
  userId: string,
  score: number,
  date?: Date
): Promise<boolean> {
  const tz = await getCanonicalTimeZone(supabase, userId);
  const target = date ?? new Date();
  const localDate = formatLocalDate(target, tz);

  const { data, error } = await supabase.rpc("submit_overall_for_date", {
    p_user_id: userId,
    p_local_date: localDate,
    p_score: score,
  });

  if (error || data !== true) {
    console.error("submit_overall_for_date failed:", error);
    return false;
  }

  invalidateSnapshot(userId);
  return true;
}

/**
 * CHANGE: date-aware meals count:
 * - no date => snapshot today
 * - with date => daily_summary for that date
 */
export async function getTodayMealsCount(userId: string, date?: Date): Promise<number> {
  if (!date) {
    const snap = await getSnapshot(userId);
    return snap.todaySummary.has_meal ? 1 : 0;
  }
  const row = await getDailySummaryForDate(userId, date);
  return row.has_meal ? 1 : 0;
}

// ============================================================
// CHANGE: logMeal now uses ONLY the RPC wrapper (no direct insert)
// - Supports backlogging via p_local_date
// - Supports user-entered local time (e.g. "06:02 PM") via p_local_time
// - Preserves exact timestamp for today via p_at when no mealTime provided
// - RPC handles daily_summary refresh + timezone correctness
// ============================================================
export async function logMeal(
  userId: string,
  mealType: string,
  description?: string,
  photoUrl?: string,
  date?: Date,
  mealTime?: string // CHANGE: expects "06:02 PM" style string (or undefined)
): Promise<boolean> {
  try {
    // KEEP: snapshot gives canonical tz + todayLocal
    const snap = await getSnapshot(userId);
    const tz = snap.tz;

    // KEEP: target day is selectedDate (backlog) or today
    const target = date ?? new Date();
    const localDate = formatLocalDate(target, tz); // "YYYY-MM-DD"
    const isTodayLocal = localDate === snap.todayLocal;

    // CHANGE: call the RPC wrapper (the ONLY write path)
    const { data, error } = await supabase.rpc("log_meal_for_date", {
      p_user_id: userId,
      p_local_date: localDate, // YYYY-MM-DD in canonical tz

      // KEEP: send mealType string; PostgREST will cast to enum if it matches
      // (must match public.meal_type values exactly)
      p_meal_type: mealType,

      p_description: description ?? null,
      p_photo_url: photoUrl ?? null,

      // CHANGE: NEW — optional local time string like "06:02 PM"
      // If provided, SQL will parse and compute the correct UTC timestamp.
      p_local_time: mealTime ?? null,

      // CHANGE: only pass "now" timestamp when:
      // - user is logging for TODAY in canonical tz
      // - and they did NOT provide an explicit mealTime
      // Otherwise keep null -> SQL will fallback to noon local for backlogs.
      p_at: isTodayLocal && !mealTime ? new Date().toISOString() : null,
    });

    console.log("log_meal_for_date rpc result:", { data, error });

    if (error || data !== true) {
      console.error("log_meal_for_date failed:", error);
      return false;
    }

    // KEEP: invalidate snapshot so dashboard refresh reflects the new daily_summary state
    invalidateSnapshot(userId);
    return true;
  } catch (e) {
    console.error("logMeal exception:", e);
    return false;
  }
}


export async function hasWaterLoggedToday(userId: string, date?: Date): Promise<boolean> {
  if (!date) {
    const snap = await getSnapshot(userId);
    return snap.todaySummary.has_water;
  }
  const row = await getDailySummaryForDate(userId, date);
  return row.has_water;
}

// DEPRECATED: logWater is kept for backwards compatibility but the recommended
// path is now logging a meal with meal_type = 'drink' via logMeal().
export async function logWater(
  userId: string,
  amountMl: number,
  source: string,
  date?: Date
): Promise<boolean> {
  const snap = await getSnapshot(userId);
  const tz = snap.tz;
  const target = date ?? new Date();
  const localDate = formatLocalDate(target, tz);
  const isTodayLocal = localDate === snap.todayLocal;

  const { data, error } = await supabase.rpc("log_water_for_date", {
    p_user_id: userId,
    p_local_date: localDate,
    p_amount_ml: amountMl,
    p_source: source,
    p_at: isTodayLocal ? new Date().toISOString() : null,
  });

  if (error || data !== true) {
    console.error("log_water_for_date failed:", error);
    return false;
  }

  invalidateSnapshot(userId);
  return true;
}

/* ============================================================
   Fetch meal_logs for a given local date (for "Logged today" list)
============================================================ */
export async function getMealsForDate(
  userId: string,
  date: Date
): Promise<MealLogEntry[]> {
  const tz = await getCanonicalTimeZone(supabase, userId);
  const localDate = formatLocalDate(date, tz);

  // Query meal_logs with a broad filter, then narrow client-side to the exact local date.
  // We over-fetch starting from midnight UTC of the local date (which will cover most timezones).
  const { data, error } = await supabase
    .from('meal_logs')
    .select('id, user_id, meal_type, description, photo_url, meal_datetime')
    .eq('user_id', userId)
    .gte('meal_datetime', `${localDate}T00:00:00+00:00`)
    .order('meal_datetime', { ascending: true });

  if (error) {
    console.error('getMealsForDate failed:', error);
    return [];
  }

  // Client-side filter: only keep entries whose meal_datetime falls on the target local date
  const filtered = (data ?? []).filter((row: MealLogEntry) => {
    const dt = new Date(row.meal_datetime);
    const rowLocalDate = formatLocalDate(dt, tz);
    return rowLocalDate === localDate;
  });

  // Sort: by meal_datetime ascending (already from DB), stable.
  return filtered;
}

export async function hasCheckInToday(userId: string, date?: Date): Promise<boolean> {
  if (!date) {
    const snap = await getSnapshot(userId);
    return snap.todaySummary.has_checkin;
  }
  const row = await getDailySummaryForDate(userId, date);
  return row.has_checkin;
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
  const snap = await getSnapshot(userId);
  const tz = snap.tz;
  const target = date ?? new Date();
  const localDate = formatLocalDate(target, tz);
  const isTodayLocal = localDate === snap.todayLocal;

  const { data, error } = await supabase.rpc("submit_checkin_for_date", {
    p_user_id: userId,
    p_local_date: localDate,
    p_sleep_quality: sleepQuality,
    p_energy_score: energy,
    p_focus_score: focus,
    p_workload_score: workload,
    p_coping_capacity_score: copingCapacity,
    p_stress_score: stress,
    p_stress_unexpected_score: stressUnexpected,
    p_social_score: social,
    p_mood_score: mood,
    p_mood_stability_score: moodStability,
    p_mood_emotions: emotions,
    p_at: isTodayLocal ? new Date().toISOString() : null,
  });

  if (error || data !== true) {
    console.error("submit_checkin_for_date failed:", error);
    return false;
  }

  invalidateSnapshot(userId);
  return true;
}

export async function getStreakData(userId: string): Promise<number> {
  const snap = await getSnapshot(userId);
  return snap.streak;
}

export async function getWeeklyActivity(userId: string): Promise<boolean[]> {
  const snap = await getSnapshot(userId);
  return snap.weeklyComplete;
}

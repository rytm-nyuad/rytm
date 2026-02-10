import { createBrowserClient } from "@supabase/ssr";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export interface LeaderboardEntry {
  userId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  streak: number;
  rank: number;
  avatarUrl?: string;
}

export interface ActiveWeek {
  id: string;
  week_start: string;
  week_end: string;
  metric_key: string;
  title: string | null;
}

export interface WeeklyLeaderboardEntry {
  userId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  value: number;
  rank: number;
  avatarUrl?: string;
  lastSyncedAt: string | null;
  fitbitStatus: string | null; // 'active' or 'needs_reauth'
  // Sleep consistency fields (only populated when metric_key == 'sleep_consistency')
  earliestSleepMinutesNorm: number | null;
  latestWakeMinutes: number | null;
  rangeMinutes: number | null;
  avgSleepMinutes: number | null;
  scoreMinutes: number | null;
}

export interface WeeklyLeaderboardData {
  activeWeek: ActiveWeek;
  entries: WeeklyLeaderboardEntry[];
  lastUpdated: string | null;
}

/**
 * Get the active leaderboard week
 */
export async function getActiveWeek(): Promise<ActiveWeek | null> {
  try {
    const { data, error } = await supabase
      .from("leaderboard_weeks")
      .select("id, week_start, week_end, metric_key, title")
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      console.error("Error fetching active week:", error);
      return null;
    }

    return data;
  } catch (error) {
    console.error("Error in getActiveWeek:", error);
    return null;
  }
}

/**
 * Get weekly leaderboard rankings for the active week
 */
export async function getWeeklyLeaderboard(): Promise<WeeklyLeaderboardData | null> {
  try {
    // First get the active week
    const activeWeek = await getActiveWeek();
    if (!activeWeek) {
      return null;
    }

    // Get rankings for this week
    const isSleep = activeWeek.metric_key === "sleep_consistency";

    const { data: stats, error: statsError } = await supabase
      .from("leaderboard_user_week_stats")
      .select("app_user_id, value, last_synced_at, earliest_sleep_minutes_norm, latest_wake_minutes, range_minutes, avg_sleep_minutes, score_minutes")
      .eq("week_id", activeWeek.id)
      .eq("metric_key", activeWeek.metric_key);

    if (statsError) {
      console.error("Error fetching week stats:", statsError);
      return null;
    }

    if (!stats || stats.length === 0) {
      return {
        activeWeek,
        entries: [],
        lastUpdated: null,
      };
    }

    // Get user profiles for all users in the leaderboard
    const userIds = stats.map((s) => s.app_user_id);
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("user_id, first_name, last_name")
      .in("user_id", userIds);

    if (profilesError) {
      console.error("Error fetching profiles:", profilesError);
    }

    // Get Fitbit status for all users
    const { data: fitbitCreds, error: fitbitError } = await supabase
      .from("fitbit_credentials")
      .select("app_user_id, status")
      .in("app_user_id", userIds);

    if (fitbitError) {
      console.error("Error fetching fitbit credentials:", fitbitError);
    }

    // Create a map for quick profile lookup
    const profileMap = new Map<string, { first_name: string; last_name: string }>();
    if (profiles) {
      for (const p of profiles) {
        profileMap.set(p.user_id, {
          first_name: p.first_name || "Unknown",
          last_name: p.last_name || "",
        });
      }
    }

    // Create a map for Fitbit status lookup
    const fitbitStatusMap = new Map<string, string>();
    if (fitbitCreds) {
      for (const cred of fitbitCreds) {
        fitbitStatusMap.set(cred.app_user_id, cred.status);
      }
    }

    // Build leaderboard entries (unsorted initially)
    const unsorted: WeeklyLeaderboardEntry[] = stats.map((stat) => {
      const profile = profileMap.get(stat.app_user_id);
      const firstName = profile?.first_name || "Unknown";
      const lastName = profile?.last_name || "";
      const fitbitStatus = fitbitStatusMap.get(stat.app_user_id) || null;

      return {
        userId: stat.app_user_id,
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`.trim(),
        value: stat.value,
        rank: 0, // assigned after sort
        avatarUrl: undefined,
        lastSyncedAt: stat.last_synced_at,
        fitbitStatus,
        earliestSleepMinutesNorm: stat.earliest_sleep_minutes_norm ?? null,
        latestWakeMinutes: stat.latest_wake_minutes ?? null,
        rangeMinutes: stat.range_minutes ?? null,
        avgSleepMinutes: stat.avg_sleep_minutes ?? null,
        scoreMinutes: stat.score_minutes ?? null,
      };
    });

    // Sort: sleep_consistency ascending by score (nulls last), steps descending by value
    if (isSleep) {
      unsorted.sort((a, b) => {
        if (a.scoreMinutes == null && b.scoreMinutes == null) return 0;
        if (a.scoreMinutes == null) return 1;
        if (b.scoreMinutes == null) return -1;
        return a.scoreMinutes - b.scoreMinutes; // ascending — lower is better
      });
    } else {
      unsorted.sort((a, b) => b.value - a.value); // descending — higher is better
    }

    // Assign ranks
    const entries: WeeklyLeaderboardEntry[] = unsorted.map((e, i) => ({ ...e, rank: i + 1 }));

    // Determine the most recent last_synced_at
    const lastUpdated = stats.reduce<string | null>((max, stat) => {
      if (!stat.last_synced_at) return max;
      if (!max) return stat.last_synced_at;
      return new Date(stat.last_synced_at) > new Date(max)
        ? stat.last_synced_at
        : max;
    }, null);

    return {
      activeWeek,
      entries,
      lastUpdated,
    };
  } catch (error) {
    console.error("Error in getWeeklyLeaderboard:", error);
    return null;
  }
}

/**
 * Format a metric key for display (e.g., "steps" -> "Steps")
 */
export function formatMetricKey(metricKey: string): string {
  return metricKey
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Format a value for display based on metric key
 */
export function formatMetricValue(value: number, metricKey: string): string {
  if (metricKey === "steps") {
    return value.toLocaleString();
  }
  return value.toLocaleString();
}

// ── Sleep Time Formatting Helpers ────────────────────

/**
 * Convert normalized sleep minutes back to HH:MM clock time.
 * If value >= 1440, subtract 1440 before formatting.
 */
export function formatSleepMinutesToClock(minutes: number | null): string {
  if (minutes == null) return "—";
  let m = minutes;
  if (m >= 1440) m -= 1440;
  if (m < 0) m += 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Format duration in minutes as "Xh Ym".
 */
export function formatDurationMinutes(minutes: number | null): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

/**
 * Get leaderboard with user streaks and rankings
 * This is a simplified version - in production you'd want to cache streaks
 */
export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    // Get all users with their profile info
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("user_id, first_name, last_name");

    console.log("Profiles fetched:", profiles?.length || 0);
    if (profileError) {
      console.error("Error fetching profiles:", profileError);
      console.error("Error details:", JSON.stringify(profileError, null, 2));
    }

    if (profileError || !profiles || profiles.length === 0) {
      console.log("No profiles available");
      return [];
    }

    // For each user, calculate their streak
    // Note: This is inefficient for large user bases - consider pre-calculating streaks
    const leaderboardPromises = profiles.map(async (profile) => {
      try {
        // Import getStreakData dynamically to avoid circular dependencies
        const { getStreakData } = await import("./dashboard");
        const streak = await getStreakData(profile.user_id);
        
        console.log(`User ${profile.first_name}: streak = ${streak}`);

        return {
          userId: profile.user_id,
          firstName: profile.first_name || "Unknown",
          lastName: profile.last_name || "",
          fullName: `${profile.first_name || "Unknown"} ${profile.last_name || ""}`.trim(),
          streak,
          rank: 0, // Will be set after sorting
        };
      } catch (error) {
        console.error(`Error calculating streak for ${profile.first_name}:`, error);
        return {
          userId: profile.user_id,
          firstName: profile.first_name || "Unknown",
          lastName: profile.last_name || "",
          fullName: `${profile.first_name || "Unknown"} ${profile.last_name || ""}`.trim(),
          streak: 0,
          rank: 0,
        };
      }
    });

    const leaderboardData = await Promise.all(leaderboardPromises);
    console.log("Leaderboard data calculated:", leaderboardData.length);

    // Sort by streak descending
    leaderboardData.sort((a, b) => b.streak - a.streak);

    // Assign ranks
    leaderboardData.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    console.log("Final leaderboard:", leaderboardData);
    return leaderboardData;
  } catch (error) {
    console.error("Error generating leaderboard:", error);
    return [];
  }
}

/**
 * Get leaderboard filtered by location
 */
export async function getLeaderboardByLocation(
  filter: "worldwide" | "country" | "state" | "zipcode",
  value?: string
): Promise<LeaderboardEntry[]> {
  // For now, return worldwide leaderboard
  // In production, you'd filter by user location from profiles
  return getLeaderboard();
}

// ── Overall Leaderboard ──────────────────────────────

export interface OverallLeaderboardEntry {
  userId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  totalPoints: number;
  overallRank: number;
  weeksCompeted: number;
  bestFinish: number;
  avatarUrl?: string;
  latestWeekPoints?: number; // "+63 this week"
}

/**
 * Fetch the cumulative overall leaderboard from the
 * `overall_leaderboard` view, enriched with latest-week delta.
 *
 * @param limit  Pass 0 or undefined for all rows.
 */
export async function getOverallLeaderboard(
  limit?: number
): Promise<OverallLeaderboardEntry[]> {
  try {
    // 1. Fetch from the overall_leaderboard view
    let query = supabase
      .from("overall_leaderboard")
      .select("user_id, first_name, last_name, full_name, total_points, weeks_competed, best_finish, overall_rank")
      .order("overall_rank", { ascending: true });

    if (limit && limit > 0) {
      query = query.limit(limit);
    }

    const { data: rows, error } = await query;

    if (error) {
      console.error("Error fetching overall leaderboard:", error);
      return [];
    }

    if (!rows || rows.length === 0) return [];

    // 2. Fetch latest-week deltas
    const { data: deltas } = await supabase
      .from("latest_week_points")
      .select("user_id, latest_points");

    const deltaMap = new Map<string, number>();
    if (deltas) {
      for (const d of deltas) {
        deltaMap.set(d.user_id, d.latest_points);
      }
    }

    // 3. Map to typed entries
    return rows.map((r) => ({
      userId: r.user_id,
      firstName: r.first_name || "Unknown",
      lastName: r.last_name || "",
      fullName: r.full_name || "Unknown",
      totalPoints: r.total_points,
      overallRank: Number(r.overall_rank),
      weeksCompeted: r.weeks_competed,
      bestFinish: r.best_finish,
      avatarUrl: undefined,
      latestWeekPoints: deltaMap.get(r.user_id) ?? 0,
    }));
  } catch (error) {
    console.error("Error in getOverallLeaderboard:", error);
    return [];
  }
}

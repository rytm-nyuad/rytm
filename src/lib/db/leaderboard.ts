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
    const { data: stats, error: statsError } = await supabase
      .from("leaderboard_user_week_stats")
      .select("app_user_id, value, last_synced_at")
      .eq("week_id", activeWeek.id)
      .eq("metric_key", activeWeek.metric_key)
      .order("value", { ascending: false });

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

    // Build leaderboard entries
    const entries: WeeklyLeaderboardEntry[] = stats.map((stat, index) => {
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
        rank: index + 1,
        avatarUrl: undefined,
        lastSyncedAt: stat.last_synced_at,
        fitbitStatus,
      };
    });

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

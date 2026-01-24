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

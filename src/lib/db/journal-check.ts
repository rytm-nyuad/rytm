// Helper to check if user has journaled today
import { createClient } from "@/lib/supabase/browser";

/**
 * Check if user has sent at least one journal message today (free or guided)
 */
export async function hasJournaledToday(userId: string): Promise<boolean> {
  const supabase = createClient();
  
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("journal_messages")
    .select("id")
    .eq("user_id", userId)
    .gte("created_at", `${today}T00:00:00`)
    .lt("created_at", `${tomorrow}T00:00:00`)
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("Error checking journal:", error);
    return false;
  }

  return !!data;
}

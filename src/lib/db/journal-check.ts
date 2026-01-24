// Helper to check if user has journaled today
import { createClient } from "@/lib/supabase/browser";

// Helper to get local date string (YYYY-MM-DD)
function getLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Check if user has sent at least one journal message today (free or guided)
 */
export async function hasJournaledToday(userId: string, date?: Date): Promise<boolean> {
  const supabase = createClient();
  
  const targetDate = date || new Date();
  const dateStr = getLocalDateString(targetDate);

  const { data, error } = await supabase
    .from("journal_messages")
    .select("id")
    .eq("user_id", userId)
    .gte("created_at", `${dateStr}T00:00:00`)
    .lt("created_at", `${dateStr}T23:59:59`)
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("Error checking journal:", error);
    return false;
  }

  return !!data;
}

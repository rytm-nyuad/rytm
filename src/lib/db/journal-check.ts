// src/lib/db/journal-check.ts
"use client";

import { createClient } from "@/lib/supabase/browser";

/**
 * CHANGE: Journal completion is now derived from public.daily_summary.has_journal
 * so it is:
 * - timezone-correct (Fitbit/profile canonical tz via refresh_daily_summary RPC)
 * - fast (single row lookup)
 *
 * Note: date arg is kept for backward compatibility, but is ignored for now.
 * The dashboard calls this only for "today" anyway.
 */
export async function hasJournaledToday(userId: string, _date?: Date): Promise<boolean> {
  const supabase = createClient();

  // We rely on the dashboard.ts snapshot/RPC to keep daily_summary up-to-date.
  // But in case journal-check is used elsewhere independently, you can optionally
  // call refresh_daily_summary here too. (I recommend NOT doing it to avoid extra RPC.)
  //
  // If you want the safety refresh, uncomment:
  // await supabase.rpc("refresh_daily_summary", { p_user_id: userId, p_target_date: null });

  const { data, error } = await supabase
    .from("daily_summary")
    .select("has_journal")
    .eq("user_id", userId)
    // CHANGE: "today" row is the latest date row (canonical day).
    // This avoids needing canonical timezone conversion in JS.
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Error checking journal via daily_summary:", error);
    return false;
  }

  return !!data?.has_journal;
}

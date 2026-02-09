// Database operations for journal messages

import type { SupabaseClient } from "@supabase/supabase-js";

export interface JournalMessage {
  id: string;
  user_id: string;
  thread_id: string | null;
  mode: "free" | "guided";
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

/**
 * DEPRECATED: Save a journal message directly to the database
 * 
 * ⚠️ This function bypasses timezone and backlog detection.
 * Use the RPC `log_journal_message_for_date()` instead for all new code.
 * See: supabase/function_rpcs.sql
 * 
 * This function is retained for backward compatibility only.
 */
export async function saveJournalMessage(
  supabase: SupabaseClient,
  userId: string,
  content: string,
  mode: "free" | "guided",
  role: "user" | "assistant",
  threadId: string | null = null
): Promise<JournalMessage | null> {
  const { data, error } = await supabase
    .from("journal_messages")
    .insert({
      user_id: userId,
      thread_id: threadId,
      mode,
      role,
      content,
    })
    .select()
    .single();

  if (error) {
    console.error("Error saving journal message:", error);
    return null;
  }

  return data;
}

/**
 * Get or create a thread for journaling
 * 
 * Returns existing thread for the session date/type, or creates a new one.
 * Automatically computes session date and timezone server-side if not provided.
 * 
 * @param supabase Supabase client
 * @param userId User ID
 * @param journalType 'free' or 'guided'
 * @param sessionDateLocal Optional: local date in user's timezone (YYYY-MM-DD)
 * @param sessionTimezone Optional: canonical timezone; server computes if not provided
 * @returns thread UUID or null on error
 */
export async function getOrCreateThread(
  supabase: SupabaseClient,
  userId: string,
  journalType: 'free' | 'guided' = 'free',
  sessionDateLocal?: string,
  sessionTimezone?: string
): Promise<string | null> {
  try {
    // Call Supabase function to get/create thread with session metadata
    const { data, error } = await supabase.rpc("get_or_create_active_thread", {
      p_user_id: userId,
      p_journal_type: journalType,
      p_session_date_local: sessionDateLocal || null,
      p_session_timezone: sessionTimezone || null,
    });

    if (error) {
      console.error("Error getting/creating thread:", error);
      return null;
    }

    return data;
  } catch (error) {
    console.error("Exception in getOrCreateThread:", error);
    return null;
  }
}

/**
 * Load messages for a thread (for guided mode conversation history)
 */
export async function loadThreadMessages(supabase: SupabaseClient, threadId: string): Promise<JournalMessage[]> {
  const { data, error } = await supabase
    .from("journal_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error loading thread messages:", error);
    return [];
  }

  return data || [];
}

/**
 * Load today's free-form journal messages
 */
export async function loadTodayFreeMessages(supabase: SupabaseClient, userId: string, canonicalTz: string): Promise<JournalMessage[]> {
  const { formatLocalDate } = await import("@/lib/time");
  const dateStr = formatLocalDate(new Date(), canonicalTz);
  const { data, error } = await supabase
    .from("journal_messages")
    .select("*")
    .eq("user_id", userId)
    .eq("mode", "free")
    .gte("created_at", `${dateStr}T00:00:00`)
    .lt("created_at", `${dateStr}T23:59:59`)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error loading free messages:", error);
    return [];
  }

  return data || [];
}

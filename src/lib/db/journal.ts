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
 * Save a journal message (user or assistant)
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
 * Get or create a thread for guided mode
 * Returns existing thread from today or creates new one
 */
export async function getOrCreateThread(supabase: SupabaseClient, userId: string): Promise<string | null> {
  try {
    // Call Supabase function to get/create thread
    const { data, error } = await supabase.rpc("get_or_create_active_thread", {
      p_user_id: userId,
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
export async function loadTodayFreeMessages(supabase: SupabaseClient, userId: string): Promise<JournalMessage[]> {
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("journal_messages")
    .select("*")
    .eq("user_id", userId)
    .eq("mode", "free")
    .gte("created_at", `${today}T00:00:00`)
    .lt("created_at", `${tomorrow}T00:00:00`)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error loading free messages:", error);
    return [];
  }

  return data || [];
}

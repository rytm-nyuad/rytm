// Database Tools - Wrapper for all database operations
// Keeps agents clean by abstracting Supabase calls into reusable tools

import { SupabaseClient } from "@supabase/supabase-js";
import { AgentContext, Tool } from "../types";

/**
 * Journal Database Operations
 * All journal-related database interactions
 */
export class JournalDatabaseTool {
  /**
   * Save a journal message to the database
   */
  static async saveMessage(
    supabase: SupabaseClient,
    userId: string,
    content: string,
    mode: "free" | "guided",
    role: "user" | "assistant",
    threadId: string | null
  ) {
    const { data, error } = await supabase
      .from("journal_messages")
      .insert({
        user_id: userId,
        content,
        mode,
        role,
        thread_id: threadId,
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
   * Get or create an active thread for the user
   */
  static async getOrCreateThread(
    supabase: SupabaseClient,
    userId: string,
    journalType: 'free' | 'guided' = 'guided'
  ): Promise<string | null> {
    // Use the RPC function to get or create thread with proper type isolation
    const { data: threadId, error } = await supabase.rpc('get_or_create_active_thread', {
      p_user_id: userId,
      p_journal_type: journalType
    });

    if (error) {
      console.error("Error getting/creating thread:", error);
      return null;
    }

    return threadId;
  }

  /**
   * Load conversation history from a thread
   */
  static async loadThreadMessages(
    supabase: SupabaseClient,
    threadId: string,
    limit: number = 10
  ) {
    const { data, error } = await supabase
      .from("journal_messages")
      .select("content, role, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) {
      console.error("Error loading thread messages:", error);
      return [];
    }

    return data || [];
  }

  /**
   * Close a thread (mark as inactive)
   */
  static async closeThread(
    supabase: SupabaseClient,
    threadId: string
  ): Promise<boolean> {
    const { error } = await supabase
      .from("journal_threads")
      .update({ status: "closed" })
      .eq("id", threadId);

    if (error) {
      console.error("Error closing thread:", error);
      return false;
    }

    return true;
  }
}

/**
 * Dashboard Database Operations
 * All dashboard-related database interactions
 */
export class DashboardDatabaseTool {
  /**
   * Get user's wellness data for today
   */
  static async getTodayData(supabase: SupabaseClient, userId: string) {
    const today = new Date().toISOString().split("T")[0];
    
    const { data, error } = await supabase
      .from("daily_overall")
      .select("*")
      .eq("user_id", userId)
      .eq("date", today)
      .single();

    if (error && error.code !== "PGRST116") { // PGRST116 = no rows
      console.error("Error fetching today's data:", error);
      return null;
    }

    return data;
  }

  /**
   * Get user's wellness streak
   */
  static async getStreak(supabase: SupabaseClient, userId: string) {
    // Implementation depends on your streak calculation logic
    // This is a placeholder
    return 0;
  }
}

/**
 * Create LangChain-compatible tools from database operations
 * This allows agents to use these as function calling tools
 */
export function createDatabaseTools(context: AgentContext): Tool[] {
  return [
    {
      name: "save_journal_message",
      description: "Save a journal message to the database",
      execute: async (params: {
        content: string;
        mode: "free" | "guided";
        role: "user" | "assistant";
        threadId: string | null;
      }) => {
        return await JournalDatabaseTool.saveMessage(
          context.supabase,
          context.userId,
          params.content,
          params.mode,
          params.role,
          params.threadId
        );
      },
    },
    {
      name: "load_conversation_history",
      description: "Load recent conversation history from a thread",
      execute: async (params: { threadId: string; limit?: number }) => {
        return await JournalDatabaseTool.loadThreadMessages(
          context.supabase,
          params.threadId,
          params.limit || 10
        );
      },
    },
  ];
}

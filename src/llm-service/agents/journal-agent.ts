// Journal Agent - Handles guided journaling conversations
// This agent manages context, conversation history, and provides empathetic responses

import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { AgentInput, AgentOutput, AgentContext } from "../types";
import { getJournalLLM } from "../config/llm";
import { JOURNAL_SYSTEM_PROMPT } from "../config/prompts";
import { JournalDatabaseTool } from "../tools/database-tools";

export interface JournalAgentInput extends AgentInput {
  mode: "free" | "guided";
  localDate?: string;
}

export interface JournalAgentOutput extends AgentOutput {
  message?: any;
  aiResponse?: string;
  threadId?: string;
}

/**
 * JournalAgent
 * 
 * Responsibilities:
 * - Handle free-form journaling (save without AI response)
 * - Handle guided journaling (conversational with AI)
 * - Manage conversation history and context
 * - Provide empathetic, supportive responses
 * 
 * Architecture:
 * - Stateless: All state stored in database
 * - Context-aware: Loads recent conversation history
 * - Configurable: System prompt and behavior can be modified
 */
export class JournalAgent {
  private maxHistoryMessages: number;

  constructor(config?: { maxHistoryMessages?: number }) {
    this.maxHistoryMessages = config?.maxHistoryMessages || 6;
  }

  /**
   * Main entry point for the journal agent
   */
  async run(
    input: JournalAgentInput,
    context: AgentContext
  ): Promise<JournalAgentOutput> {
    try {
      // Validate input
      if (!input.content || !input.mode) {
        return {
          success: false,
          error: "Missing content or mode",
        };
      }

      // FREE MODE: Just save the message, no AI response
      if (input.mode === "free") {
        return await this.handleFreeMode(input, context);
      }

      // GUIDED MODE: AI-powered conversation
      if (input.mode === "guided") {
        return await this.handleGuidedMode(input, context);
      }

      return {
        success: false,
        error: "Invalid mode. Must be 'free' or 'guided'",
      };
    } catch (error) {
      console.error("JournalAgent error:", error);
      return {
        success: false,
        error: "An error occurred while processing your journal entry",
      };
    }
  }

  /**
   * Handle free-form journaling (no AI response)
   * NOTE: Agent only validates mode is free. Caller (JournalChat component)
   * is responsible for saving the message via RPC for timezone+backlog awareness.
   */
  private async handleFreeMode(
    input: JournalAgentInput,
    context: AgentContext
  ): Promise<JournalAgentOutput> {
    // Validate content exists
    if (!input.content || input.content.trim().length === 0) {
      return {
        success: false,
        error: "Journal entry cannot be empty",
      };
    }

    // Agent is compute-only; caller will save via RPC
    return {
      success: true,
      message: { content: input.content },
    };
  }

  /**
   * Handle guided journaling with AI conversation
   * NOTE: Agent only generates AI response. Caller (API route) is responsible
   * for saving BOTH user and assistant messages via RPC for timezone+backlog awareness.
   */
  private async handleGuidedMode(
    input: JournalAgentInput,
    context: AgentContext
  ): Promise<JournalAgentOutput> {
    // Step 1: Get or create thread for guided mode
    // Pass session date/timezone so RPC stores metadata and prevents double-counting
    const threadId = await JournalDatabaseTool.getOrCreateThread(
      context.supabase,
      context.userId,
      "guided",
      input.localDate,  // YYYY-MM-DD in user's canonical timezone
      undefined         // timezone: let RPC compute from user profile
    );

    if (!threadId) {
      return {
        success: false,
        error: "Failed to create conversation thread",
      };
    }

    // Step 2: Load conversation history (limited to recent messages)
    // NOTE: Does not include the current message being sent (not yet saved)
    const allHistory = await JournalDatabaseTool.loadThreadMessages(
      context.supabase,
      threadId,
      20 // Load more, then slice to most recent
    );
    const history = allHistory.slice(-this.maxHistoryMessages);

    // Step 3: Build messages for LLM
    // Include the current user message and history (history doesn't include current msg yet)
    const messages = [
      new SystemMessage(JOURNAL_SYSTEM_PROMPT),
      ...history.map((msg) =>
        msg.role === "user"
          ? new HumanMessage(msg.content)
          : new AIMessage(msg.content)
      ),
      // Add the current user message so LLM can respond to it
      new HumanMessage(input.content),
    ];

    // Step 4: Get AI response
    const llm = getJournalLLM();
    const response = await llm.invoke(messages);
    const aiContent = response.content.toString();

    console.log("💬 AI Response:", aiContent.substring(0, 100));
    console.log("🔖 Thread ID:", threadId);
    console.log("✅ Agent computed response (not saved yet)");

    // Agent is compute-only; caller will save both user + AI messages via RPC
    return {
      success: true,
      aiResponse: aiContent,
      threadId,
      metadata: {
        historyLength: history.length,
        model: "gpt-4o-mini",
      },
    };
  }

  /**
   * Close the current conversation thread
   * Useful when starting a new journaling session
   */
  async closeCurrentThread(context: AgentContext): Promise<boolean> {
    // Get active thread
    const { data: thread } = await context.supabase
      .from("journal_threads")
      .select("id")
      .eq("user_id", context.userId)
      .eq("status", "active")
      .single();

    if (!thread) {
      return true; // No active thread to close
    }

    return await JournalDatabaseTool.closeThread(context.supabase, thread.id);
  }
}

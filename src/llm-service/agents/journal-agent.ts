// Journal Agent - Handles guided journaling conversations
// This agent manages context, conversation history, and provides empathetic responses

import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { AgentInput, AgentOutput, AgentContext } from "../types";
import { getJournalLLM } from "../config/llm";
import { JOURNAL_SYSTEM_PROMPT } from "../config/prompts";
import { JournalDatabaseTool } from "../tools/database-tools";

export interface JournalAgentInput extends AgentInput {
  mode: "free" | "guided";
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
   */
  private async handleFreeMode(
    input: JournalAgentInput,
    context: AgentContext
  ): Promise<JournalAgentOutput> {
    const savedMessage = await JournalDatabaseTool.saveMessage(
      context.supabase,
      context.userId,
      input.content,
      "free",
      "user",
      null
    );

    if (!savedMessage) {
      return {
        success: false,
        error: "Failed to save journal entry",
      };
    }

    return {
      success: true,
      message: savedMessage,
    };
  }

  /**
   * Handle guided journaling with AI conversation
   */
  private async handleGuidedMode(
    input: JournalAgentInput,
    context: AgentContext
  ): Promise<JournalAgentOutput> {
    // Step 1: Get or create thread for guided mode
    const threadId = await JournalDatabaseTool.getOrCreateThread(
      context.supabase,
      context.userId,
      "guided"
    );

    if (!threadId) {
      return {
        success: false,
        error: "Failed to create conversation thread",
      };
    }

    // Step 2: Save user's message
    await JournalDatabaseTool.saveMessage(
      context.supabase,
      context.userId,
      input.content,
      "guided",
      "user",
      threadId
    );

    // Step 3: Load conversation history (limited to recent messages)
    const allHistory = await JournalDatabaseTool.loadThreadMessages(
      context.supabase,
      threadId,
      20 // Load more, then slice to most recent
    );
    const history = allHistory.slice(-this.maxHistoryMessages);

    // Step 4: Build messages for LLM
    const messages = [
      new SystemMessage(JOURNAL_SYSTEM_PROMPT),
      ...history.map((msg) =>
        msg.role === "user"
          ? new HumanMessage(msg.content)
          : new AIMessage(msg.content)
      ),
    ];

    // Step 5: Get AI response
    const llm = getJournalLLM();
    const response = await llm.invoke(messages);
    const aiContent = response.content.toString();

    console.log("💬 AI Response:", aiContent.substring(0, 100));
    console.log("🔖 Saving to threadId:", threadId);

    // Step 6: Save AI response
    const aiMessage = await JournalDatabaseTool.saveMessage(
      context.supabase,
      context.userId,
      aiContent,
      "guided",
      "assistant",
      threadId
    );

    console.log("✅ AI message saved:", !!aiMessage);
    console.log("📝 Saved message ID:", aiMessage?.id);

    if (!aiMessage) {
      return {
        success: false,
        error: "Failed to save AI response",
      };
    }

    return {
      success: true,
      aiResponse: aiContent,
      threadId,
      message: aiMessage,
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

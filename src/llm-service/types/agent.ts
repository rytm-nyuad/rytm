// Base types for agent system
// This file defines the core interfaces that all agents and tools must implement

import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Base input that all agents receive
 */
export interface AgentInput {
  userId: string;
  content: string;
  metadata?: Record<string, any>;
}

/**
 * Base output that all agents return
 */
export interface AgentOutput {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Context passed to agents for database access
 */
export interface AgentContext {
  supabase: SupabaseClient;
  userId: string;
}

/**
 * Base tool interface
 * Tools are functions that agents can use to interact with external systems
 */
export interface Tool {
  name: string;
  description: string;
  execute: (params: any, context: AgentContext) => Promise<any>;
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  systemPrompt: string;
  temperature?: number;
  maxHistoryMessages?: number;
  tools?: Tool[];
}

/**
 * Message types for conversation history
 */
export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: MessageRole;
  content: string;
  metadata?: Record<string, any>;
}

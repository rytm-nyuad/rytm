// LLM Configuration - Direct OpenAI
import { ChatOpenAI } from "@langchain/openai";

/**
 * Simple LLM factory for journal agent
 * Using OpenAI GPT-4o-mini directly
 */
export function getJournalLLM() {
  const apiKey = process.env.OPENAI_API_KEY;
  
  // Debug logging
  console.log("🔑 OpenAI API Key exists:", !!apiKey);
  console.log("🔑 API Key length:", apiKey?.length);
  console.log("🔑 API Key prefix:", apiKey?.substring(0, 10));
  
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not found in environment variables");
  }

  return new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0.7,
    openAIApiKey: apiKey,
  });
}

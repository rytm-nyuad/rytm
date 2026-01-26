// LLM Configuration for RYTM
// Centralized place to manage AI models

import { ChatOpenAI } from "@langchain/openai";

/** 
 * GET YOUR SYSTEM PROMPT HERE 👇
 * Modify this to change the agent's personality and behavior
 */
export const JOURNAL_SYSTEM_PROMPT = `You are a supportive and empathetic journal companion for the RYTM wellness app. 

Your role:
- Listen actively and respond with warmth and understanding
- Ask thoughtful follow-up questions to help users explore their feelings
- Keep responses concise (2-3 sentences max)
- Never judge or give medical advice
- Encourage self-reflection and emotional awareness

Tone: Warm, curious, non-judgmental, like a close friend who truly listens.`;

/**
 * Get LLM instance via OpenRouter
 * Using OpenRouter for access to multiple AI models
 */
export function getJournalLLM() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY not found in environment variables");
    throw new Error("OpenRouter API key is not configured");
  }

  return new ChatOpenAI({
    modelName: "openai/gpt-4o-mini", // OpenRouter model format: provider/model
    temperature: 0.7,
    openAIApiKey: apiKey,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        "X-Title": "RYTM Journal",
      },
    },
  });
}

/**
 * Weekly LLM rotation (optional - for variety)
 * Uncomment and modify when you want to experiment with different models
 * 
 * Available OpenRouter models:
 * - openai/gpt-4o-mini (fast, cheap)
 * - openai/gpt-4o (smartest, expensive)
 * - anthropic/claude-3.5-sonnet (very good, medium cost)
 * - google/gemini-pro (good, cheap)
 * - meta-llama/llama-3.1-70b-instruct (open source, cheap)
 */
// export function getWeeklyLLM() {
//   const week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
//   const models = [
//     "openai/gpt-4o-mini",
//     "anthropic/claude-3.5-sonnet",
//     "google/gemini-pro"
//   ];
//   const modelName = models[week % models.length];
  
//   return new ChatOpenAI({
//     modelName,
//     temperature: 0.7,
//     openAIApiKey: process.env.OPENROUTER_API_KEY,
//     configuration: {
//       baseURL: "https://openrouter.ai/api/v1",
//       defaultHeaders: {
//         "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
//         "X-Title": "RYTM Journal",
//       },
//     },
//   });
// }

import { OpenAI } from 'openai';
import { GOAL_FRAMING_SYSTEM_PROMPT } from './goalFramingPrompt';

const DEFAULT_OPENAI_GOAL_FRAMING_MODEL = 'gpt-4.1-mini';
const DEFAULT_OPENROUTER_GOAL_FRAMING_MODEL = 'openai/gpt-4.1-mini';

type GoalFramingProvider = 'openai' | 'openrouter';

function resolveGoalFramingProvider(): GoalFramingProvider {
  const raw = (process.env.GOAL_FRAMING_LLM_PROVIDER || '').trim().toLowerCase();
  if (raw === 'openai' || raw === 'openrouter') {
    return raw;
  }
  if (raw) {
    throw new Error(
      `Invalid GOAL_FRAMING_LLM_PROVIDER=${raw}. Expected 'openai' or 'openrouter'.`
    );
  }

  // If unset: OpenAI when OPENAI_API_KEY exists, else OpenRouter.
  if (process.env.OPENAI_API_KEY) {
    return 'openai';
  }
  if (process.env.OPENROUTER_API_KEY) {
    return 'openrouter';
  }

  throw new Error(
    'Missing credentials for goal framing. Set GOAL_FRAMING_LLM_PROVIDER and the matching API key (OPENAI_API_KEY or OPENROUTER_API_KEY).'
  );
}

function resolveGoalFramingModel(provider: GoalFramingProvider): string {
  const override = (process.env.GOAL_FRAMING_MODEL || '').trim();
  if (override) {
    return override;
  }
  return provider === 'openrouter'
    ? DEFAULT_OPENROUTER_GOAL_FRAMING_MODEL
    : DEFAULT_OPENAI_GOAL_FRAMING_MODEL;
}

function getGoalFramingClient(provider: GoalFramingProvider) {
  if (provider === 'openrouter') {
    const openRouterApiKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterApiKey) {
      throw new Error(
        'Missing OPENROUTER_API_KEY for goal framing (GOAL_FRAMING_LLM_PROVIDER=openrouter).'
      );
    }
    return new OpenAI({
      apiKey: openRouterApiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer':
          process.env.NEXT_PUBLIC_APP_URL ||
          process.env.NEXTAUTH_URL ||
          'http://localhost:3000',
        'X-Title': 'RYTM Goal Framing',
      },
    });
  }

  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    throw new Error(
      'Missing OPENAI_API_KEY for goal framing (GOAL_FRAMING_LLM_PROVIDER=openai).'
    );
  }
  return new OpenAI({ apiKey: openAiApiKey });
}

export async function runGoalFramingAgent(interviewSummary: any) {
  const provider = resolveGoalFramingProvider();
  const model = resolveGoalFramingModel(provider);
  const client = getGoalFramingClient(provider);

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: GOAL_FRAMING_SYSTEM_PROMPT },
      {
        role: 'user',
        content: interviewSummary
          ? JSON.stringify(interviewSummary, null, 2)
          : 'No interview summary provided. Please create a generic goal spec based on common goals people have around health and wellness.',
      },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
    max_tokens: 1024,
  });
  try {
    const json = completion.choices[0].message.content;
    return JSON.parse(json!);
  } catch {
    throw new Error('Goal framing agent did not return valid JSON');
  }
}

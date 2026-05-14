import { OpenAI } from 'openai';
import { GOAL_FRAMING_SYSTEM_PROMPT } from './goalFramingPrompt';

const GOAL_FRAMING_MODEL =
  process.env.GOAL_FRAMING_MODEL || 'openai/gpt-4.1-mini';

function getGoalFramingClient() {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  const openAiApiKey = process.env.OPENAI_API_KEY;

  if (openRouterApiKey) {
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

  if (openAiApiKey) {
    return new OpenAI({ apiKey: openAiApiKey });
  }

  throw new Error(
    'Missing credentials for goal framing. Set OPENROUTER_API_KEY or OPENAI_API_KEY.'
  );
}

export async function runGoalFramingAgent(interviewSummary: any) {
  const client = getGoalFramingClient();
  const completion = await client.chat.completions.create({
    model: GOAL_FRAMING_MODEL,
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
  } catch (e) {
    throw new Error('Goal framing agent did not return valid JSON');
  }
}

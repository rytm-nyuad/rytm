import { OpenAI } from 'openai';
import { GOAL_FRAMING_SYSTEM_PROMPT } from './goalFramingPrompt';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function runGoalFramingAgent(interviewSummary: any) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
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

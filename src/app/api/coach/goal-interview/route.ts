import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { OpenAI } from 'openai';
import { GOAL_INTERVIEW_SYSTEM_PROMPT } from '@/lib/coach/goalInterviewPrompt';

export const dynamic = 'force-dynamic';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function parseJsonObjectFromText(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    const fencedMatch = text.match(/```json\s*([\s\S]*?)\s*```/i);
    const candidate = fencedMatch?.[1] ?? text;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    // Auth gate
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
        },
      }
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { action, answer, history } = await request.json();
    if (!action) {
      return NextResponse.json({ error: 'action is required' }, { status: 400 });
    }

    if (action === 'start') {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: GOAL_INTERVIEW_SYSTEM_PROMPT },
          { role: 'user', content: 'I will be setting a goal, please help me frame it correctly but first greet me and give me the introduction to get started format the answer nicely' },
        ],
        temperature: 0.2,
        max_tokens: 256,
      });
      return NextResponse.json({ question: completion.choices[0].message.content });
    }

    if (action === 'answer') {
      const messages = [
        { role: 'system', content: GOAL_INTERVIEW_SYSTEM_PROMPT },
        ...(history || []).map((msg: any) => ({ role: msg.role, content: msg.content })),
        { role: 'user', content: answer },
      ];
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages,
        temperature: 0.2,
        max_tokens: 512,
      });
      const content = completion.choices[0].message.content;

      if (content && content.includes('"finished": true')) {
        let summary = parseJsonObjectFromText(content);
        if (!summary) {
          summary = { finished: true, parse_error: true, raw_response: content };
        }

        const supabaseAdmin = createSupabaseAdminClient();
        const { error } = await supabaseAdmin.from('goal_interviews1').insert({
          user_id: user.id,
          for_date: new Date().toISOString().split('T')[0],
          summary_json: summary,
        });

        if (error) {
          console.error('Failed storing goal interview summary:', error);
          return NextResponse.json({ error: 'Failed to store goal interview summary' }, { status: 500 });
        }

        return NextResponse.json({ finished: true, summary });
      }

      return NextResponse.json({ question: content, finished: false });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('Goal interview error:', error);
    return NextResponse.json({ error: error.message || 'Failed to handle interview' }, { status: 500 });
  }
}

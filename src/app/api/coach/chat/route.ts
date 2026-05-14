import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getActiveGoal, getTodayPlan } from '@/lib/db/coachPipeline';
import { getJournalLLM } from '@/llm-service/config/llm';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { COACH_SYSTEM_PROMPT } from '@/llm-service/config/prompts';

export const dynamic = 'force-dynamic';

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

    const { content, threadId: clientThreadId } = await request.json();
    if (!content || typeof content !== 'string') {
      return NextResponse.json({ error: 'Missing content' }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const today = new Date().toISOString().split('T')[0];

    // Get or create thread
    let threadId = clientThreadId;
    if (!threadId) {
      const { data: newThread, error: threadError } = await supabaseAdmin
        .from('coach_threads')
        .insert({ user_id: user.id, title: null })
        .select('id')
        .single();
      if (threadError) throw threadError;
      threadId = newThread.id;
    }

    // Load recent message history
    const { data: history } = await supabaseAdmin
      .from('coach_messages')
      .select('role, content')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(20);

    const recentHistory = (history || []).slice(-10);

    // Fetch goal + plan context in parallel
    const [goal, plan] = await Promise.all([
      getActiveGoal(user.id),
      getTodayPlan(user.id, today),
    ]);

    // Build context-aware system prompt
    let systemPrompt = COACH_SYSTEM_PROMPT;
    if (goal) {
      systemPrompt += `\n\nUser's active goal: "${goal.title}" (type: ${goal.goal_type}).`;
    }
    if (plan) {
      const actionList = plan.actions
        .map((a) => `- ${a.title} (${a.domain}, ${a.effort_level} effort)`)
        .join('\n');
      systemPrompt += `\n\nToday's planned actions:\n${actionList}`;
      systemPrompt += `\n\nToday's morning message: "${plan.morning_message.substring(0, 200)}..."`;
    }

    // Build LLM messages
    const messages = [
      new SystemMessage(systemPrompt),
      ...recentHistory.map((msg: { role: string; content: string }) =>
        msg.role === 'user' ? new HumanMessage(msg.content) : new AIMessage(msg.content)
      ),
      new HumanMessage(content),
    ];

    // Call LLM
    const llm = getJournalLLM();
    const response = await llm.invoke(messages);
    const aiContent = response.content.toString();

    // Persist both messages
    await supabaseAdmin.from('coach_messages').insert([
      { thread_id: threadId, user_id: user.id, role: 'user', content },
      { thread_id: threadId, user_id: user.id, role: 'assistant', content: aiContent },
    ]);

    // Update thread timestamp
    await supabaseAdmin
      .from('coach_threads')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', threadId);

    return NextResponse.json({ response: aiContent, threadId });
  } catch (error: any) {
    console.error('Coach chat error:', error);
    return NextResponse.json({ error: error.message || 'Failed to get coach response' }, { status: 500 });
  }
}

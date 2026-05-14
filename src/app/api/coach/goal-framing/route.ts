import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { runGoalFramingAgent } from '@/lib/coach/goalFramingAgent';

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

    const supabaseAdmin = createSupabaseAdminClient();

    // Get latest interview summary
    const { data: interview, error: interviewError } = await supabaseAdmin
      .from('goal_interviews1')
      .select('id, summary_json, for_date')
      .eq('user_id', user.id)
      .order('for_date', { ascending: false })
      .limit(1)
      .single();

    if (interviewError || !interview) {
      return NextResponse.json({ error: 'No interview found. Please complete the goal interview first.' }, { status: 404 });
    }

    // Run goal framing agent
    const goalSpec = await runGoalFramingAgent(interview.summary_json);
    if (!goalSpec) {
      return NextResponse.json({ error: 'Failed to generate goal spec' }, { status: 500 });
    }

    // Deactivate any existing active goals
    await supabaseAdmin
      .from('user_goals1')
      .update({ status: 'inactive' })
      .eq('user_id', user.id)
      .eq('status', 'active');

    // Insert new goal
    const { data: goal, error: goalError } = await supabaseAdmin
      .from('user_goals1')
      .insert({
        user_id: user.id,
        goal_type: goalSpec.goal_type,
        title: goalSpec.goal_title,
        status: 'active',
        priority: goalSpec.priority || 1,
        goal_spec_json: goalSpec,
        defaults_json: goalSpec.defaults_json || {},
        goal_id: interview.id,
      })
      .select()
      .single();

    if (goalError) throw goalError;

    return NextResponse.json({ success: true, goal });
  } catch (error: any) {
    console.error('Goal framing error:', error);
    return NextResponse.json({ error: error.message || 'Failed to frame goal' }, { status: 500 });
  }
}

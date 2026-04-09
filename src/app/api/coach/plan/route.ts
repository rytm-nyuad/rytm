import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getActiveGoal, getTodayPlan } from '@/lib/db/coachPipeline';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
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

    const { searchParams } = new URL(request.url);
    const forDate = searchParams.get('forDate') || new Date().toISOString().split('T')[0];

    const [goal, plan] = await Promise.all([
      getActiveGoal(user.id),
      getTodayPlan(user.id, forDate),
    ]);

    return NextResponse.json({ plan, hasGoal: !!goal, goal });
  } catch (error: any) {
    console.error('Coach plan fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch plan' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getActiveGoal, getTodayPlan } from '@/lib/db/coachPipeline';
import { getCoachReadiness } from '@/lib/coach/readiness';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { formatLocalDate, getCanonicalTimeZone } from '@/lib/time';

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
    let forDate = searchParams.get('forDate');
    if (!forDate) {
      const supabaseAdmin = createSupabaseAdminClient();
      const timezone = await getCanonicalTimeZone(supabaseAdmin, user.id);
      forDate = formatLocalDate(new Date(), timezone);
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const [goal, plan, readiness] = await Promise.all([
      getActiveGoal(user.id),
      getTodayPlan(user.id, forDate),
      getCoachReadiness(supabaseAdmin, user.id, forDate),
    ]);

    return NextResponse.json({ plan, hasGoal: !!goal, goal, readiness });
  } catch (error: any) {
    console.error('Coach plan fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch plan' }, { status: 500 });
  }
}

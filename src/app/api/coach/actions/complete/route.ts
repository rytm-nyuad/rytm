import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { setCoachActionCompletion } from '@/lib/db/coachPipeline';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
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
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const forDate = typeof body?.forDate === 'string' ? body.forDate : null;
    const actionId = typeof body?.actionId === 'string' ? body.actionId : null;
    const completed = Boolean(body?.completed);

    if (!forDate || !actionId) {
      return NextResponse.json(
        { error: 'forDate and actionId are required' },
        { status: 400 }
      );
    }

    const result = await setCoachActionCompletion(
      user.id,
      forDate,
      actionId,
      completed
    );

    return NextResponse.json({
      ok: true,
      actionId,
      user_completed_at: result.user_completed_at,
      actions: result.actions,
    });
  } catch (error: any) {
    console.error('Coach action completion error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to update action completion' },
      { status: 500 }
    );
  }
}

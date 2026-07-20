import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  isValidActionId,
  isValidCoachDate,
  parseActionRatingValue,
  upsertCoachActionRating,
} from '@/lib/db/coachPipeline';

export const dynamic = 'force-dynamic';

const PLAN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const payload = body as Record<string, unknown>;
    const forDate = typeof payload.forDate === 'string' ? payload.forDate.trim() : '';
    const planId = typeof payload.planId === 'string' ? payload.planId.trim() : '';
    const actionId = typeof payload.actionId === 'string' ? payload.actionId.trim() : '';
    const ratingValue = parseActionRatingValue(payload.ratingValue);
    const comment =
      payload.comment === null || payload.comment === undefined
        ? null
        : typeof payload.comment === 'string'
          ? payload.comment
          : null;

    if (!isValidCoachDate(forDate)) {
      return NextResponse.json({ error: 'forDate must be YYYY-MM-DD' }, { status: 400 });
    }
    if (!PLAN_ID_RE.test(planId)) {
      return NextResponse.json({ error: 'Invalid planId' }, { status: 400 });
    }
    if (!isValidActionId(actionId)) {
      return NextResponse.json({ error: 'Invalid actionId' }, { status: 400 });
    }
    if (ratingValue == null) {
      return NextResponse.json(
        { error: 'ratingValue must be an integer from 1 to 5' },
        { status: 400 }
      );
    }
    if (comment != null && typeof comment !== 'string') {
      return NextResponse.json({ error: 'comment must be a string' }, { status: 400 });
    }

    const result = await upsertCoachActionRating(
      user.id,
      forDate,
      planId,
      actionId,
      ratingValue,
      comment
    );

    return NextResponse.json({
      ok: true,
      actionId,
      rating: result.rating,
      actions: result.actions,
    });
  } catch (error: unknown) {
    console.error('Coach action rating error:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to save action rating';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

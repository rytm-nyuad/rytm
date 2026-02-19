// ============================================================
// POST /api/process-meal
// ============================================================
// Processes a single meal through the v1.0 pipeline.
//
// Request body: { meal_id: string }
// Response:     { success, run_id, skipped, error? }
//
// Auth: requires authenticated user (meal must belong to them)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { processMeal } from '@/lib/meal-processing';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    // Auth check
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse body
    const body = await req.json();
    const { meal_id } = body;

    if (!meal_id || typeof meal_id !== 'string') {
      return NextResponse.json({ error: 'meal_id is required' }, { status: 400 });
    }

    // Verify the meal belongs to this user
    const { data: meal, error: mealErr } = await supabase
      .from('meal_logs')
      .select('id, user_id')
      .eq('id', meal_id)
      .single();

    if (mealErr || !meal) {
      return NextResponse.json({ error: 'Meal not found' }, { status: 404 });
    }

    if (meal.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Process
    const result = await processMeal(meal_id, supabase);

    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[process-meal] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

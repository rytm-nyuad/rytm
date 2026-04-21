// ============================================================
// POST /api/process-backfill
// ============================================================
// Triggers meal processing for all unprocessed meals within
// a given local-date range for the authenticated user.
//
// Request body: { days?: number }  (default: 14)
// Response:     { total, success, skipped, failed, results[] }
//
// Auth: requires authenticated user
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { processMeal, PIPELINE_VERSION } from '@/lib/meal-processing';
import { formatLocalDate, getCanonicalTimeZone, shiftLocalDate } from '@/lib/time';

export const dynamic = 'force-dynamic';

const DELAY_MS = 200;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    const body = await req.json().catch(() => ({}));
    const days = typeof body.days === 'number' ? body.days : 14;

    const timezone = await getCanonicalTimeZone(supabase, user.id);
    const todayLocalDate = formatLocalDate(new Date(), timezone);
    const cutoffLocalDate = shiftLocalDate(todayLocalDate, -days);

    const { data: meals, error: fetchErr } = await supabase
      .from('meal_logs')
      .select('id')
      .eq('user_id', user.id)
      .gte('meal_local_date', cutoffLocalDate)
      .order('meal_local_date', { ascending: true })
      .order('meal_datetime', { ascending: true, nullsFirst: false });

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    if (!meals || meals.length === 0) {
      return NextResponse.json({
        total: 0,
        success: 0,
        skipped: 0,
        failed: 0,
        results: [],
      });
    }

    // Filter already-processed
    const mealIds = meals.map((m) => m.id);
    const { data: existingRuns } = await supabase
      .from('meal_processing_runs')
      .select('meal_id')
      .in('meal_id', mealIds)
      .eq('pipeline_version', PIPELINE_VERSION);

    const processedSet = new Set((existingRuns ?? []).map((r: any) => r.meal_id));
    const toProcess = mealIds.filter((id) => !processedSet.has(id));

    // Process each meal
    const results: Array<{ meal_id: string; success: boolean; skipped: boolean; error?: string }> = [];
    let successCount = 0;
    let skippedCount = processedSet.size;
    let failedCount = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const mealId = toProcess[i];
      try {
        const result = await processMeal(mealId, supabase);
        results.push({
          meal_id: mealId,
          success: result.success,
          skipped: result.skipped,
          error: result.error,
        });
        if (result.skipped) skippedCount++;
        else if (result.success) successCount++;
        else failedCount++;
      } catch (err: any) {
        results.push({ meal_id: mealId, success: false, skipped: false, error: err.message });
        failedCount++;
      }

      if (i < toProcess.length - 1) await delay(DELAY_MS);
    }

    return NextResponse.json({
      total: meals.length,
      success: successCount,
      skipped: skippedCount,
      failed: failedCount,
      results,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[process-backfill] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

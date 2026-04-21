// ============================================================
// RYTM v1 – Nightly Meal Processing Cron Job
// ============================================================
// Runs at 4:00 AM daily (via GitHub Actions or system cron).
// Picks up all meals from the recent local-date window that have not been
// processed by pipeline v1.0, and processes them.
//
// Usage:
//   npm run meal:nightly
//
// Environment:
//   OPENAI_API_KEY
//   SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const PIPELINE_VERSION = 'v1.0';
const DELAY_MS = 200;

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`\n🌙 RYTM Nightly Meal Processing (v1.0)`);
  console.log(`   Time: ${new Date().toISOString()}\n`);

  const supabase = getServiceClient();
  const cutoffLocalDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Fetch meals from a broad recent local-date window that have NOT been processed
  const { data: meals, error } = await supabase
    .from('meal_logs')
    .select('id')
    .gte('meal_local_date', cutoffLocalDate)
    .not(
      'id',
      'in',
      `(select meal_id from meal_processing_runs where pipeline_version = '${PIPELINE_VERSION}')`,
    );

  // Fallback: if the .not() subquery isn't supported by PostgREST, do it manually
  let unprocessedIds: string[];

  if (error) {
    console.log('   Using fallback query strategy...');

    const { data: allMeals } = await supabase
      .from('meal_logs')
      .select('id')
      .gte('meal_local_date', cutoffLocalDate);

    if (!allMeals || allMeals.length === 0) {
      console.log('✅ No meals in the recent local-date window. Done.');
      process.exit(0);
    }

    const ids = allMeals.map((m: any) => m.id);
    const { data: existingRuns } = await supabase
      .from('meal_processing_runs')
      .select('meal_id')
      .in('meal_id', ids)
      .eq('pipeline_version', PIPELINE_VERSION);

    const processedSet = new Set((existingRuns ?? []).map((r: any) => r.meal_id));
    unprocessedIds = ids.filter((id: string) => !processedSet.has(id));
  } else {
    unprocessedIds = (meals ?? []).map((m: any) => m.id);
  }

  console.log(`   Unprocessed meals: ${unprocessedIds.length}\n`);

  if (unprocessedIds.length === 0) {
    console.log('✅ All meals already processed. Done.');
    process.exit(0);
  }

  // Dynamically import processMeal
  let processMealFn: (mealId: string, sb: any) => Promise<any>;
  try {
    const mod = await import('../src/lib/meal-processing/process-meal');
    processMealFn = mod.processMeal;
  } catch {
    console.error('❌ Could not import processMeal.');
    process.exit(1);
  }

  let success = 0;
  let failed = 0;

  for (let i = 0; i < unprocessedIds.length; i++) {
    const mealId = unprocessedIds[i];
    const prefix = `[${i + 1}/${unprocessedIds.length}]`;

    try {
      const result = await processMealFn(mealId, supabase);
      if (result.success) {
        console.log(`${prefix} ✅ ${mealId}`);
        success++;
      } else {
        console.error(`${prefix} ❌ ${mealId}: ${result.error}`);
        failed++;
      }
    } catch (err: any) {
      console.error(`${prefix} ❌ ${mealId}: ${err.message}`);
      failed++;
    }

    if (i < unprocessedIds.length - 1) await delay(DELAY_MS);
  }

  console.log(`\n── Nightly Summary ──────────────────────`);
  console.log(`   ✅ Success: ${success}`);
  console.log(`   ❌ Failed:  ${failed}`);
  console.log(`   Total:      ${unprocessedIds.length}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

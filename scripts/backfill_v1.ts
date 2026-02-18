// ============================================================
// RYTM v1 – Backfill Script for Meal Processing
// ============================================================
// Processes all meals from the past 14 days that have not yet
// been processed by pipeline v1.0.
//
// Usage (from project root):
//   npm run meal:backfill
//   npm run meal:backfill -- --days=7
//   npm run meal:backfill -- --dry-run
//
// Requirements:
//   - OPENAI_API_KEY          (or set in .env / .env.local)
//   - SUPABASE_SERVICE_ROLE_KEY
//   - NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
//
// NOTE: This script uses relative imports because ts-node
//       does not resolve the @/ path alias.
// ============================================================

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config(); // fallback .env

import { createClient } from '@supabase/supabase-js';

// ---- Inline pipeline constants (avoid @/ alias in scripts) ----
const PIPELINE_VERSION = 'v1.0';
const DEFAULT_DAYS = 14;
const DELAY_MS = 200; // ms between API calls to avoid rate spikes

// ---- Parse CLI args ----
function parseArgs() {
  const args = process.argv.slice(2);
  let days = DEFAULT_DAYS;
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith('--days=')) {
      days = parseInt(arg.split('=')[1], 10);
    }
    if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return { days, dryRun };
}

// ---- Supabase service client ----
function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

// ---- Delay helper ----
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- Main ----
async function main() {
  const { days, dryRun } = parseArgs();
  console.log(`\n🍽  RYTM Meal Processing Backfill (v1.0)`);
  console.log(`   Days back: ${days}`);
  console.log(`   Dry run: ${dryRun}\n`);

  const supabase = getServiceClient();

  // Fetch unprocessed meals within the window
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const { data: meals, error: fetchErr } = await supabase
    .from('meal_logs')
    .select('id, user_id, description, photo_url, meal_datetime')
    .gte('meal_datetime', cutoff.toISOString())
    .order('meal_datetime', { ascending: true });

  if (fetchErr) {
    console.error('❌ Failed to fetch meals:', fetchErr.message);
    process.exit(1);
  }

  if (!meals || meals.length === 0) {
    console.log('✅ No meals found in the window. Nothing to process.');
    process.exit(0);
  }

  // Find which meals already have a v1.0 run
  const mealIds = meals.map((m: any) => m.id);
  const { data: existingRuns } = await supabase
    .from('meal_processing_runs')
    .select('meal_id')
    .in('meal_id', mealIds)
    .eq('pipeline_version', PIPELINE_VERSION);

  const processedSet = new Set((existingRuns ?? []).map((r: any) => r.meal_id));
  const toProcess = meals.filter((m: any) => !processedSet.has(m.id));

  console.log(`   Total meals in window: ${meals.length}`);
  console.log(`   Already processed:     ${processedSet.size}`);
  console.log(`   To process:            ${toProcess.length}\n`);

  if (dryRun) {
    console.log('🔍 Dry run — listing meals that would be processed:\n');
    for (const m of toProcess) {
      console.log(`   ${m.id}  ${m.meal_datetime}  ${(m.description ?? '').slice(0, 60)}`);
    }
    process.exit(0);
  }

  // Dynamically import the processMeal function
  // We use dynamic import to handle the @/ alias issue — the compiled module
  // is loaded at runtime after ts-node resolves it via tsconfig-paths or
  // we use relative path.
  let processMealFn: (mealId: string, sb: any) => Promise<any>;
  try {
    // Try direct relative import first
    const mod = await import('../src/lib/meal-processing/process-meal');
    processMealFn = mod.processMeal;
  } catch {
    console.error('❌ Could not import processMeal. Make sure the module exists.');
    process.exit(1);
  }

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const meal = toProcess[i];
    const prefix = `[${i + 1}/${toProcess.length}]`;

    try {
      const result = await processMealFn(meal.id, supabase);
      if (result.skipped) {
        console.log(`${prefix} ⏭  Skipped (already exists): ${meal.id}`);
        skipped++;
      } else if (result.success) {
        console.log(`${prefix} ✅ Processed: ${meal.id}  run=${result.run_id}`);
        success++;
      } else {
        console.error(`${prefix} ❌ Failed: ${meal.id}  ${result.error}`);
        failed++;
      }
    } catch (err: any) {
      console.error(`${prefix} ❌ Error: ${meal.id}  ${err.message}`);
      failed++;
    }

    // Rate limit delay
    if (i < toProcess.length - 1) {
      await delay(DELAY_MS);
    }
  }

  console.log(`\n── Summary ──────────────────────────────`);
  console.log(`   ✅ Success:  ${success}`);
  console.log(`   ⏭  Skipped:  ${skipped}`);
  console.log(`   ❌ Failed:   ${failed}`);
  console.log(`   Total:       ${toProcess.length}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

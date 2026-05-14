// ============================================================
// RYTM v1 – Test Single Meal Processing
// ============================================================
// Quick test script to process one specific meal.
//
// Usage:
//   npm run meal:test <meal-id>
//   # or
//   tsx scripts/test_single_meal.ts <meal-id>
//
// Example:
//   npm run meal:test 12345678-90ab-cdef-1234-567890abcdef
// ============================================================

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const PIPELINE_VERSION = 'v1.0';

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function main() {
  const mealId = process.argv[2];

  if (!mealId) {
    console.error('\n❌ Usage: npm run meal:test <meal-id>\n');
    process.exit(1);
  }

  console.log(`\n🧪 Testing meal processing for: ${mealId}\n`);

  const supabase = getServiceClient();

  // Verify meal exists
  const { data: meal, error: mealErr } = await supabase
    .from('meal_logs')
    .select('id, user_id, description, photo_url, meal_local_date, meal_datetime')
    .eq('id', mealId)
    .single();

  if (mealErr || !meal) {
    console.error(`❌ Meal not found: ${mealErr?.message}`);
    process.exit(1);
  }

  console.log(`   Meal local date: ${meal.meal_local_date}`);
  console.log(`   Meal datetime:   ${meal.meal_datetime ?? 'time-not-set'}`);
  console.log(`   User ID:       ${meal.user_id}`);
  console.log(`   Description:   ${meal.description?.slice(0, 60) ?? '(none)'}...`);
  console.log(`   Has text:      ${!!meal.description}`);
  console.log(`   Has photo:     ${!!meal.photo_url}`);

  // Resolve signed URL preview (just to show whether resolution works)
  if (meal.photo_url) {
    try {
      const { resolveMealPhotoForVision } = await import('../src/lib/meal-processing/resolve-photo');
      const resolved = await resolveMealPhotoForVision({
        supabaseAdmin: supabase,
        bucket: 'meal-photos',
        photoUrl: meal.photo_url,
        userId: meal.user_id,
      });
      console.log(`   Signed URL:    ${resolved.signedUrl ? '✅ resolved' : `❌ ${resolved.reason ?? 'failed'}`}`);
      if (resolved.signedUrl) {
        console.log(`   [DEBUG URL]:   ${resolved.signedUrl}`);
      }
    } catch (err) {
      console.log(`   Signed URL:    ⚠️ could not test (${err instanceof Error ? err.message : 'unknown error'})`);
    }
  }

  // Check if already processed
  const { data: existingRun } = await supabase
    .from('meal_processing_runs')
    .select('id, status, confidence_score, processed_at')
    .eq('meal_id', mealId)
    .eq('pipeline_version', PIPELINE_VERSION)
    .maybeSingle();

  if (existingRun) {
    console.log(`\n   ⚠️  Already processed (status: ${existingRun.status})`);
    console.log(`   Run ID:     ${existingRun.id}`);
    console.log(`   Confidence: ${existingRun.confidence_score}`);
    console.log(`   Processed:  ${existingRun.processed_at}`);
    console.log(`\n   To reprocess, delete run first:`);
    console.log(`   DELETE FROM meal_processing_runs WHERE id = '${existingRun.id}';\n`);
    process.exit(0);
  }

  // Dynamic import
  let processMealFn: (mealId: string, sb: any) => Promise<any>;
  try {
    const mod = await import('../src/lib/meal-processing/process-meal');
    processMealFn = mod.processMeal;
  } catch {
    console.error('❌ Could not import processMeal.');
    process.exit(1);
  }

  console.log(`\n   Processing...\n`);

  try {
    const result = await processMealFn(mealId, supabase);

    if (result.success) {
      console.log(`✅ Success! Run ID: ${result.run_id}\n`);

      // Fetch and display results
      const { data: run } = await supabase
        .from('meal_processing_runs')
        .select('totals, confidence_score, confidence_reasons, improvement_tips, llm_comment, cost_usd, tokens_in, tokens_out')
        .eq('id', result.run_id)
        .single();

      if (run) {
        console.log(`── Results ────────────────────────────────`);
        console.log(`   Totals:       ${JSON.stringify(run.totals, null, 2)}`);
        console.log(`   Confidence:   ${run.confidence_score}/100`);
        console.log(`   Reasons:      ${JSON.stringify(run.confidence_reasons)}`);
        console.log(`   Tips:         ${JSON.stringify(run.improvement_tips)}`);
        console.log(`   LLM comment:  ${run.llm_comment}`);
        console.log(`   Cost:         $${run.cost_usd}`);
        console.log(`   Tokens:       ${run.tokens_in} in / ${run.tokens_out} out\n`);
      }
    } else {
      console.error(`❌ Failed: ${result.error}\n`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`❌ Error: ${err.message}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

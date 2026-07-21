// ============================================================
// RYTM v1 – Core Meal Processing Pipeline
// ============================================================
// Entry point: processMeal(mealId, supabase)
//
// Pipeline steps:
//   1. Fetch meal from meal_logs
//   2. Idempotency check (meal_id + pipeline_version)
//   3. Insert queued run into meal_processing_runs
//   4. Call extraction model  (gpt-4.1-nano)
//   5. Check food_cache_v1 for cached macros
//   6. Call estimation model  (gpt-4.1-mini) for uncached items
//   7. Write items to meal_items_v1
//   8. Update food_cache_v1 with new estimates
//   9. Finalize run row (totals, confidence, tokens, cost, status)
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ProcessMealResult,
  ExtractedItem,
  EstimatedItem,
  FoodCacheV1,
  MealTotals,
  TokenUsage,
} from '@/types/meal-processing';
import {
  PIPELINE_VERSION,
  MODELS,
  callExtractionModel,
  callEstimationModel,
  calculateCost,
} from './openai';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveMealPhotoForVision } from './resolve-photo';

/**
 * Helper: Check if description contains explicit nutrition numbers.
 * Returns extracted numbers if found (for validation).
 */
function detectExplicitNutrition(description: string | null): {
  hasExplicitNumbers: boolean;
  kcal?: number;
  protein?: number;
} | null {
  if (!description) return null;

  // Match patterns like "292 kcal", "55 g protein", "55g protein", etc.
  const kcalMatch = description.match(/(\d+)\s*(?:kcal|calories)/i);
  const proteinMatch = description.match(/(\d+)\s*g?\s*protein/i);

  if (kcalMatch || proteinMatch) {
    return {
      hasExplicitNumbers: true,
      kcal: kcalMatch ? parseInt(kcalMatch[1], 10) : undefined,
      protein: proteinMatch ? parseInt(proteinMatch[1], 10) : undefined,
    };
  }

  return null;
}

/**
 * Process a single meal through the v1.0 pipeline.
 *
 * @param mealId  - UUID of the meal_logs row
 * @param supabase - Supabase client (service-role for scripts, user-scoped for API)
 * @returns ProcessMealResult
 */
export async function processMeal(
  mealId: string,
  supabase: SupabaseClient,
): Promise<ProcessMealResult> {
  // ── 1. Fetch meal ─────────────────────────────────────────
  const { data: meal, error: mealErr } = await supabase
    .from('meal_logs')
    .select('id, user_id, description, photo_url, meal_datetime')
    .eq('id', mealId)
    .single();

  if (mealErr || !meal) {
    return { success: false, run_id: null, skipped: false, error: `Meal not found: ${mealErr?.message}` };
  }

  // ── 2. Idempotency check ──────────────────────────────────
  // Only a genuinely completed run should be skipped. A row stuck at
  // 'failed' / 'queued' / 'processing' (e.g. from a crashed or errored prior
  // attempt) is not "already processed" — it must be retried, or it would be
  // silently and permanently stuck.
  const { data: existingRun } = await supabase
    .from('meal_processing_runs')
    .select('id, status')
    .eq('meal_id', mealId)
    .eq('pipeline_version', PIPELINE_VERSION)
    .maybeSingle();

  if (existingRun?.status === 'success') {
    return { success: true, run_id: existingRun.id, skipped: true };
  }

  // ── 3. Create or reset the run row ────────────────────────
  const inputModes: string[] = [];
  if (meal.description) inputModes.push('text');
  if (meal.photo_url) inputModes.push('image');

  let runId: string;

  if (existingRun) {
    // Retry in place — (meal_id, pipeline_version) is unique, so a fresh
    // insert would just collide with this stale row.
    const { error: resetErr } = await supabase
      .from('meal_processing_runs')
      .update({ status: 'queued', input_modes: inputModes, error: null })
      .eq('id', existingRun.id);

    if (resetErr) {
      return { success: false, run_id: existingRun.id, skipped: false, error: `Reset run failed: ${resetErr.message}` };
    }
    runId = existingRun.id;
  } else {
    const { data: run, error: insertErr } = await supabase
      .from('meal_processing_runs')
      .insert({
        meal_id: mealId,
        user_id: meal.user_id,
        pipeline_version: PIPELINE_VERSION,
        status: 'queued',
        input_modes: inputModes,
      })
      .select('id')
      .single();

    if (insertErr || !run) {
      // Unique constraint race condition — a concurrent call already claimed this meal.
      if (insertErr?.code === '23505') {
        return { success: true, run_id: null, skipped: true };
      }
      return { success: false, run_id: null, skipped: false, error: `Insert run failed: ${insertErr?.message}` };
    }
    runId = run.id;
  }

  try {
    // Mark as processing
    await supabase
      .from('meal_processing_runs')
      .update({ status: 'processing' })
      .eq('id', runId);

    // ── 4. Extraction ─────────────────────────────────────────
    const hasText = !!meal.description;
    const hasImage = !!meal.photo_url;

    // Guard: must have at least one input
    if (!hasText && !hasImage) {
      throw new Error('Meal has neither description nor photo — nothing to process');
    }

    // Resolve signed URL for image (if present)
    let imageUrl: string | null = null;
    if (hasImage) {
      const adminClient = createSupabaseAdminClient();
      const resolved = await resolveMealPhotoForVision({
        supabaseAdmin: adminClient,
        bucket: 'meal-photos',
        photoUrl: meal.photo_url!,
        userId: meal.user_id,
      });
      if (resolved.signedUrl) {
        imageUrl = resolved.signedUrl;
      } else {
        console.warn(
          `[process-meal] Could not resolve photo for meal ${mealId}: ${resolved.reason ?? 'unknown'}`,
        );
      }
    }

    const extraction = await callExtractionModel({
      description: meal.description ?? null,
      imageUrl,
      hasText,
      hasImage,
    });
    const extractedItems = extraction.data.items;

    // Accumulate token usage
    const totalUsage: TokenUsage = { ...extraction.usage };

    // ── 5. Cache lookup ─────────────────────────────────────
    const normalizedNames = extractedItems.map((i) => i.name_normalized);
    const { data: cachedRows } = await supabase
      .from('food_cache_v1')
      .select('*')
      .in('name_normalized', normalizedNames);

    const cacheMap = new Map<string, FoodCacheV1>();
    if (cachedRows) {
      for (const row of cachedRows) {
        cacheMap.set(row.name_normalized, row as FoodCacheV1);
      }
    }

    // ── 6. Estimation ───────────────────────────────────────
    const cacheCoveragePct =
      extractedItems.length > 0
        ? Math.round((cacheMap.size / extractedItems.length) * 100)
        : 0;

    // imageUsed: true only if we successfully resolved and sent the image to extraction
    const imageUsed = !!imageUrl;

    // Check if description contains explicit nutrition numbers (for validation)
    const explicitNutrition = detectExplicitNutrition(meal.description);

    let estimation = await callEstimationModel({
      items: extractedItems,
      description: meal.description ?? null,
      hasText,
      hasImage,
      imageUsed,
      cacheCoveragePct,
    });
    totalUsage.prompt_tokens += estimation.usage.prompt_tokens;
    totalUsage.completion_tokens += estimation.usage.completion_tokens;

    // Validate: if user provided explicit numbers, check if model respected them
    if (explicitNutrition?.hasExplicitNumbers) {
      const totals = estimation.data.totals;
      let needsRetry = false;
      const errors: string[] = [];

      if (explicitNutrition.kcal) {
        const diff = Math.abs(totals.kcal - explicitNutrition.kcal);
        const pct = (diff / explicitNutrition.kcal) * 100;
        if (pct > 3) {
          needsRetry = true;
          errors.push(`kcal: expected ${explicitNutrition.kcal}, got ${totals.kcal} (${pct.toFixed(1)}% diff)`);
        }
      }

      if (explicitNutrition.protein) {
        const diff = Math.abs(totals.protein_g - explicitNutrition.protein);
        const pct = (diff / explicitNutrition.protein) * 100;
        if (pct > 3) {
          needsRetry = true;
          errors.push(`protein: expected ${explicitNutrition.protein}g, got ${totals.protein_g}g (${pct.toFixed(1)}% diff)`);
        }
      }

      if (needsRetry) {
        console.warn(
          `[meal-processing] Model did not respect user-provided numbers for meal ${mealId}. Errors: ${errors.join(', ')}. Retrying once...`,
        );

        // Retry with explicit reminder
        const retryEstimation = await callEstimationModel({
          items: extractedItems,
          description: `CRITICAL: DO NOT OVERRIDE USER NUMBERS.\n\n${meal.description}`,
          hasText,
          hasImage,
          imageUsed,
          cacheCoveragePct,
        });
        totalUsage.prompt_tokens += retryEstimation.usage.prompt_tokens;
        totalUsage.completion_tokens += retryEstimation.usage.completion_tokens;

        // Use retry result
        estimation = retryEstimation;

        // Final validation
        const retryTotals = estimation.data.totals;
        if (explicitNutrition.kcal && Math.abs(retryTotals.kcal - explicitNutrition.kcal) > explicitNutrition.kcal * 0.03) {
          console.error(
            `[meal-processing] Retry still failed for meal ${mealId}. Expected kcal ${explicitNutrition.kcal}, got ${retryTotals.kcal}`,
          );
        }
      }
    }

    // Debug: log confidence scoring breakdown if present
    if (estimation.data.scoring_breakdown) {
      console.log(`[meal-processing] Confidence scoring breakdown for meal ${mealId}:`, 
        JSON.stringify(estimation.data.scoring_breakdown, null, 2));
    }

    // Debug: log source of truth if present
    if (estimation.data.source_of_truth) {
      console.log(`[meal-processing] Source of truth for meal ${mealId}:`,
        JSON.stringify(estimation.data.source_of_truth, null, 2));
    }

    const estimatedMap = new Map<string, EstimatedItem>();
    for (const ei of estimation.data.items) {
      estimatedMap.set(ei.name_normalized, ei);
    }

    // ── 7. Write items to meal_items_v1 ─────────────────────
    const itemRows = extractedItems.map((ext: ExtractedItem) => {
      const cached = cacheMap.get(ext.name_normalized);
      const estimated = estimatedMap.get(ext.name_normalized);
      const source = cached ? 'cache' : 'llm';

      // Prefer cache if available, otherwise use LLM estimate
      const macros = cached ?? estimated;

      return {
        run_id: runId,
        name_raw: ext.name,
        name_normalized: ext.name_normalized,
        portion_text: ext.portion_text,
        qty: ext.qty,
        unit: ext.unit,
        item_confidence: ext.item_confidence,
        kcal: macros?.kcal ?? null,
        protein_g: macros?.protein_g ?? null,
        carbs_g: macros?.carbs_g ?? null,
        fat_g: macros?.fat_g ?? null,
        sugar_g: macros?.sugar_g ?? null,
        caffeine_mg: macros?.caffeine_mg ?? null,
        source,
      };
    });

    if (itemRows.length > 0) {
      const { error: itemsErr } = await supabase
        .from('meal_items_v1')
        .insert(itemRows);

      if (itemsErr) {
        throw new Error(`Failed to insert meal items: ${itemsErr.message}`);
      }
    }

    // ── 8. Update food cache with new LLM estimates ────────
    const newCacheEntries = extractedItems
      .filter((ext) => !cacheMap.has(ext.name_normalized))
      .map((ext) => {
        const estimated = estimatedMap.get(ext.name_normalized);
        if (!estimated) return null;
        return {
          name_normalized: ext.name_normalized,
          macros_basis: ext.portion_text ?? 'average serving',
          kcal: estimated.kcal,
          protein_g: estimated.protein_g,
          carbs_g: estimated.carbs_g,
          fat_g: estimated.fat_g,
          sugar_g: estimated.sugar_g,
          caffeine_mg: estimated.caffeine_mg,
          serving_notes: ext.portion_text,
          source: 'llm',
        };
      })
      .filter(Boolean);

    if (newCacheEntries.length > 0) {
      await supabase
        .from('food_cache_v1')
        .upsert(newCacheEntries, { onConflict: 'name_normalized' });
    }

    // ── 9. Finalize run ─────────────────────────────────────
    const totals: MealTotals = estimation.data.totals;
    const extractionCost = calculateCost(MODELS.extraction, extraction.usage);
    const estimationCost = calculateCost(MODELS.estimation, estimation.usage);
    const totalCost = Math.round((extractionCost + estimationCost) * 1_000_000) / 1_000_000;

    await supabase
      .from('meal_processing_runs')
      .update({
        status: 'success',
        model: `${MODELS.extraction}+${MODELS.estimation}`,
        totals,
        confidence_score: estimation.data.confidence_score,
        confidence_reasons: estimation.data.confidence_reasons,
        improvement_tips: estimation.data.improvement_tips,
        llm_comment: estimation.data.llm_comment,
        tokens_in: totalUsage.prompt_tokens,
        tokens_out: totalUsage.completion_tokens,
        cost_usd: totalCost,
        processed_at: new Date().toISOString(),
      })
      .eq('id', runId);

    return { success: true, run_id: runId, skipped: false };
  } catch (err: unknown) {
    // ── Error handling ──────────────────────────────────────
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from('meal_processing_runs')
      .update({ status: 'failed', error: message })
      .eq('id', runId);

    return { success: false, run_id: runId, skipped: false, error: message };
  }
}

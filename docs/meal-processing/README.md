# RYTM v1 – Meal Processing System

## Overview

A versioned, idempotent meal processing pipeline that reads from `meal_logs`, extracts food items, estimates macronutrients via OpenAI, and stores structured results. Pipeline version: **`v1.0`**.

**What it produces per meal:**
- `kcal`, `protein_g`, `carbs_g`, `fat_g`, `sugar_g`
- `confidence_score` (0–100) with `confidence_reasons`
- `improvement_tips`, `llm_comment`
- Per-item breakdown in `meal_items_v1`
- Cached food macros in `food_cache_v1`

**Nothing is written back** to `meal_logs.calories / protein / carbs / fats`.

---

## Files Created

| # | File | Purpose |
|---|------|---------|
| 1 | `supabase/meal_processing_schema.sql` | Database migration (3 tables + RLS) |
| 2 | `src/types/meal-processing.ts` | TypeScript type definitions |
| 3 | `src/lib/meal-processing/openai.ts` | OpenAI utility wrapper (prompts, API calls, cost calc) |
| 4 | `src/lib/meal-processing/process-meal.ts` | Core `processMeal()` function |
| 5 | `src/lib/meal-processing/index.ts` | Module barrel export |
| 6 | `scripts/test_single_meal.ts` | Test script — `npm run meal:test <meal-id>` |
| 7 | `scripts/backfill_v1.ts` | Backfill script — `npm run meal:backfill` (supports `--days=N`, `--dry-run`) |
| 8 | `scripts/nightly_meal_processing.ts` | Nightly cron script — `npm run meal:nightly` |
| 9 | `.github/workflows/nightly-meal-processing.yml` | GitHub Actions workflow (4 AM UAE daily) |
| 10 | `src/app/api/process-meal/route.ts` | API route `POST /api/process-meal` |
| 11 | `src/app/api/process-backfill/route.ts` | API route `POST /api/process-backfill` |

**Modified:**
- `package.json` — added `meal:backfill`, `meal:nightly`, `meal:test` npm scripts, added `openai` and `tsx` dependencies

---

## OpenAI Models Used

| Step | Model | Purpose | Temperature |
|------|-------|---------|-------------|
| Extraction | `gpt-4.1-nano` | Parse food items from description | 0.2 |
| Estimation | `gpt-4.1-mini` | Estimate macros + confidence scoring | 0.3 |

Both use **strict JSON mode** (`response_format: { type: 'json_object' }`).

**Where each model is called:**
- `src/lib/meal-processing/openai.ts` → `callExtractionModel()` uses `gpt-4.1-nano`
- `src/lib/meal-processing/openai.ts` → `callEstimationModel()` uses `gpt-4.1-mini`

---

## Database Tables

### 1. `meal_processing_runs`
One row per (meal, pipeline_version). Stores totals, confidence, tokens, cost, status.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid (PK) | Auto-generated |
| `meal_id` | uuid (FK → meal_logs) | Cascading delete |
| `user_id` | uuid | For RLS + queries |
| `pipeline_version` | text | Always `'v1.0'` |
| `status` | text | `queued` → `processing` → `success` / `failed` |
| `model` | text | e.g. `gpt-4.1-nano+gpt-4.1-mini` |
| `input_modes` | text[] | `['text']`, `['image']`, or `['text','image']` |
| `confidence_score` | integer | 0–100 |
| `confidence_reasons` | jsonb | Array of strings |
| `llm_comment` | text | Free-form LLM observation |
| `improvement_tips` | jsonb | Array of strings |
| `totals` | jsonb | `{ kcal, protein_g, carbs_g, fat_g, sugar_g }` |
| `tokens_in` / `tokens_out` | integer | Total across both calls |
| `cost_usd` | numeric | Calculated from token counts |
| `error` | text | Error message on failure |
| `processed_at` | timestamptz | Set on success |

**Unique constraint:** `(meal_id, pipeline_version)` — ensures idempotency.

### 2. `meal_items_v1`
Per-item breakdown for each run.

| Column | Type | Notes |
|--------|------|-------|
| `run_id` | uuid (FK → meal_processing_runs) | Cascading delete |
| `name_raw` | text | Original name from extraction |
| `name_normalized` | text | Lowercase simplified for cache lookup |
| `portion_text` | text | Portion info if available |
| `qty` / `unit` | numeric / text | Structured portion |
| `item_confidence` | numeric | 0–1 per item |
| `kcal` / `protein_g` / `carbs_g` / `fat_g` / `sugar_g` | numeric | Macros |
| `source` | text | `'cache'` or `'llm'` |

### 3. `food_cache_v1`
Shared macro lookup keyed by `name_normalized`. Populated automatically on first LLM estimation.

### RLS Policies
- `meal_processing_runs` — user can only access rows where `user_id = auth.uid()`
- `meal_items_v1` — user can only access items whose parent run belongs to them
- `food_cache_v1` — read-only for all authenticated users

---

## Pipeline Flow

```
meal_logs row
  │
  ├─ 1. Fetch meal (id, description, photo_url)
  ├─ 2. Idempotency check: (meal_id, 'v1.0') exists? → skip
  ├─ 3. Insert run row (status='queued')
  ├─ 4. Set status='processing'
  ├─ 5. Call gpt-4.1-nano → extract food items
  ├─ 6. Check food_cache_v1 for cached macros
  ├─ 7. Call gpt-4.1-mini → estimate macros + confidence
  ├─ 8. Insert items into meal_items_v1
  ├─ 9. Upsert new items into food_cache_v1
  └─ 10. Update run → status='success', totals, confidence, tokens, cost
         (on error → status='failed', error message)
```

---

## What You Need To Do

### Step 1: Run the SQL Migration

Go to your **Supabase Dashboard → SQL Editor** and run the contents of:

```
supabase/meal_processing_schema.sql
```

This creates all 3 tables, indexes, and RLS policies. It's fully idempotent (`CREATE TABLE IF NOT EXISTS`).

### Step 2: Verify Environment Variables

Make sure these are set in `.env.local` (already present for `OPENAI_API_KEY` and Supabase):

```env
OPENAI_API_KEY=sk-...
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # needed for scripts only
```

### Step 3: Add GitHub Secrets

For the nightly cron job, add `OPENAI_API_KEY` to your GitHub repository secrets:

**Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Value |
|-------------|-------|
| `OPENAI_API_KEY` | Your OpenAI API key |

(`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` should already exist from the streak report workflow.)

### Step 4: Test on a Single Meal (RECOMMENDED)

Before running the full backfill, test the pipeline on one meal:

```bash
# First, get a meal_id from your database (run in Supabase SQL Editor):
# SELECT id, user_id, description, meal_datetime 
# FROM meal_logs 
# WHERE meal_datetime >= now() - interval '7 days'
# ORDER BY meal_datetime DESC
# LIMIT 5;

# Copy a meal ID, then run:
npm run meal:test <meal-id>

# Example:
# npm run meal:test 12345678-90ab-cdef-1234-567890abcdef
```

**Expected output:**
```
🧪 Testing meal processing for: 12345678...
   Meal datetime: 2026-02-15T12:30:00Z
   User ID:       abcd-1234...
   Description:   Grilled chicken with rice and vegetables...
   Has photo:     true
   
   Processing...

✅ Success! Run ID: xyz-5678...

── Results ────────────────────────────────
   Totals:       {
     "kcal": 450,
     "protein_g": 35,
     "carbs_g": 40,
     "fat_g": 12,
     "sugar_g": 5
   }
   Confidence:   75/100
   Reasons:      ["Image provided", "Portion info present"]
   Tips:         ["Add more detail about portion sizes"]
   LLM comment:  Balanced meal with good protein content
   Cost:         $0.000123
   Tokens:       150 in / 80 out
```

The test script will:
- ✅ Verify meal exists
- ✅ Check if already processed (and tell you how to reprocess)
- ✅ Run the full pipeline
- ✅ Display complete results with costs

### Step 5: Run the Backfill

**RECOMMENDED: Test on a small sample first!**

```bash
# Option A: Test with the API on a single meal (requires dev server running)
npm run dev
# Then in another terminal, get a meal_id and call:
# curl -X POST http://localhost:3000/api/process-meal \
#   -H "Content-Type: application/json" \
#   -H "Cookie: <your-auth-cookie>" \
#   -d '{"meal_id": "<uuid>"}'

# Option B: Modify the backfill script to test on one user
# Edit scripts/backfill_v1.ts line 90, add:
#   .eq('user_id', '<your-test-user-uuid>')
# Then run dry-run to preview:
npm run meal:backfill -- --days=2 --dry-run

# Option C: Process last 2 days only (small window)
npm run meal:backfill -- --days=2
```

**Once verified, run full backfill:**

```bash
# Dry run first — see what would be processed
npm run meal:backfill -- --dry-run

# Actual backfill (past 14 days, default)
npm run meal:backfill

# Custom window
npm run meal:backfill -- --days=7
```

### Step 6: Test via API (optional)

```bash
curl -X POST http://localhost:3000/api/process-meal \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-auth-cookie>" \
  -d '{"meal_id": "<uuid>"}'
```

### Step 7: Test Backfill via API (optional)

```bash
curl -X POST http://localhost:3000/api/process-backfill \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-auth-cookie>" \
  -d '{"days": 7}'
```

### Step 8: Verify Nightly Cron

The GitHub Actions workflow at `.github/workflows/nightly-meal-processing.yml` will run automatically at **00:00 UTC (4:00 AM UAE)** daily. You can also trigger it manually from the Actions tab.

---

## Weekly Aggregation Query

Run this in Supabase SQL Editor or use it in your dashboard:

```sql
SELECT
  sum((totals->>'kcal')::numeric)       AS total_kcal,
  sum((totals->>'protein_g')::numeric)  AS total_protein,
  sum((totals->>'carbs_g')::numeric)    AS total_carbs,
  sum((totals->>'fat_g')::numeric)      AS total_fat,
  sum((totals->>'sugar_g')::numeric)    AS total_sugar,
  count(*)                               AS meals_processed,
  avg(confidence_score)                  AS avg_confidence,
  count(*) FILTER (WHERE confidence_score >= 70) AS high_conf_meals
FROM meal_processing_runs
WHERE user_id = auth.uid()
  AND processed_at >= now() - interval '7 days'
  AND status = 'success';
```

---

## UI Data Contract

To display a **Meal Card** with nutrition data, join `meal_logs` with `meal_processing_runs`:

```sql
SELECT
  ml.id,
  ml.meal_type,
  ml.description,
  ml.photo_url,
  ml.meal_datetime,
  mpr.totals,
  mpr.confidence_score,
  mpr.confidence_reasons,
  mpr.improvement_tips,
  mpr.llm_comment,
  mpr.status
FROM meal_logs ml
LEFT JOIN meal_processing_runs mpr
  ON mpr.meal_id = ml.id
  AND mpr.pipeline_version = 'v1.0'
WHERE ml.user_id = auth.uid()
  AND ml.meal_datetime::date = '2026-02-17'
ORDER BY ml.meal_datetime;
```

Required fields for the meal card:
- `totals` → `{ kcal, protein_g, carbs_g, fat_g, sugar_g }`
- `confidence_score` → integer 0–100
- `confidence_reasons` → string[]
- `improvement_tips` → string[]
- `llm_comment` → string

---

## Versioning Strategy

- Pipeline version is hardcoded: `const PIPELINE_VERSION = 'v1.0'` in `src/lib/meal-processing/openai.ts`
- The unique index `(meal_id, pipeline_version)` allows multiple versions to coexist
- To upgrade: change version to `v1.1`, rerun backfill — old runs remain intact
- To reprocess a meal under the same version: delete its run row first

---

## Cost Tracking

Costs are calculated per-run based on actual token usage:

| Model | Input ($/1M tokens) | Output ($/1M tokens) |
|-------|---------------------|----------------------|
| `gpt-4.1-nano` | $0.10 | $0.40 |
| `gpt-4.1-mini` | $0.40 | $1.60 |

Stored in `meal_processing_runs.cost_usd`. Aggregate cost query:

```sql
SELECT
  sum(cost_usd) AS total_cost,
  sum(tokens_in) AS total_tokens_in,
  sum(tokens_out) AS total_tokens_out,
  count(*) AS total_runs
FROM meal_processing_runs
WHERE status = 'success';
```

---

## Rollback / Debug

| Action | How |
|--------|-----|
| Re-process a single meal | Delete from `meal_processing_runs WHERE meal_id = X AND pipeline_version = 'v1.0'`, then call API again |
| Clear all v1.0 data | `DELETE FROM meal_processing_runs WHERE pipeline_version = 'v1.0'` (cascades to `meal_items_v1`) |
| Check failed runs | `SELECT * FROM meal_processing_runs WHERE status = 'failed'` |
| View processing logs | Check GitHub Actions logs or server stdout |
| Drop everything | Drop tables in reverse order: `meal_items_v1`, `meal_processing_runs`, `food_cache_v1` |

---

## File-Level Reference

### `supabase/meal_processing_schema.sql`
- Lines 1–50: `meal_processing_runs` table + indexes
- Lines 52–78: `meal_items_v1` table + index
- Lines 80–95: `food_cache_v1` table
- Lines 97–120: RLS policies

### `src/lib/meal-processing/openai.ts`
- Lines 1–30: Constants (`PIPELINE_VERSION`, `MODELS`, pricing)
- Lines 32–55: OpenAI client singleton + cost calculator
- Lines 57–115: Extraction prompt (system + user template)
- Lines 117–170: Estimation prompt (system + user template with confidence rules)
- Lines 172–220: `callExtractionModel()` and `callEstimationModel()`

### `src/lib/meal-processing/process-meal.ts`
- Lines 1–40: Imports + JSDoc
- Lines 42–65: Fetch meal + idempotency check
- Lines 67–90: Insert queued run + determine input modes
- Lines 92–120: Call extraction → cache lookup
- Lines 122–160: Call estimation → write items → update cache
- Lines 162–195: Finalize run (totals, cost, status) + error handling

### `scripts/backfill_v1.ts`
- CLI args: `--days=N`, `--dry-run`
- Uses service role key (bypasses RLS)
- 200ms delay between meals
- Dynamic import of `processMeal`

### `scripts/nightly_meal_processing.ts`
- Processes last 24h of unprocessed meals
- Same pattern as backfill but no `--days` arg
- Designed for cron execution

### API Routes
- `POST /api/process-meal` — `{ meal_id }` → processes one meal (auth required)
- `POST /api/process-backfill` — `{ days? }` → processes all unprocessed meals for the user

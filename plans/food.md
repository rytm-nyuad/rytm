  How meal processing works (end-to-end)

  Input: A meal_logs row with a photo and/or text description.

  Pipeline (2-model):
  1. Extraction (gpt-4.1-nano + vision) — identifies food items
  from the photo/text
  2. Cache check — looks up food_cache_v1 for known items
  3. Estimation (gpt-4.1-mini, text-only) — estimates macros +
  confidence score
  4. DB writes — saves results to 3 tables:

  ┌──────────────────────┬────────────────────────────────────┐
  │        Table         │           What's stored            │
  ├──────────────────────┼────────────────────────────────────┤
  │                      │ Run status, totals                 │
  │ meal_processing_runs │ (kcal/protein/carbs/fat/sugar),    │
  │                      │ confidence score (0-100), cost,    │
  │                      │ tokens                             │
  ├──────────────────────┼────────────────────────────────────┤
  │                      │ Per-item macros (name, portion,    │
  │ meal_items_v1        │ kcal, protein, carbs, fat, sugar,  │
  │                      │ source)                            │
  ├──────────────────────┼────────────────────────────────────┤
  │ food_cache_v1        │ Shared nutrition lookup cache      │
  └──────────────────────┴────────────────────────────────────┘

  Output per meal: totals, confidence_score, confidence_reasons,
  improvement_tips, llm_comment, cost_usd

  Current scripts

  - npm run meal:backfill -- --days=7 — processes all users in
  the window (no user filter)
  - npm run meal:test <meal-id> — processes one meal by ID
  - npm run meal:nightly — last 24h, all users

  Proposed change

  Add a --user=<uuid> flag to backfill_v1.ts so you can run:

  npm run meal:backfill -- --user=<user-uuid> --days=7 --dry-run
    # preview
  npm run meal:backfill -- --user=<user-uuid> --days=7
     # process

  It's a small change (~10 lines) in the arg parser and query
  filter.

╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Plan: Add --user flag to backfill script for per-user meal 
 processing

 Context

 You want to run meal processing for a specific user within a
 specific time frame. Currently:

 - npm run meal:backfill -- --days=N processes all users in the
 window
 - npm run meal:test <meal-id> processes a single meal (not a
 range)
 - There is no --user flag on any script

 How the system works end-to-end

 Flow

 1. Input: A meal_logs row (photo_url + description)
 2. Extraction (gpt-4.1-nano, vision): identifies food items
 from photo + text
 3. Cache lookup: checks food_cache_v1 for known items
 4. Estimation (gpt-4.1-mini, text): estimates macros per item +
  totals + confidence score
 5. DB writes: inserts into meal_processing_runs (run metadata +
  totals) and meal_items_v1 (per-item macros), updates
 food_cache_v1

 Tables touched

 ┌──────────────────────┬────────────┬───────────────────────┐
 │        Table         │ Read/Write │         What          │
 ├──────────────────────┼────────────┼───────────────────────┤
 │                      │            │ Source meals (id,     │
 │ meal_logs            │ Read       │ user_id, photo_url,   │
 │                      │            │ description,          │
 │                      │            │ meal_datetime)        │
 ├──────────────────────┼────────────┼───────────────────────┤
 │                      │            │ Pipeline run tracking │
 │ meal_processing_runs │ Read+Write │  (status, totals,     │
 │                      │            │ confidence, cost)     │
 ├──────────────────────┼────────────┼───────────────────────┤
 │ meal_items_v1        │ Write      │ Individual food items │
 │                      │            │  with macros          │
 ├──────────────────────┼────────────┼───────────────────────┤
 │                      │            │ Shared nutrition      │
 │ food_cache_v1        │ Read+Write │ cache by normalized   │
 │                      │            │ food name             │
 └──────────────────────┴────────────┴───────────────────────┘

 Output per meal

 - totals: {kcal, protein_g, carbs_g, fat_g, sugar_g}
 - confidence_score: 0-100
 - confidence_reasons, improvement_tips, llm_comment
 - tokens_in, tokens_out, cost_usd

 Change: Add --user flag to backfill script

 File to modify: scripts/backfill_v1.ts

 What to change

 1. Add --user=<user-id> CLI arg parsing in parseArgs()
 2. If --user is provided, add .eq('user_id', userId) to the
 meal_logs query
 3. Log the user filter in the startup output

 Command after change

 # Process all meals for a specific user in the last 7 days
 npm run meal:backfill -- --user=<user-uuid> --days=7

 # Dry run first to preview
 npm run meal:backfill -- --user=<user-uuid> --days=7 --dry-run

 Verification
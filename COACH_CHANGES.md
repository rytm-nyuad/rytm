# Coach Changes

## 2026-04-16

### Current Coach Inputs And History

The current morning coach is driven by the Python pipeline in [python/coach/langgraph_pipeline.py](/home/nyuad/rytm/python/coach/langgraph_pipeline.py:68), which is triggered by [src/app/api/coach/morning-run/route.ts](/home/nyuad/rytm/src/app/api/coach/morning-run/route.ts:11).

Current day-level inputs fetched before plan generation:

- `daily_overall` via [python/coach/data_fetcher.py](/home/nyuad/rytm/python/coach/data_fetcher.py:13)
- `daily_checkins` via [python/coach/data_fetcher.py](/home/nyuad/rytm/python/coach/data_fetcher.py:22)
- `fitbit_sleep_daily` via [python/coach/data_fetcher.py](/home/nyuad/rytm/python/coach/data_fetcher.py:31)
- `fitbit_activity_daily` via [python/coach/data_fetcher.py](/home/nyuad/rytm/python/coach/data_fetcher.py:40)
- `fitbit_hrv_daily` via [python/coach/data_fetcher.py](/home/nyuad/rytm/python/coach/data_fetcher.py:49)
- `fitbit_readiness_daily` via [python/coach/data_fetcher.py](/home/nyuad/rytm/python/coach/data_fetcher.py:58)
- `fitbit_overnight_daily` via [python/coach/data_fetcher.py](/home/nyuad/rytm/python/coach/data_fetcher.py:67)
- `water_intake_logs` via [python/coach/data_fetcher.py](/home/nyuad/rytm/python/coach/data_fetcher.py:76)
- `meal_logs` via [python/coach/data_fetcher.py](/home/nyuad/rytm/python/coach/data_fetcher.py:86)
- `daily_todos` via [python/coach/data_fetcher.py](/home/nyuad/rytm/python/coach/data_fetcher.py:96)
- `calendar_events` via [python/coach/data_fetcher.py](/home/nyuad/rytm/python/coach/data_fetcher.py:105)
- Active goal from `user_goals1` via [python/coach/langgraph_pipeline.py](/home/nyuad/rytm/python/coach/langgraph_pipeline.py:266)

Current historical context available to the morning coach:

- 7-day check-in history from `daily_checkins`
- 7-day sleep history from `fitbit_sleep_daily`
- 7-day HRV history from `fitbit_hrv_daily`
- 7-day activity history from `fitbit_activity_daily`
- 7-day readiness history from `fitbit_readiness_daily`
- Recent action history from `plan_actions1` over the last 7 days

Those history reads are currently defined in [python/coach/data_fetcher.py](/home/nyuad/rytm/python/coach/data_fetcher.py:115) and [python/coach/data_fetcher.py](/home/nyuad/rytm/python/coach/data_fetcher.py:185).

Current engineered features are computed in [python/coach/feature_computer.py](/home/nyuad/rytm/python/coach/feature_computer.py:8) and stored in `daily_features1` by [python/coach/deterministic_agents.py](/home/nyuad/rytm/python/coach/deterministic_agents.py:110). The current feature set is still MVP-level and mostly includes same-day raw reductions plus a small amount of 7-day aggregation.

### What Happens On Overall Score Submission Today

Before this change, the dashboard called the RPC `submit_overall_for_date` directly from the browser in [src/lib/db/dashboard.ts](/home/nyuad/rytm/src/lib/db/dashboard.ts:209). That RPC:

- resolved canonical timezone as `fitbit_profile.user_timezone -> profiles.timezone -> UTC`
- upserted the `daily_overall` row
- refreshed `daily_summary`

The RPC does not currently trigger coach preprocessing or previous-day feature bundle generation. The actual morning coach preprocessing still happens only when `/api/coach/morning-run` is called.

### Timezone Logic

Canonical timezone resolution currently lives in [src/lib/time.ts](/home/nyuad/rytm/src/lib/time.ts:89):

- first choice: `fitbit_profile.user_timezone`
- second choice: `profiles.timezone`
- fallback: browser timezone persisted through `ensure_profile_timezone`

The dashboard checklist and daily-summary flows rely heavily on that canonical timezone. The coach pipeline also reads `profiles.timezone` for personalization, but its day windows are mostly date-based today.

### Change Made In This Iteration

We introduced a server-side overall submission flow:

- new route: [src/app/api/dashboard/submit-overall/route.ts](/home/nyuad/rytm/src/app/api/dashboard/submit-overall/route.ts:1)
- updated client caller: [src/lib/db/dashboard.ts](/home/nyuad/rytm/src/lib/db/dashboard.ts:209)

New behavior on morning overall submission:

1. Authenticate user in the server route.
2. Refresh Fitbit profile timezone live using the current Fitbit access token when available.
3. Upsert the latest wearable timezone into `fitbit_profile.user_timezone`.
4. Mirror that wearable timezone into `profiles.timezone` if it changed.
5. Call the existing `submit_overall_for_date` RPC.

The Fitbit timezone refresh helper is now in [src/lib/fitbit.ts](/home/nyuad/rytm/src/lib/fitbit.ts:656).

### Why This Change Matters

- It makes the overall-submission path a better orchestration point for future workflows.
- It keeps `profiles.timezone` aligned with the latest wearable timezone instead of only relying on old OAuth-time profile data.
- It preserves existing RPC-based checklist and streak logic while moving cross-system side effects to a server-controlled path.

### Known Gap / Next Planned Step

`supabase-coach-inputs2.sql` was empty in the working tree at the time of this pass, so the new `daily_input_bundle_v12` and `idx_user_state_current2_asof` design has not been implemented yet.

The next intended workflow to add after overall submission is:

- process the prior day’s inputs immediately
- materialize the coach-ready daily input bundle
- update the separate user-state / memory table so morning coach generation can read prepared state instead of recomputing everything on demand

## 01_daily_nutrition2

### What

Added deterministic daily nutrition aggregation for `daily_nutrition2`:

- SQL RPC `compute_daily_nutrition2(p_user_id, p_date, p_tz)` in [supabase/function_rpcs.sql](/home/nyuad/rytm/supabase/function_rpcs.sql:1)
- Python helper `ensure_daily_nutrition2(user_id, date, tz)` in [python/coach/data_fetcher.py](/home/nyuad/rytm/python/coach/data_fetcher.py:197)

### Why

This creates a narrow, auditable preprocessing unit we can run ahead of morning coach generation. It uses existing raw meal tables and only trusts successful meal-processing outputs.

### Logic

For a given `(user_id, local date, timezone)`:

- Find `meal_logs` rows whose `meal_datetime` falls within that local day window.
- Join only the latest `meal_processing_runs` row per meal where `status = 'success'`.
- Aggregate macro totals from `meal_processing_runs.totals`:
  - `kcal`
  - `protein_g`
  - `carbs_g`
  - `fat_g`
  - `sugar_g`
- Compute meal flags:
  - `breakfast_logged`
  - `lunch_logged`
  - `dinner_logged`
- Compute timing features from local meal times:
  - `time_first_meal_minutes`
  - `time_last_meal_minutes`
  - `eating_window_minutes`

### Confidence

Per-meal confidence uses `meal_processing_runs.confidence_score` normalized from `0..100` to `0..1`.

Day-level confidence uses kcal-weighted averaging with a floor:

- If `meal_count_day = 0`, then `nutrition_confidence_day = 0`
- Otherwise each meal weight is `max(kcal_i, 50)`
- If meal kcal is missing, it is treated as `0` before the floor, so the effective weight becomes `50`

Formula used:

`nutrition_confidence_day = sum(weight_i * confidence_i) / sum(weight_i)`

### Assumptions

- “Use only success” means meals without a successful `meal_processing_runs` row do not contribute to `daily_nutrition2`.
- If meals exist in `meal_logs` but none have successful processing rows yet, the day is stored as missing with `meal_count_day = 0` and `meals_missing_day = true`.
- The most recent successful processing row is chosen by `processed_at`, falling back to `created_at`.
- This change does not yet wire the nutrition computation into the overall-score submission workflow. It only adds the deterministic building block and Python helper.

### Files

- [supabase/function_rpcs.sql](/home/nyuad/rytm/supabase/function_rpcs.sql:1)
- [python/coach/data_fetcher.py](/home/nyuad/rytm/python/coach/data_fetcher.py:185)

## 02_overall_submission_workflows

### What

Added a new isolated workflow directory for deterministic jobs that will eventually run after `overall_score` submission:

- [src/lib/overall-submission-workflows/dailyNutrition2.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/dailyNutrition2.ts:1)
- [src/lib/overall-submission-workflows/index.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/index.ts:1)

### Why

This keeps the new post-submission preprocessing path separate from the existing MVP coach flow. The intent is to add more files in the same directory later for:

- journal preprocessing
- feature extraction
- input bundle generation
- state updates

### Logic

`ensureDailyNutrition2(...)` does the following:

1. Resolve canonical timezone using the shared time utilities in [src/lib/time.ts](/home/nyuad/rytm/src/lib/time.ts:89).
2. Find the user’s meals for the requested local date.
3. Check which of those meals already have a successful `meal_processing_runs` row.
4. Run existing meal preprocessing for missing meals using [src/lib/meal-processing/process-meal.ts](/home/nyuad/rytm/src/lib/meal-processing/process-meal.ts:61).
5. Call the `compute_daily_nutrition2` RPC after preprocessing is ready.

### Time Handling

This workflow uses the shared `formatLocalDate` and `getCanonicalTimeZone` helpers from [src/lib/time.ts](/home/nyuad/rytm/src/lib/time.ts:11) so day matching stays aligned with the rest of the app.

To avoid duplicating timezone conversion logic in SQL or ad hoc date math in the workflow, it fetches a bounded UTC window around the target date, then filters meals by local date using `formatLocalDate`.

### Files

- [src/lib/overall-submission-workflows/dailyNutrition2.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/dailyNutrition2.ts:1)
- [src/lib/overall-submission-workflows/index.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/index.ts:1)

## 03_meal_processing_openrouter

### What

Updated the meal-processing LLM wrapper to prefer OpenRouter while preserving a fallback to direct OpenAI:

- [src/lib/meal-processing/openai.ts](/home/nyuad/rytm/src/lib/meal-processing/openai.ts:1)

### Why

The new `dailyNutrition2` workflow can trigger meal processing for meals that do not yet have a successful `meal_processing_runs` row. To make that reliable in the current environment, meal processing now needs to work with `OPENROUTER_API_KEY` rather than depending only on `OPENAI_API_KEY`.

### Logic

- Primary path: use `OPENROUTER_API_KEY` with the OpenAI-compatible API at `https://openrouter.ai/api/v1`
- Fallback path: if `OPENROUTER_API_KEY` is absent, use direct `OPENAI_API_KEY`
- Default meal-processing models now use OpenRouter-style model IDs:
  - `openai/gpt-4.1-nano`
  - `openai/gpt-4.1-mini`
- Added support for optional overrides:
  - `MEAL_EXTRACTION_MODEL`
  - `MEAL_ESTIMATION_MODEL`

### Assumptions

- The existing Responses API calls remain compatible through OpenRouter for the chosen models.
- Existing meal-processing cost estimates still use OpenAI pricing assumptions as a practical approximation.

### Files

- [src/lib/meal-processing/openai.ts](/home/nyuad/rytm/src/lib/meal-processing/openai.ts:1)

## 03_journal_summary2

### What

Added a new deterministic journal preprocessing workflow:

- [src/lib/overall-submission-workflows/journalSummary2.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/journalSummary2.ts:1)
- [python/prompts_journal.py](/home/nyuad/rytm/python/prompts_journal.py:1)

### Why

This creates a separate structured memory layer for journal content before the morning coach runs. It keeps daily journal extraction isolated from the existing guided journal chat flow and makes the extracted fields auditable and reusable in the future input bundle.

### Logic

`ensure_journal_summary2(user_id, date, tz)` does the following:

1. Resolve canonical timezone through [src/lib/time.ts](/home/nyuad/rytm/src/lib/time.ts:11) when a timezone is not provided.
2. Check whether `journal_summary2` already exists for `(user_id, date)`.
3. Load the user’s own `journal_messages` for that local day.
   - First-class match: rows where `local_date = date`
   - Fallback match: rows with no `local_date` whose `created_at` converts to the requested local day
4. If there are no user journal messages for that day, insert nothing and return a missing-journal result.
5. If `SKIP_JOURNAL_SUMMARY2=true`, upsert a placeholder row with empty required arrays, nullable scalar fields as `null`, and `extractor_confidence = 0`.
6. Otherwise call a cheap Claude model through OpenRouter, sanitize the JSON output, and upsert `journal_summary2`.

### Missingness Semantics

Journal missingness is intentionally different from nutrition and checkin relations:

- `daily_nutrition2`: we may still write a row that says the day is missing
- `daily_checkin_relation2`: no relation row exists when the raw checkin row is missing
- `journal_summary2`: no row is inserted when there are no journal messages for that day

That means future bundle-building logic should treat the absence of a `journal_summary2` row as journal missingness, not as a zero-filled summary.

### Model And Prompt

- Model: `anthropic/claude-3.5-haiku` by default via OpenRouter
- Override env: `JOURNAL_SUMMARY2_MODEL`
- Skip env: `SKIP_JOURNAL_SUMMARY2`
- The exact system prompt used for extraction is source-controlled in [python/prompts_journal.py](/home/nyuad/rytm/python/prompts_journal.py:1)

### Assumptions

- Journal summarization uses only `journal_messages.role = 'user'` so assistant replies do not contaminate the memory layer.
- Required JSONB list fields in `journal_summary2` are stored as `[]`, not `null`, because the table schema marks them `not null`.
- Optional text fields are stored as `null` when skipped or unsupported by evidence.

### Files

- [src/lib/overall-submission-workflows/journalSummary2.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/journalSummary2.ts:1)
- [python/prompts_journal.py](/home/nyuad/rytm/python/prompts_journal.py:1)

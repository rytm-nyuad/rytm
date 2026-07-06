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

`supabase/coach_inputs2.sql` was empty in the working tree at the time of this pass, so the new `daily_input_bundle_v12` and `idx_user_state_current2_asof` design has not been implemented yet.

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

### Debugging Note

Added temporary server-side error logging inside [src/lib/overall-submission-workflows/journalSummary2.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/journalSummary2.ts:1) so the extraction path now logs:

- extractor failures with local date, timezone, model, and message count
- the sanitized draft payload before `journal_summary2` upsert
- upsert failures with the payload that was attempted

This is only to help diagnose non-skip journal extraction failures while wiring the workflow up.

## 04_journal_bundle_alignment_and_runner

### What

Aligned `journal_summary2` with the structure already expected by the bundle builder and added a reusable end-to-end workflow test runner.

### Why

The existing bundle builder in [src/lib/overall-submission-workflows/inputBundleV1.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/inputBundleV1.ts:1) already expected structured journal objects for:

- `episodic_events`
- `stressor_types`
- `coping_actions`

But [src/lib/overall-submission-workflows/journalSummary2.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/journalSummary2.ts:1) was still sanitizing those fields as plain string arrays. That mismatch forced the bundle layer to infer structure heuristically. The journal layer now stores the structured shape directly so the bundle can consume it deterministically.

### Journal Shape

`journal_summary2` is now normalized to the bundle-facing shape:

- `episodic_events`: objects with `event_type`, `status`, `time_horizon`, `confidence`, `evidence_message_ids`
- `stressor_types`: objects with `type`, `confidence`, `controllability`, `evidence_message_ids`
- `coping_actions`: objects with `action`, `effectiveness`, `evidence_message_ids`
- `tone_hint`: `"supportive" | "neutral" | "encouraging" | null`
- `self_appraisal_style`: `"catastrophizing" | "balanced" | "optimistic" | null`
- `self_efficacy_language`: `"low" | "med" | "high" | null`

The bundle builder no longer has to infer those fields from strings and now mostly passes them through after light confidence clamping.

### Workflow Runner

Added a small test runner:

- [scripts/test_overall_submission_workflows.ts](/home/nyuad/rytm/scripts/test_overall_submission_workflows.ts:1)

It runs, in order, for one user and local date:

1. `ensureDailyNutrition2`
2. `ensureDailyCheckinRelation2`
3. `ensureJournalSummary2`
4. `build_daily_input_bundle_v1`

Package script:

- `npm run workflows:test-day -- <userId> <YYYY-MM-DD> [timezone]`

### Files

- [src/lib/overall-submission-workflows/journalSummary2.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/journalSummary2.ts:1)
- [src/lib/overall-submission-workflows/inputBundleV1.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/inputBundleV1.ts:1)
- [src/lib/overall-submission-workflows/dailyCheckinRelation2.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/dailyCheckinRelation2.ts:1)
- [src/lib/overall-submission-workflows/index.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/index.ts:1)
- [scripts/test_overall_submission_workflows.ts](/home/nyuad/rytm/scripts/test_overall_submission_workflows.ts:1)
- [package.json](/home/nyuad/rytm/package.json:1)

## 05_supabase_retry_and_node_runtime_note

### What

Added a small retry helper for transient Supabase transport failures and applied it to the most timing-sensitive workflow reads/writes:

- [src/lib/overall-submission-workflows/supabaseRetry.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/supabaseRetry.ts:1)
- [src/lib/overall-submission-workflows/journalSummary2.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/journalSummary2.ts:1)
- [src/lib/overall-submission-workflows/inputBundleV1.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/inputBundleV1.ts:1)

Also updated the workflow day-test script in [package.json](/home/nyuad/rytm/package.json:1) so it preloads `dotenv/config`.

### Why

While testing under Node 18, Supabase requests intermittently failed with transport errors such as:

- `TypeError: fetch failed`
- `UND_ERR_CONNECT_TIMEOUT`

The extracted journal payload itself was valid. The failures were occurring on the HTTP request to Supabase, so a light retry layer is appropriate.

### Retry Policy

- Max attempts: `3`
- Backoff: `300ms`, then `900ms`
- Retries only for transport-style failures such as `fetch failed`, `connect timeout`, `UND_ERR_CONNECT_TIMEOUT`, `ECONNRESET`, `ETIMEDOUT`

### Node Runtime Note

Based on the current repository dependencies, upgrading Node from 18 to 20 should be low risk and is unlikely to conflict with the Python LangGraph pipeline:

- The LangGraph coach pipeline is Python-only and uses [python/coach/requirements.txt](/home/nyuad/rytm/python/coach/requirements.txt:1), so it does not depend on the Node runtime.
- The web app stack (`next`, `react`, `@supabase/supabase-js`, `openai`, `tsx`, `jest`) should all be compatible with Node 20.
- This repo does not currently depend on obvious native Node addons that would usually create upgrade friction.

The main upgrade caution is runtime consistency:

- If local development moves to Node 20 but deployment or cron environments stay on Node 18, behavior can still diverge.
- Existing `tsx`/ESM shell quirks under Node 18 are one reason the new workflow testing has been awkward; Node 20 should improve that rather than worsen it.

## 06_offline_font_build_fix

### What

Removed the build-time dependency on Google Fonts from the app layout.

### Why

`next build` was failing when `next/font/google` tried to fetch `Inter` from `fonts.googleapis.com` and the request timed out. This was unrelated to app logic but blocked local validation after the Node upgrade.

### Logic

- Removed the `Inter` import from [src/app/layout.tsx](/home/nyuad/rytm/src/app/layout.tsx:1)
- Kept the existing `--font-inter` CSS contract, but now define it directly in [src/app/globals.css](/home/nyuad/rytm/src/app/globals.css:1) as a system sans-serif stack

This preserves current styling intent without requiring network access during build.

### Files

- [src/app/layout.tsx](/home/nyuad/rytm/src/app/layout.tsx:1)
- [src/app/globals.css](/home/nyuad/rytm/src/app/globals.css:1)

## 07_goal_framing_openrouter_migration

### What

Migrated the goal-framing LLM path to OpenRouter-first credentials and removed top-level client initialization.

### Why

`next build` was failing while collecting page data for `/api/coach/goal-framing` because [src/lib/coach/goalFramingAgent.ts](/home/nyuad/rytm/src/lib/coach/goalFramingAgent.ts:1) instantiated an OpenAI client at import time and required `OPENAI_API_KEY` even before the route was called.

### Logic

- Goal framing now prefers `OPENROUTER_API_KEY`
- Fallback remains `OPENAI_API_KEY`
- The client is created lazily inside the goal-framing helper instead of at module import time
- Default model is now `openai/gpt-4.1-mini`
- Optional override env: `GOAL_FRAMING_MODEL`

This keeps the behavior aligned with the broader OpenRouter migration while avoiding build-time crashes when the route module is imported.

### Files

- [src/lib/coach/goalFramingAgent.ts](/home/nyuad/rytm/src/lib/coach/goalFramingAgent.ts:1)

## 08_state_engine

### What

Added a deterministic state engine under [src/lib/overall-submission-workflows/state_engine](/home/nyuad/rytm/src/lib/overall-submission-workflows/state_engine) and wired it into the workflow day-test runner.

### Why

The new post-submission pipeline now has a deterministic state layer after bundle generation. This gives us auditable user memory for baselines, volatility, trends, lag relations, residual mismatch memory, and compressed episodic context before the later summary/action stage is added.

### Logic

`update_state(user_id, date, input_bundle)`:

1. Reads recent `daily_input_bundle_v12` history
2. Computes tracked feature baselines using:
   - fast memory: `effective_days = 7`
   - slow memory: `effective_days_current = min(valid_days, 30)` once `valid_days >= 7`
3. Computes slopes using EWMA deltas
4. Computes robust scale via MAD
5. Computes lag relations over a 14-day rolling window when enough paired points exist
6. Tracks residual gap signature and mismatch persistence
7. Builds compressed episodic memory from journal-derived bundle fields
8. Writes:
   - `user_state_current2`
   - `user_state_history2` stub row for that date

### Compact History Snapshot

Per your decision, `user_state_history2.state_snapshot_json` stores a compact analysis-friendly subset rather than the full state blob. It includes:

- summary baselines and volatility for core comparison features
- slopes
- residual signature
- lag relations
- uncertainty
- compressed episodic memory
- compressed advice memory

### Readiness Gate

The state engine writes state even when history is sparse, but it returns:

- `shouldRunSummary`
- `fast_ready`
- `slow_ready`

So the future morning-summary orchestration can skip summary generation until core baselines are ready.

### Files

- [src/lib/overall-submission-workflows/state_engine/updateState.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/state_engine/updateState.ts:1)
- [src/lib/overall-submission-workflows/state_engine/index.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/state_engine/index.ts:1)
- [src/lib/overall-submission-workflows/inputBundleV1.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/inputBundleV1.ts:1)
- [src/lib/overall-submission-workflows/index.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/index.ts:1)

## 12_pipeline_update

### What

Migrated the active Python morning coach path to use prepared bundle/state artifacts instead of the old raw snapshot -> validate -> feature-compute chain.

Updated:

- [python/coach/langgraph_pipeline.py](/home/nyuad/rytm/python/coach/langgraph_pipeline.py:1)
- [python/coach/data_fetcher.py](/home/nyuad/rytm/python/coach/data_fetcher.py:1)
- [python/coach/prompts.py](/home/nyuad/rytm/python/coach/prompts.py:1)
- [src/lib/overall-submission-workflows/journalSummary2.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/journalSummary2.ts:1)
- [src/lib/overall-submission-workflows/inputBundleV1.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/inputBundleV1.ts:1)
- [src/lib/meal-processing/openai.ts](/home/nyuad/rytm/src/lib/meal-processing/openai.ts:1)
- [src/lib/meal-processing/process-meal.ts](/home/nyuad/rytm/src/lib/meal-processing/process-meal.ts:1)
- [src/types/meal-processing.ts](/home/nyuad/rytm/src/types/meal-processing.ts:1)
- [supabase/meal_processing_schema.sql](/home/nyuad/rytm/supabase/meal_processing_schema.sql:1)
- [docs/08_pipeline_update.md](/home/nyuad/rytm/docs/08_pipeline_update.md:1)

### Notes

- `fetch_goal` stayed separate so `user_goals1` is not redundantly loaded in the prepared-context fetch.
- recent action memory now comes from `user_state_history2.actions_generated_json`, not `plan_actions1`
- the Python fetch layer no longer reloads `daily_overall`
- `SKIP_JOURNAL_SUMMARY2=true` can now override an existing `journal_summary2` row with the skipped/null-style payload
- the prepared bundle now carries meal descriptions plus caffeine summary
- meal-processing pipeline version bumped to `v1.1` so caffeine-aware reprocessing can happen deterministically
- fixed bundle builder timezone override so split-timezone backfills no longer silently stamp the current canonical timezone into `daily_input_bundle_v12`
- added retry + optional skip policy to `dailyNutrition2` meal processing for backfills via `MEAL_PROCESSING_MAX_RETRIES` and `SKIP_MEAL_PROCESSING_FAILURES`
- [scripts/test_overall_submission_workflows.ts](/home/nyuad/rytm/scripts/test_overall_submission_workflows.ts:1)
- [docs/changes2/06_state_engine.md](/home/nyuad/rytm/docs/changes2/06_state_engine.md:1)

## 09_personalized_proxy_calculator

### What

Replaced the placeholder physiology proxy calculation in [src/lib/overall-submission-workflows/inputBundleV1.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/inputBundleV1.ts:1) with a personalized proxy that standardizes HRV, resting heart rate, and sleep duration against user-specific rolling baselines from state.

### Why

The previous proxy used fixed global min/max normalization. That was only a placeholder and did not reflect the auditable state design. The new proxy is now a within-user reference score that is consistent with the state engine and the subjective-objective gap logic.

### Logic

The proxy now uses:

- `fitbit_hrv_daily.hrv_daily_rmssd`
- `fitbit_activity_daily.resting_heart_rate`
- `fitbit_sleep_daily.minutes_asleep` converted to `sleep_duration_hours`

For each component, the bundle builder reads prior user-specific baseline statistics from:

1. latest `user_state_history2` before the target date
2. fallback to `user_state_current2` only when its `as_of_date` is earlier than the target date

For each component, we use the stored rolling baseline center and scale, preferring slow memory when available and otherwise fast memory once valid.

The proxy formula is:

- `proxy_index = 0.50 * zHRV - 0.30 * zRHR + 0.20 * zSleep`
- `proxy = clip(50 + 15 * proxy_index, 0, 100)`

### Missingness And Readiness

- The proxy remains `null` until the required baseline stats exist for all three components
- This effectively enforces the `>= 7 valid days` requirement, because the state engine only materializes usable fast/slow baselines after that point
- If any required same-day component is missing, the proxy is `null`
- `confidence_proxy` is now deterministic and based on component presence plus whether the baseline source is slow or fast

### Notes

- Sleep timing baselines remain part of state tracking, but the proxy itself only uses sleep duration in Version 1
- The proxy is still internal and is not intended as a user-facing readiness score
- This change affects the `gap_today` residual memory, since the objective reference is now personalized instead of globally normalized

### Files

- [src/lib/overall-submission-workflows/inputBundleV1.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/inputBundleV1.ts:1)

## 10_morning_preparation_orchestrator

### What

Added a top-level morning preparation workflow that runs after successful morning overall submission and also added a sequential backfill script for rebuilding bundle/state history over a submission-date range.

### Why

This is the orchestration layer that turns the incremental preprocessing work into a usable daily pipeline. After the user submits their morning overall score for the current local day, the system now preprocesses the previous local day so the coach-facing inputs are ready before the coach is prompted.

### Logic

Added [src/lib/overall-submission-workflows/morningPreparation.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/morningPreparation.ts:1):

- input: `userId`, `submissionLocalDate`, optional timezone/admin client
- resolves timezone through [src/lib/time.ts](/home/nyuad/rytm/src/lib/time.ts:1)
- computes `processedLocalDate = submissionLocalDate - 1 day`
- runs, in order:
  1. `ensureDailyNutrition2(processedLocalDate)`
  2. `ensureDailyCheckinRelation2(processedLocalDate)`
  3. `ensureJournalSummary2(processedLocalDate)`
  4. `build_daily_input_bundle_v1(processedLocalDate)`
  5. `updateState(processedLocalDate)`

### Submission Route Integration

[src/app/api/dashboard/submit-overall/route.ts](/home/nyuad/rytm/src/app/api/dashboard/submit-overall/route.ts:1) now:

- still ingests the current local day overall score through `submit_overall_for_date`
- only runs morning preparation when the submitted local date is the user’s actual current local day
- returns a `morningPreparation` object in the response

Important behavior:

- if morning preparation fails, the overall submission is still kept
- the route returns `ok: true` with a failed `morningPreparation` payload instead of discarding the submitted score

### Backfill Script

Added [scripts/backfill_morning_preparation_range.ts](/home/nyuad/rytm/scripts/backfill_morning_preparation_range.ts:1) and package script:

- `npm run workflows:backfill-range -- <userId> <startSubmissionDate> <endSubmissionDate> [timezone]`

This runs the same morning process sequentially for each submission-date in the range and therefore builds:

- complete `daily_nutrition2`
- complete `daily_checkin_relation2`
- complete `journal_summary2`
- complete `daily_input_bundle_v12` (except goals as currently designed)
- complete `user_state_history2` stubs with deviations/state snapshot but no actions

### Assumption

The orchestration is keyed by submission date and processes the previous local date.

So:

- submission date `2026-02-23`
- processed coach-ready data date `2026-02-22`

This is consistent with the current workflow/table design, where the deterministic preprocessing layer is built from the previous day’s raw data.

### Files

- [src/lib/overall-submission-workflows/morningPreparation.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/morningPreparation.ts:1)
- [src/lib/overall-submission-workflows/index.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/index.ts:1)
- [src/app/api/dashboard/submit-overall/route.ts](/home/nyuad/rytm/src/app/api/dashboard/submit-overall/route.ts:1)
- [scripts/backfill_morning_preparation_range.ts](/home/nyuad/rytm/scripts/backfill_morning_preparation_range.ts:1)
- [package.json](/home/nyuad/rytm/package.json:1)
- [src/lib/time.ts](/home/nyuad/rytm/src/lib/time.ts:1)

## 11_langgraph_pre_llm_integration

### What

Integrated the deterministic preprocessing/state workflow into the morning coach route before Python LangGraph is invoked.

### Why

The new bundle/state pipeline now needs to be the source of truth for coach-ready inputs. The morning route must ensure those artifacts exist and must avoid calling LLM summary nodes when the user still lacks enough history for stable personalized state.

### Logic

[src/app/api/coach/morning-run/route.ts](/home/nyuad/rytm/src/app/api/coach/morning-run/route.ts:1) now:

1. refreshes Fitbit timezone
2. resolves canonical timezone
3. runs [runMorningPreparationForSubmissionDate](/home/nyuad/rytm/src/lib/overall-submission-workflows/morningPreparation.ts:1) before any Python process starts
4. returns early with deterministic `status: "not_enough_history"` when state readiness is not met
5. otherwise proceeds with the existing LangGraph pipeline unchanged
6. after the LangGraph summary completes, writes generated themes/actions back into `user_state_history2.actions_generated_json` for the processed day

### Scope

This was done as a route-level integration rather than a LangGraph graph refactor, to keep the change minimal and to avoid deleting or bypassing any existing nodes inside the Python pipeline.

### Files

- [src/app/api/coach/morning-run/route.ts](/home/nyuad/rytm/src/app/api/coach/morning-run/route.ts:1)
- [docs/changes2/07_langgraph_integration.md](/home/nyuad/rytm/docs/changes2/07_langgraph_integration.md:1)

## 05_input_bundle

### What

Added a deterministic bundle builder for `daily_input_bundle_v12`:

- [src/lib/overall-submission-workflows/inputBundleV1.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/inputBundleV1.ts:1)
- exported through [src/lib/overall-submission-workflows/index.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/index.ts:1)

### Why

This creates the first coach-ready daily input contract from preprocessed tables plus raw Fitbit daily tables, without depending on the legacy Python `data_fetcher`. The intent is to materialize the exact coach input surface ahead of morning generation so latency shifts out of the prompt-time path.

### Sources

The bundle builder reads directly from:

- `daily_overall`
- `fitbit_sleep_daily`
- `fitbit_activity_daily`
- `fitbit_hrv_daily`
- `fitbit_spo2_daily`
- `fitbit_overnight_daily`
- `daily_nutrition2`
- `daily_checkins`
- `daily_checkin_relation2`
- `journal_summary2`

### Derived Watch Fields

The bundle computes the requested watch-derived fields on the fly:

- sleep:
  - `sleep_duration_hours`
  - `sleep_efficiency`
  - `sleep_onset_time_minutes`
  - `wake_time_minutes`
  - `sleep_midpoint_minutes`
  - `deep_ratio_pct`
  - `rem_ratio_pct`
  - `wake_ratio_pct`
  - `sleep_fragmentation_index`
- activity:
  - `total_active_minutes`
  - `mvpa_minutes`
  - `active_ratio`
  - `sedentary_ratio`

### Confidence And Missingness

The bundle now stores explicit group-level missingness and confidence objects.

- Watch domains are binary confidence:
  - sleep/activity/checkin/proxy => `1` when the required source row exists or proxy is computable, else `0`
  - recovery => `1` only when both HRV and overnight data are present, else `0`
- Nutrition confidence comes directly from `daily_nutrition2.nutrition_confidence_day`
- Journal confidence comes directly from `journal_summary2.extractor_confidence`
- Goal confidence is `0` for now and goals are treated as missing because goal context is intentionally ignored in this first bundle version

Missingness semantics stay aligned with earlier workflow decisions:

- nutrition missing => no `daily_nutrition2` row or `meals_missing_day = true`
- checkin missing => no raw `daily_checkins` row
- journal missing => no `journal_summary2` row
- proxy missing => the proxy score cannot be computed from HRV + resting heart rate + sleep minutes

### Physio Proxy

`physio_proxy_score_0_100` is currently a simple weighted heuristic:

- 40% `fitbit_hrv_daily.hrv_daily_rmssd`
- 30% inverse `fitbit_activity_daily.resting_heart_rate`
- 30% `fitbit_sleep_daily.minutes_asleep`

Each component is clipped into a simple `0..100` range before weighting. This is intended as a temporary deterministic proxy and should be replaced later with a more personalized computation.

### Journal Contract Mapping

`journal_summary2` stores sparse strings, but the input bundle contract requires richer typed objects. The first bundle version maps them deterministically:

- `episodic_events` => object list with inferred `status`, `time_horizon`, and shared confidence
- `stressor_types` => object list with a small deterministic taxonomy mapping plus inferred controllability
- `coping_actions` => object list with default `effectiveness = "unsure"`
- `tone_hint`, `self_appraisal_style`, and `self_efficacy_language` are normalized into the constrained bundle enums

### Assumptions

- The checked-in schema includes both `fitbit_spo2_daily.spo2_avg` and `fitbit_overnight_daily.blood_oxygen_avg`, so both are carried in the bundle.
- `overall_true_today` is written as `0` when `daily_overall` is absent so the contract stays fully populated, while missingness is expressed separately.
- The exact JSON contract is written into `bundle_json`, and the upsert into `daily_input_bundle_v12` is idempotent on `(user_id, date)`.

### Files

- [src/lib/overall-submission-workflows/inputBundleV1.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/inputBundleV1.ts:1)
- [src/lib/overall-submission-workflows/index.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/index.ts:1)

## 2026-04-21

### Easy Timing Fixes

Made two low-risk correctness fixes while leaving the larger meal schema redesign for later.

Updated:

- [src/lib/overall-submission-workflows/inputBundleV1.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/inputBundleV1.ts:1)
- [src/lib/db/dashboard.ts](/home/nyuad/rytm/src/lib/db/dashboard.ts:1)
- [docs/08_pipeline_update.md](/home/nyuad/rytm/docs/08_pipeline_update.md:1)

Changes:

- `daily_input_bundle_v12` now reads:
  - `fitbit_sleep_daily`, `fitbit_spo2_daily`, and `fitbit_overnight_daily` from `submissionDate`
  - `fitbit_hrv_daily` and `fitbit_activity_daily` from `sourceDate`
- `sleep_onset_time_minutes` and `wake_time_minutes` now use the clock time already stored in Fitbit sleep timestamps rather than being reformatted through the app timezone helper
- `logMeal()` no longer passes `p_at = now()` when meal time is blank, so the SQL RPC regains control over missing-time fallback behavior

Why this mattered:

- overnight watch metrics should align with the wake-up morning and the same-day overall submission
- blank meal times were being unintentionally converted into "current local time" by the caller before the SQL fallback logic could run

### Meal Day / Time Split

Started the next-step meal migration so the system no longer has to encode "unknown time" as a fake timestamp.

Updated:

- [supabase/function_rpcs.sql](/home/nyuad/rytm/supabase/function_rpcs.sql:1)
- [src/lib/db/dashboard.ts](/home/nyuad/rytm/src/lib/db/dashboard.ts:1)
- [src/lib/overall-submission-workflows/dailyNutrition2.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/dailyNutrition2.ts:1)
- [src/lib/overall-submission-workflows/inputBundleV1.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/inputBundleV1.ts:1)
- [src/components/dashboard/ProgressList.tsx](/home/nyuad/rytm/src/components/dashboard/ProgressList.tsx:1)
- [src/types/dashboard.ts](/home/nyuad/rytm/src/types/dashboard.ts:1)
- [docs/08_pipeline_update.md](/home/nyuad/rytm/docs/08_pipeline_update.md:1)

New intended contract:

- `meal_local_date` determines which local day a meal belongs to
- `meal_datetime` is nullable and is only filled when the user supplied an actual time

Behavioral consequences:

- checklist meal presence uses `meal_local_date`
- input bundle meal context uses `meal_local_date`
- `daily_nutrition2` totals use `meal_local_date`
- `daily_nutrition2` timing fields only use meals with non-null `meal_datetime`
- meal-processing backfill/discovery paths now also use `meal_local_date`

This change still requires the DB schema migration noted in [docs/08_pipeline_update.md](/home/nyuad/rytm/docs/08_pipeline_update.md:1) before the application code can run successfully against Supabase.

### Forward Recompute For Backlog Actions

Added a forward recompute helper so backlog edits can rebuild downstream bundle/state artifacts from the affected point onward.

Added:

- [src/lib/overall-submission-workflows/recomputeForward.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/recomputeForward.ts:1)
- [src/app/api/workflows/recompute-forward/route.ts](/home/nyuad/rytm/src/app/api/workflows/recompute-forward/route.ts:1)
- [scripts/recompute_morning_preparation_forward.ts](/home/nyuad/rytm/scripts/recompute_morning_preparation_forward.ts:1)

Current scheduling behavior:

- backlog meal/checkin/journal changes are treated as source-day changes and recompute from the next submission day forward
- backlog overall changes are treated as submission-day changes and recompute from that same submission day forward

Current trigger points:

- meal logging in [src/lib/db/dashboard.ts](/home/nyuad/rytm/src/lib/db/dashboard.ts:1)
- check-in submission in [src/lib/db/dashboard.ts](/home/nyuad/rytm/src/lib/db/dashboard.ts:1)
- journal route in [src/app/api/journal/route.ts](/home/nyuad/rytm/src/app/api/journal/route.ts:1)
- overall submission route in [src/app/api/dashboard/submit-overall/route.ts](/home/nyuad/rytm/src/app/api/dashboard/submit-overall/route.ts:1)

This is currently best-effort background scheduling rather than a durable queued job.

### LangGraph JSON Parsing Hardening

Hardened the Python coach pipeline against near-valid JSON failures from LLM agents.

Updated:

- [python/coach/langgraph_pipeline.py](/home/nyuad/rytm/python/coach/langgraph_pipeline.py:1)
- [docs/08_pipeline_update.md](/home/nyuad/rytm/docs/08_pipeline_update.md:1)

Behavior:

- malformed agent JSON now gets one retry with a stricter JSON-only reminder
- parser now tolerates a few common glitches, including empty fence-only outputs and stray alphanumeric tokens like `A2` where a numeric index was expected

This specifically targets brittle failures in agents like `holistic_status_reporter` and `fusion_critic`.

### Coach Runtime Journal Override

Added a separate coach-time journal bypass that does not overwrite stored preprocessing artifacts.

Updated:

- [python/coach/data_fetcher.py](/home/nyuad/rytm/python/coach/data_fetcher.py:1)
- [docs/08_pipeline_update.md](/home/nyuad/rytm/docs/08_pipeline_update.md:1)

New env flag:

- `IGNORE_JOURNAL_IN_COACH=true`

Behavior:

- leaves `journal_summary2` unchanged
- leaves `daily_input_bundle_v12` unchanged in the database
- leaves `user_state_history2` unchanged in the database
- strips journal from the in-memory prepared context that the Python coach consumes

Current runtime stripping includes:

- `bundle_json.journal`
- `missingness_json.missing_journal`
- `confidence_json.confidence_journal`
- `current_state.episodic_memory`
- `recent_state_history[*].state_snapshot_json.episodic_memory`

# 08 Pipeline Update

## What Changed

This update moves the active morning coach pipeline off the old raw-data MVP path and onto the prepared deterministic artifacts built before the coach runs.

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

## Graph Migration

The active LangGraph path now uses:

1. `fetch_data`
2. `fetch_goal`
3. `generate_holistic_status_report`
4. `build_constraints`
5. `route_domains`
6. `generate_actions`
7. `review_actions`
8. `enforce_budget`
9. `compose_brief`
10. `persist_plan`

Removed from the active graph path:

- `ingest_validate`
- `compute_features`

These old raw-data nodes are no longer used for morning coach generation. The legacy raw-feature files are still present in the repo for reference, but the active morning summary flow no longer depends on them.

## Prepared Context Design

The Python fetch layer now reads:

- `daily_input_bundle_v12`
- `user_state_current2`
- recent `user_state_history2`
- `profiles` for name/timezone personalization

It does **not** reload:

- `daily_overall`

Rationale:

- `overall_score` is already provided to the Python runner by the route.
- `overall_true_today` is already embedded in `daily_input_bundle_v12`.
- reloading `daily_overall` inside Python would recreate the old dual-source ambiguity we wanted to remove.

## Why `fetch_goal` Stayed Separate

`user_goals1` is now loaded only in `fetch_goal`, not in the prepared-context fetch.

Rationale:

- goal loading is conceptually different from deterministic bundle/state loading
- it keeps the migration cleaner and avoids loading `user_goals1` twice
- it lets the graph preserve the existing "objective first, goal second" structure

Past recommended actions now come from `user_state_history2.actions_generated_json`, not `plan_actions1`.

Rationale:

- it is aligned with the new auditable-state design
- it avoids schema drift with older `plan_actions1` columns
- it keeps action-memory tied to the same generated output the new coach path actually produced

## Journal Skip Override

`SKIP_JOURNAL_SUMMARY2=true` now overrides an existing processed `journal_summary2` row for that day by upserting the deterministic skipped/null-style payload.

This was changed because the previous logic returned `"existing"` before the skip guard, which prevented controlled journal disabling during backfills or experiments.

Current behavior:

- no messages => insert nothing, return `missing_journal`
- messages + skip flag => upsert skipped row
- messages + no skip flag + existing row => return `existing`
- messages + no skip flag + no existing row => extract and upsert

## Coach-Time Journal Bypass

Added a separate runtime-only flag for the coach:

- `IGNORE_JOURNAL_IN_COACH=true`

This does **not** overwrite:

- `journal_summary2`
- `daily_input_bundle_v12`
- `user_state_history2`

Instead, it modifies the Python prepared context in memory before prompting:

- `bundle_json.journal` is replaced with an empty/null-style journal object
- `missingness_json.missing_journal = true`
- `confidence_json.confidence_journal = 0`
- `current_state.episodic_memory` is stripped
- `recent_state_history[*].state_snapshot_json.episodic_memory` is stripped

Use this when you want the coach to behave as if journal is absent for generation, while preserving the stored processed data for later use.

## Meal Descriptions And Caffeine

The prepared bundle now includes a `nutrition.meal_context` block with:

- `meal_descriptions`
- `estimated_caffeine_mg_day`
- `caffeine_after_2pm`

Meal descriptions come from `meal_logs` for the target local day.
Per-meal caffeine comes from the latest successful `meal_processing_runs.totals.caffeine_mg`.

## Timezone Override Fix

The bundle builder now accepts an explicit timezone override.

Rationale:

- backfills that are intentionally split across historical timezone periods must not silently fall back to the user's current canonical timezone
- the same explicit timezone used for nutrition/journal/day-boundary preprocessing must also be used when writing `daily_input_bundle_v12.meta.timezone`

This keeps the bundle metadata and local-day slicing aligned during manual historical repairs.

## Easy Correctness Fixes

Two low-risk timing bugs were corrected:

### Watch-Date Split

The active bundle builder now uses:

- `submissionDate`
  - `daily_overall`
  - `fitbit_sleep_daily`
  - `fitbit_spo2_daily`
  - `fitbit_overnight_daily`
- `sourceDate`
  - `fitbit_hrv_daily`
  - `fitbit_activity_daily`
  - nutrition / checkin / journal / meal context

This matches the intended semantics where overnight sleep/oxygen signals belong to the wake-up morning, while HRV/activity remain attached to the previous day context.

### Sleep Clock Times

`sleep_onset_time_minutes` and `wake_time_minutes` now come directly from the stored Fitbit sleep timestamp strings, using the clock time embedded in `fitbit_sleep_daily.sleep_start_time` / `sleep_end_time`.

They are no longer re-derived through `minutesFromMidnight(..., timezone)`.

### Empty Meal-Time Logging

The active `logMeal()` write path no longer sends `p_at = now()` when the user leaves the optional meal time blank.

That means the SQL RPC once again owns the fallback behavior for missing times instead of silently converting blank times into "logged right now".

## Meal Day vs Time Migration

The meal contract is being migrated to separate:

- `meal_local_date`: which local day the meal belongs to
- `meal_datetime`: the exact UTC instant, only when the user actually supplied a time

Active code now assumes:

- day membership comes from `meal_local_date`
- exact timing is optional
- nutrition totals include all meals for the day
- `time_first_meal_minutes`, `time_last_meal_minutes`, and `eating_window_minutes` only use meals where `meal_datetime` is present

This avoids using fake noon timestamps as if they were real meal timing evidence.

Required database migration before runtime use:

```sql
alter table public.meal_logs
  add column if not exists meal_local_date date;

update public.meal_logs
set meal_local_date = (
  meal_datetime
  at time zone coalesce(
    (select fp.user_timezone from public.fitbit_profile fp where fp.app_user_id = meal_logs.user_id limit 1),
    'UTC'
  )
)::date
where meal_local_date is null
  and meal_datetime is not null;

alter table public.meal_logs
  alter column meal_datetime drop not null;

alter table public.meal_logs
  alter column meal_local_date set not null;

create index if not exists idx_meal_logs_user_local_date
  on public.meal_logs(user_id, meal_local_date);
```

After that migration, the updated `log_meal_for_date()` function should be deployed from [supabase/function_rpcs.sql](/home/nyuad/rytm/supabase/function_rpcs.sql:1).

Follow-on sweep completed:

- `process-backfill` now discovers meals by user-local date window via `meal_local_date`
- meal-processing batch scripts now use `meal_local_date` for discovery and keep `meal_datetime` only for optional ordering/debug display
- dashboard and bundle meal queries no longer lose meals that were logged without an exact time

## Forward Recompute

Added a forward recompute path for backlog edits.

New helper:

- [src/lib/overall-submission-workflows/recomputeForward.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/recomputeForward.ts:1)

New API route:

- [src/app/api/workflows/recompute-forward/route.ts](/home/nyuad/rytm/src/app/api/workflows/recompute-forward/route.ts:1)

New script:

- [scripts/recompute_morning_preparation_forward.ts](/home/nyuad/rytm/scripts/recompute_morning_preparation_forward.ts:1)

Behavior:

- a backlog change to a **source-day** artifact (meal, check-in, journal) recomputes from `changedLocalDate + 1` submission day forward to today
- a backlog change to a **submission-day** artifact (overall score) recomputes from `changedLocalDate` forward to today

Current trigger points:

- backlog meal logs from [src/lib/db/dashboard.ts](/home/nyuad/rytm/src/lib/db/dashboard.ts:1)
- backlog check-ins from [src/lib/db/dashboard.ts](/home/nyuad/rytm/src/lib/db/dashboard.ts:1)
- backlog journal writes from [src/app/api/journal/route.ts](/home/nyuad/rytm/src/app/api/journal/route.ts:1)
- backlog overall submissions from [src/app/api/dashboard/submit-overall/route.ts](/home/nyuad/rytm/src/app/api/dashboard/submit-overall/route.ts:1)

Implementation note:

- this is a best-effort background schedule using an unawaited recompute task
- it avoids blocking the user-facing backlog action, but it is not a durable job queue yet

## LLM JSON Robustness

The Python LangGraph pipeline now does a one-shot retry when an agent returns malformed JSON.

Added protections in [python/coach/langgraph_pipeline.py](/home/nyuad/rytm/python/coach/langgraph_pipeline.py:1):

- more tolerant cleanup for near-JSON outputs
- coercion for common glitches like bare `A2`-style tokens in numeric arrays
- one retry with a stricter "JSON only" reminder before failing the run

## Goals, Plans, And Actions Migration Spec

### Current Source Of Truth

The current coach stack uses a hybrid storage model:

- `user_goals1`
  - source of truth for the user's active goal
- `daily_plans1`
  - source of truth for the persisted morning brief row shown in the UI
- `plan_actions1`
  - source of truth for the structured action cards shown in the UI
- `user_state_history2.actions_generated_json`
  - source of truth for longitudinal coach-memory and future action-history comparisons

This means actions are not truly generated twice.

What actually happens is:

1. the LLM generates one set of candidate actions
2. budget enforcement chooses the final displayed action set
3. those displayed actions are:
   - referenced in the written `morning_message`
   - returned directly from the morning-run API
   - persisted into `plan_actions1`
   - copied into `user_state_history2.actions_generated_json`

The apparent duplication in the UI comes from two different render surfaces:

- the free-text brief may narrate only the top 3 actions in prose
- the action list below renders the full `actions` array, which can contain 4

Relevant UI path:

- [src/app/coach/page.tsx](/home/nyuad/rytm/src/app/coach/page.tsx:132) sets `plan.actions = data.actions || []` from the morning-run response
- [src/components/coach/MorningSummaryCard.tsx](/home/nyuad/rytm/src/components/coach/MorningSummaryCard.tsx:86) renders `plan.actions` as the structured action cards
- [src/lib/db/coachPipeline.ts](/home/nyuad/rytm/src/lib/db/coachPipeline.ts:22) reads persisted plans from `daily_plans1` + `plan_actions1` when the page is reloaded later

### Current Problems

The current model works, but it still mixes old and new assumptions.

1. Goals are still fine structurally, but they are fetched outside the prepared bundle/state model.
2. Plans are persisted in legacy-shaped tables even though the generation inputs are now bundle/state driven.
3. Actions still carry legacy evaluation fields:
   - `required_feature_keys`
   - `success_criteria.feature_key`
   - `evaluation_mode`
4. `plan_actions1` expects feature-key-based evaluation semantics, but the new coach reasons over richer bundle/state JSON.
5. The frontend reads `plan_actions1` with a UI-oriented shape that is not fully aligned with what the persistence agent writes.
6. `user_state_history2.actions_generated_json` is already the better place for historical action memory, so `plan_actions1` should stop carrying longitudinal responsibility.

### Migration Goal

Move to a clean separation:

- `user_goals1`
  - user intent
- `daily_input_bundle_v12`
  - deterministic day context
- `user_state_current2`
  - current user memory
- `user_state_history2`
  - auditable historical memory, including generated actions and later outcomes
- `daily_plans1` / `plan_actions1`
  - UI delivery layer for the rendered morning plan only

In this design, `plan_actions1` is no longer the place where we encode the deeper logic of evaluation against old enum feature keys.

### Proposed Action Contract

Keep one action object shape across:

- LangGraph internal state
- `plan_actions1`
- `user_state_history2.actions_generated_json`

Proposed canonical action fields:

```json
{
  "action_id": "string",
  "action_source": "generated|library|carry_forward",
  "domain": "sleep|recovery|nutrition|stability|stress|focus|other",
  "title": "string",
  "description": "string|null",
  "rationale": "string",
  "when": "morning|midday|afternoon|evening|before_bed|anytime|null",
  "priority": 1,
  "effort_level": "low|medium|high",
  "duration_minutes": null,
  "assumptions": [],
  "feasibility_constraints": {},
  "fallbacks": [],
  "evaluation": {
    "mode": "auto|user_rating|mixed|none",
    "signal_refs": [],
    "completion_prompt": null,
    "success_definition": null
  },
  "evidence": {
    "bundle_refs": [],
    "state_refs": [],
    "history_refs": []
  }
}
```

### Replace Enum-Backed Evaluation

Current legacy fields:

- `required_feature_keys`
- `success_criteria.feature_key`

should be replaced with JSON-path-style references to the actual prepared inputs the coach used.

Examples:

- `bundle_refs`
  - `sleep.sleep_duration_hours`
  - `nutrition.protein_g_day`
  - `nutrition.meal_context.estimated_caffeine_mg_day`
- `state_refs`
  - `baselines.sleep_duration_hours.fast.center_ewma`
  - `residual_signature.gap.run_length.current_mismatch_days`
  - `volatility.global.volatility_index`
- `history_refs`
  - `recent_deviations.sleep_duration_hours`
  - `recent_actions[0].domain`

This keeps action evaluation aligned with the actual bundle/state system rather than the old `feature_key_v1` enum.

### Proposed Table Responsibilities

#### `user_goals1`

No immediate schema migration required.

Use it for:

- active goal title
- goal type
- goal spec JSON
- primary domains

Do not duplicate goal state into `plan_actions1`.

#### `daily_plans1`

Keep as the per-day plan container.

Recommended responsibilities:

- `plan_id`
- `user_id`
- `for_date`
- `morning_message`
- `selected_domains_json`
- `day_constraints_json`
- `budget_applied_json`
- `plan_json`
  - can include model name, prompt version, coach runtime flags, and summary metadata

This remains the UI-facing plan shell.

#### `plan_actions1`

Retain only UI/action-card persistence responsibilities.

Recommended stored fields:

- `plan_id`
- `user_id`
- `for_date`
- `action_id`
- `action_source`
- `domain`
- `title`
- `description`
- `rationale`
- `when`
- `priority`
- `effort_level`
- `duration_minutes`
- `assumptions_json`
- `feasibility_constraints_json`
- `fallbacks_json`
- `evaluation_json`
- `evidence_json`
- `tags`

Recommended deprecation target:

- `required_feature_keys`
- `success_criteria_json` in its current enum-backed form

If backward compatibility is needed, these legacy fields can be temporarily filled from the new `evaluation_json`, but they should stop being the primary contract.

#### `user_state_history2.actions_generated_json`

This should become the authoritative historical action-memory object.

Store:

- generated themes
- final displayed actions
- any follow-up questions
- optionally later outcomes/evaluations linked back to action IDs

This is the table to use for:

- repetition control
- "what worked before"
- post-hoc evaluation
- future action carry-forward logic

### UI Display Rule

To remove the "3 actions in prose, 4 below" ambiguity, the brief composer should be instructed to explicitly reference the same number of display actions returned by budget enforcement.

Recommended rule:

- if `display_actions.length = N`, the prose should mention all `N` actions or clearly say "here are the top 3 of 4"

That is a prompt/presentation fix, not a second-generation bug.

### Recommended Implementation Order

1. Align `plan_actions1` persistence with what the frontend currently reads:
   - ensure `title`, `description`, `rationale`, `duration_minutes`, and `when` are stored consistently
2. Add `evaluation_json` and `evidence_json`
3. Stop treating `required_feature_keys` as the primary evaluation contract
4. Update prompts so generated actions emit `evaluation` + `evidence` instead of enum feature keys
5. Keep writing the same action objects into `user_state_history2.actions_generated_json`
6. Later, optionally thin `plan_actions1` into a pure UI cache once the state-history action memory is fully trusted

### Current Decision

For the next migration phase:

- keep `user_goals1` as-is
- keep `daily_plans1` as the per-day UI plan shell
- keep `plan_actions1` for current display
- treat `user_state_history2.actions_generated_json` as the long-term action memory
- migrate action evaluation semantics away from enum-backed feature keys and toward bundle/state JSON references

This is intended to reduce brittle morning-run failures when the model produces almost-valid structured output.

## Meal Processing Retry And Skip Policy

`dailyNutrition2` now includes a backfill-friendly retry and skip policy for meal processing.

Behavior:

- retries transient meal-processing failures up to `MEAL_PROCESSING_MAX_RETRIES`
- retryable failures include connection/timeouts/fetch-failed style transport issues
- if `SKIP_MEAL_PROCESSING_FAILURES=true`, exhausted meal-processing failures are logged and skipped instead of aborting the whole morning-preparation run
- `compute_daily_nutrition2` then proceeds using whatever successful meal-processing rows exist for that day

Environment controls:

- `MEAL_PROCESSING_MAX_RETRIES` (default `3`)
- `SKIP_MEAL_PROCESSING_FAILURES` (`true` / `false`, default `false`)

This policy was added mainly for long historical backfills, where a single transient LLM/network failure should not force the whole range rebuild to restart.

## Meal Processing Contract Update

Meal processing was extended to support caffeine:

- pipeline version bumped from `v1.0` to `v1.1`
- estimation prompt now asks for `caffeine_mg` per item and in totals
- TypeScript types now include `caffeine_mg`
- schema file now documents `caffeine_mg` columns for:
  - `meal_items_v1`
  - `food_cache_v1`

Important note:

- the codebase is now ready for caffeine-aware reprocessing
- the live database still needs the corresponding SQL migration applied before those new item/cache columns will be writable

The version bump matters because meal processing is idempotent on `(meal_id, pipeline_version)`. Without a version bump, older meals would not be reprocessed and the new caffeine fields would remain empty for past rows.

## Prompt Migration

The LLM prompts were updated so the agents reason from:

- prepared bundle
- auditable state
- recent state history
- bundle missingness/confidence
- meal descriptions and caffeine context

instead of the old:

- raw snapshot
- validator output
- on-the-fly feature map

## Inputs And State Fields: Used vs Not Yet First-Class

### Clearly used now

- `bundle.core_signals`
- `bundle.watch.sleep`
- `bundle.watch.hrv`
- `bundle.watch.activity.resting_heart_rate`
- `bundle.nutrition.daily_nutrition`
- `bundle.nutrition.meal_context`
- `bundle.checkin`
- `bundle.journal`
- `current_state.baselines`
- `current_state.slopes`
- `current_state.volatility`
- `current_state.residual_signature`
- `current_state.uncertainty`
- recent `user_state_history2.deviations_json`
- recent `user_state_history2.actions_generated_json`

### Present and available, but not yet promoted into dedicated helper summaries

- some overnight watch details such as `spo2_avg`, `blood_oxygen_avg`, `breathing_rate`, `skin_temp_relative`
- `current_state.lag_relations`
- `current_state.episodic_memory` beyond whatever the LLM notices in the raw serialized state
- `current_state.advice_memory`
- journal `evidence_quotes`

These are still passed through the serialized bundle/state objects, so the LLM can use them. They are simply not yet elevated into explicit prompt-side helper summaries the way sleep, proxy gap, deviations, and meal context are.

This was an intentional tradeoff for the migration:

- first make bundle/state the source of truth
- then selectively promote additional fields into smaller prompt-ready summaries once we see which ones materially improve coaching quality

## What Was Intentionally Not Done Yet

- no deletion of the old deterministic Python files yet
- no separate final graph node for `user_state_history2.actions_generated_json` writeback
- no full prompt-side summarizer for `lag_relations` / `episodic_memory` / `advice_memory`
- no change to goal persistence or plan persistence tables

## Why This Is Internally Consistent

- deterministic preprocessing still happens before coach generation
- the morning route still gates on state readiness before any LLM call
- the Python graph now consumes the same prepared artifacts that the deterministic workflows create
- meal descriptions no longer depend on the removed feature-computation path
- caffeine now has a path from extraction -> processed meal totals -> prepared bundle -> action generation

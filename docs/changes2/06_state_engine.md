# 06_state_engine

## What

Added a deterministic state engine under:

- [src/lib/overall-submission-workflows/state_engine/updateState.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/state_engine/updateState.ts:1)
- [src/lib/overall-submission-workflows/state_engine/index.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/state_engine/index.ts:1)

The engine updates:

- `user_state_current2`
- `user_state_history2` stub row for the same day

It is designed to run after:

1. input bundle generation
2. state update
3. later morning summary / actions generation

## Design

The implementation is deterministic and auditable. It reads recent `daily_input_bundle_v12` rows and computes:

- fast baseline memory with `effective_days = 7`
- slow baseline memory with `effective_days_current = min(valid_days, 30)` once `valid_days >= 7`
- slopes via EWMA delta
- robust scale via MAD
- per-feature volatility classes
- rolling 14-day lag relations when enough paired points exist
- residual gap signature
- compressed episodic memory
- modality availability and readiness flags

## History Snapshot

The `user_state_history2.state_snapshot_json` uses the compact subset approach:

- summary baselines and volatility for core features
- slopes for core features
- residual signature
- lag relations
- uncertainty
- compressed episodic memory
- compressed advice memory

This keeps history analysis-friendly without storing the full state blob redundantly.

## Readiness Gate

The state engine writes state even when history is sparse, but returns a summary gate:

- `shouldRunSummary = false` when fast core baselines are not ready
- `fast_ready` and `slow_ready` are stored in the uncertainty block

This is intended to let the future orchestration layer skip morning summary generation until enough user-specific baseline history exists.

## Pipeline Wiring

The workflow day-test runner now executes:

1. `ensureDailyNutrition2`
2. `ensureDailyCheckinRelation2`
3. `ensureJournalSummary2`
4. `build_daily_input_bundle_v1`
5. `updateState`

## Notes

- Sleep onset and wake time are tracked directly from the input bundle in local user time minutes-from-midnight.
- `user_state_history2.actions_generated_json` is intentionally initialized as an empty stub and can be updated later by the coach run.
- Advice memory currently carries forward the compact memory already stored in `user_state_current2`; it does not yet reconstruct themes/actions from past coach outputs.

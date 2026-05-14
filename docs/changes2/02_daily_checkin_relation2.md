# 02 Daily Checkin Relation2

## What

Added deterministic day-level intrarelation computation for `daily_checkin_relation2` in:

- [src/lib/overall-submission-workflows/dailyCheckinRelation2.ts](/home/nyuad/rytm/src/lib/overall-submission-workflows/dailyCheckinRelation2.ts:1)

## Why

This creates a small, auditable preprocessing step for checkin-derived relational signals without mixing it into the older coach pipeline.

## Logic

The module provides:

- `compute_checkin_relations(checkin_row) -> dict | null`
- `upsert_daily_checkin_relation2(user_id, date, relations)`

Computed fields:

- `stress_minus_workload`
- `stress_minus_coping`
- `coping_minus_workload`
- `stress_minus_sleep`
- `sleep_minus_energy`
- `focus_minus_energy`
- `focus_minus_stress`
- `mood_minus_stress`
- `mood_minus_energy`
- `social_minus_mood`
- `emotion_count`

Each relational feature is a simple deterministic difference between the two source scores. If either source score is missing, that relation is stored as `null`.

`emotion_count` is computed as the length of `mood_emotions`, defaulting to `0` if the array is missing.

## Missingness

If the raw `daily_checkins` row for that user-day is missing, `compute_checkin_relations(...)` returns `null` and `upsert_daily_checkin_relation2(...)` does not insert a row.

Bundle-level missingness handling is intentionally deferred to later workflow stages.

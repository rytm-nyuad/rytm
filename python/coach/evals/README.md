# Coaching Evals

This directory contains the basic evaluation pipeline for replaying morning brief
generation and then judging the saved briefings with one or more LLM judges.

## Pipeline shape

1. Sequentially regenerate morning briefings for one user across a submission-date window.
2. Export one judge-input JSON file per generated briefing.
3. Sequentially score those exported examples with one or more judge models.
4. Write one CSV per judge model, plus raw JSONL responses.

## Why sequential

Both stages are intentionally sequential:

- generation is sequential because the coach reads state history and past actions
- judging is sequential because timing and prior-day continuity matter, and each
  judge receives the previous day's generated actions as context

## Files

- `replay_morning_briefs.ts`
  - replays coach generation for a date window
  - overwrites `daily_plans1` for each replayed date
  - exports one judge-input JSON per generated briefing

- `run_judging.ts`
  - reads exported judge-input JSON files
  - calls one or more judge LLMs sequentially
  - writes one CSV per judge model with per-question scores and rationale columns

- `merge_judge_inputs.ts`
  - combines multiple generation-run `judge_inputs/` folders into one merged folder
  - intended for benchmarks that span multiple replay runs, including timezone changes

- `rubrics/morning_brief_rubric_v1.json`
  - the first rubric definition based on the current evaluation questions

## Typical usage

Replay a user's morning briefings:

```bash
npm run coach-evals:replay -- <userId> 2026-02-01 2026-03-28
```

Judge the exported briefings:

```bash
npm run coach-evals:judge -- --inputs-dir python/coach/evals/runs/generation/<run-id>/judge_inputs
```

Merge multiple generation runs first:

```bash
npm run coach-evals:merge -- <generation-run-a> <generation-run-b>
```

## Output layout

```text
python/coach/evals/runs/
├── generation/
│   └── <run-id>/
│       ├── manifest.json
│       └── judge_inputs/
│           ├── 2026-02-01__<plan-id>.json
│           └── ...
├── merged_inputs/
│   └── <run-id>/
│       ├── manifest.json
│       └── judge_inputs/
│           ├── 2026-02-01__<plan-id>.json
│           └── ...
└── judging/
    └── <run-id>/
        ├── manifest.json
        ├── raw/
        │   ├── openai_gpt-4.1.jsonl
        │   └── ...
        └── csv/
            ├── openai_gpt-4.1.csv
            └── ...
```

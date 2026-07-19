# Next-day overall_score clustering experiment

Same clustering scenarios as `experiments/explore_clustering_variants.py`, but **overall_score is aligned from the next calendar day**.

## Alignment

| On each row (feature_date **D**) | Source |
|---|---|
| Sleep / activity / check-in features | Date **D** |
| `overall_score` | Date **D+1** (next morning) |

Rows without a next-day OS are dropped. Feature days are still capped at `--as-of` (inclusive); OS may be taken from `as_of + 1`.

Interpretation framing: *“On days with this feature profile, the **next** morning’s overall_score tended to be …”*

## Prompts

Primary LLM system prompt: `BEHAVIOR_PROFILE_INTERPRETER_SYSTEM_PROMPT_NEXT_DAY_OS` in
`python/coach/prompts.py` (predictive / lead-lag framing).

Each run also stores a production-prompt A/B (`llm_interpretation_production`) using
`BEHAVIOR_PROFILE_INTERPRETER_SYSTEM_PROMPT` with the same next-day `feature_timing`.

## Run one user

```bash
python/coach/.venv/Scripts/python.exe ^
  experiments/next_day_overall_score/explore_next_day_os.py ^
  --user-id <uuid> ^
  --as-of 2026-02-28 ^
  --json-out experiments/next_day_overall_score/clustering_variants_result_<short8>.json
```

Default user writes `clustering_variants_result.json` (ba7806f0). Use `--skip-llm` to skip interpretations.

## Cross-user analysis

After all result JSONs are in this directory:

```bash
python/coach/.venv/Scripts/python.exe ^
  experiments/next_day_overall_score/_build_cross_user_analysis.py
```

Writes `clustering_variants_cross_user_analysis.md` and `.json` here.

# Correlation archetypes

Production path lives under `python/coach/` (`behavior_correlation.py`, `run_correlation_archetype_update.py`). Experiments here are for dry-runs and ops.

## Cohort baseline (distinctiveness)

The cohort baseline is a **cached average Spearman heatmap** across users with enough data. Individual archetype jobs load the latest row from `correlation_cohort_baselines1` and compute:

`delta = user_ρ − cohort_mean_ρ`

Large deltas are “what makes this person distinctive” (e.g. mood–social much stronger than typical).

```bash
# Apply supabase/correlation_cohort_baselines.sql first (SQL editor or apply script)

# Write a new baseline row (service role)
python/coach/.venv/Scripts/python.exe experiments/build_correlation_cohort_baseline.py

# Print only (no DB write)
python/coach/.venv/Scripts/python.exe experiments/build_correlation_cohort_baseline.py --dry-run
```

Defaults: ≥7 feature days per user; keep a cell only if ≥3 users contributed.

## Scripts

```bash
# Same-day clustering variants (from repo root, coach venv)
python/coach/.venv/Scripts/python.exe experiments/explore_clustering_variants.py --skip-llm

# Next-day variants
python/coach/.venv/Scripts/python.exe experiments/next_day_overall_score/explore_next_day_os.py --skip-llm

# Correlation archetypes (Spearman; metrics only)
python/coach/.venv/Scripts/python.exe experiments/explore_correlation_archetypes.py --skip-llm
python/coach/.venv/Scripts/python.exe experiments/explore_correlation_archetypes.py --all-users --skip-llm

# Force-run production correlation archetype job for one user
python/coach/.venv/Scripts/python.exe python/coach/run_correlation_archetype_update.py <user_id> force
```

## Portfolio results

See **[CLUSTERING_EXPERIMENTS_PORTFOLIO.md](./CLUSTERING_EXPERIMENTS_PORTFOLIO.md)** for an anonymized summary of:

1. Same-day overall_score clustering variants  
2. Next-day overall_score clustering variants  

Apply schemas first if needed (Supabase SQL editor or apply scripts):

- `supabase/user_correlation_archetypes.sql`
- `supabase/correlation_cohort_baselines.sql`

Result JSON / cross-user analysis files are gitignored; regenerate locally as needed.

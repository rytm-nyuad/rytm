# Experiments

Temporary exploration scripts (not production).

## Portfolio results

See **[CLUSTERING_EXPERIMENTS_PORTFOLIO.md](./CLUSTERING_EXPERIMENTS_PORTFOLIO.md)** for an anonymized summary of:

1. Same-day overall_score clustering variants  
2. Next-day overall_score clustering variants  

## Scripts

```bash
# Same-day variants (from repo root, coach venv)
python/coach/.venv/Scripts/python.exe experiments/explore_clustering_variants.py --skip-llm

# Next-day variants
python/coach/.venv/Scripts/python.exe experiments/next_day_overall_score/explore_next_day_os.py --skip-llm
```

Result JSON / cross-user analysis files are gitignored; regenerate locally as needed.

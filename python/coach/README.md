# RYTM Coach (Python)

Package layout (import with `python/coach` on `sys.path`):

| Package | Contents |
|---|---|
| `llm/` | `prompts.py`, `llm_config.py` |
| `pipeline/` | LangGraph morning coach, deterministic agents, logging, action helpers |
| `data/` | Supabase feature fetch + feature computer |
| `profiling/` | OS-only clustering, findings/gates, behavior-profile agent/store |
| `correlations/` | Within-user correlations + archetype agent/store |
| `tests/` | Unit tests |
| `evals/` | Brief eval tooling |

CLI entrypoints stay at this directory root (`run_pipeline.py`, `run_behavior_profile_update.py`, …).

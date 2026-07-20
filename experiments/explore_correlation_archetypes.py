"""
TEMPORARY exploration: Spearman correlation archetypes for one or all users.

Usage (from repo root, coach venv):
  python/coach/.venv/Scripts/python.exe experiments/explore_correlation_archetypes.py --skip-llm

  python experiments/explore_correlation_archetypes.py \\
    --user-id <uuid> --skip-llm
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parents[1]
COACH_DIR = REPO_ROOT / "python" / "coach"
sys.path.insert(0, str(COACH_DIR))

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:  # pragma: no cover
    def load_dotenv(*args, **kwargs):
        return False

from supabase import create_client

from profiling.behavior_clustering import InsufficientDataError  # noqa: E402
from correlations.behavior_correlation import (  # noqa: E402
    CORRELATION_FEATURE_KEYS,
    run_user_correlation,
)
from correlations.correlation_archetype_store import get_latest_cohort_baseline  # noqa: E402


DEFAULT_USER_ID = "ba7806f0-d26f-4b9d-95d7-917d4159b638"


def list_user_ids(client) -> List[str]:
    user_ids: set[str] = set()
    page_size = 1000
    offset = 0
    while True:
        response = (
            client.table("daily_features1")
            .select("user_id")
            .in_("feature_key", CORRELATION_FEATURE_KEYS)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = response.data or []
        for row in batch:
            if row.get("user_id"):
                user_ids.add(row["user_id"])
        if len(batch) < page_size:
            break
        offset += page_size
    return sorted(user_ids)


def summarize_result(user_id: str, result) -> Dict[str, Any]:
    return {
        "user_id": user_id,
        "days_used": result.days_used,
        "days_after_junk_filter": result.days_after_junk_filter,
        "junk_days_dropped": result.junk_days_dropped,
        "data_window_start": result.data_window_start,
        "data_window_end": result.data_window_end,
        "trusted_edge_count": len(result.trusted_edges),
        "trusted_edges": result.trusted_edges[:10],
        "distinctive_edges": result.distinctive_edges[:8],
        "quality_evaluation": result.quality_evaluation,
        "correlation_metadata": result.correlation_metadata,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", default=None)
    parser.add_argument("--all-users", action="store_true")
    parser.add_argument("--skip-llm", action="store_true", help="Metrics only (default)")
    parser.add_argument(
        "--out",
        default=None,
        help="Optional path to write JSON summary",
    )
    args = parser.parse_args()

    load_dotenv(REPO_ROOT / ".env.local")
    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not supabase_key:
        print(json.dumps({"error": "Missing Supabase credentials"}))
        sys.exit(1)

    client = create_client(supabase_url, supabase_key)
    try:
        baseline = get_latest_cohort_baseline(client)
    except Exception:
        baseline = None

    if args.all_users:
        user_ids = list_user_ids(client)
    else:
        user_ids = [args.user_id or DEFAULT_USER_ID]

    summaries: List[Dict[str, Any]] = []
    for user_id in user_ids:
        try:
            result = run_user_correlation(client, user_id, cohort_baseline=baseline)
            summaries.append(summarize_result(user_id, result))
        except InsufficientDataError as exc:
            summaries.append({"user_id": user_id, "error": str(exc)})
        except Exception as exc:
            summaries.append({"user_id": user_id, "error": str(exc)})

    payload = {
        "users": summaries,
        "cohort_baseline_id": (baseline or {}).get("baseline_id"),
        "feature_keys": CORRELATION_FEATURE_KEYS,
    }
    text = json.dumps(payload, indent=2)
    print(text)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()

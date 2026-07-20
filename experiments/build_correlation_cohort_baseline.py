"""
Build a cached cohort-average Spearman correlation baseline.

Writes one row to correlation_cohort_baselines1 for use by the correlation
archetype agent (distinctiveness = user rho − cohort mean rho).

Usage (from repo root, coach venv):
  python/coach/.venv/Scripts/python.exe experiments/build_correlation_cohort_baseline.py

  python experiments/build_correlation_cohort_baseline.py --min-feature-days 7 --min-users-per-cell 3
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
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

from profiling.behavior_clustering import MIN_DAYS_FOR_CLUSTERING, InsufficientDataError  # noqa: E402
from correlations.behavior_correlation import (  # noqa: E402
    CORRELATION_FEATURE_KEYS,
    MIN_COHORT_USERS_PER_CELL,
    compute_spearman_heatmap,
    fetch_correlation_feature_matrix,
    filter_junk_days,
    _pair_key,
)


def list_candidate_user_ids(client) -> List[str]:
    """Users with any daily_features1 rows (paginate)."""
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


def _rhos_from_filtered(
    filtered,
    *,
    min_feature_days: int,
) -> Optional[Dict[str, float]]:
    if filtered.shape[0] < min_feature_days:
        return None
    feature_keys = [k for k in CORRELATION_FEATURE_KEYS if k in filtered.columns]
    # For cohort mean, use ALL off-diagonal cells with rho (not only trusted),
    # so the baseline reflects typical associations even when sparse.
    heatmap, _ = compute_spearman_heatmap(
        filtered,
        feature_keys,
        min_pair_days=3,
        min_abs_rho=0.0,
    )
    rhos: Dict[str, float] = {}
    for cell in heatmap.get("cells") or []:
        if cell.get("diagonal"):
            continue
        rho = cell.get("rho")
        if rho is None:
            continue
        a = cell["feature_a"]
        b = cell["feature_b"]
        rhos[_pair_key(a, b)] = float(rho)
    return rhos if rhos else None


def accumulate_user_matrix(
    client,
    user_id: str,
    *,
    min_feature_days: int,
) -> Optional[Dict[str, float]]:
    try:
        matrix = fetch_correlation_feature_matrix(client, user_id)
    except InsufficientDataError:
        return None
    if matrix.shape[0] < min_feature_days:
        return None
    filtered, _ = filter_junk_days(matrix)
    return _rhos_from_filtered(filtered, min_feature_days=min_feature_days)


def build_baseline(
    client,
    *,
    min_feature_days: int,
    min_users_per_cell: int,
) -> Dict[str, Any]:
    user_ids = list_candidate_user_ids(client)
    sums: Dict[str, float] = defaultdict(float)
    counts: Dict[str, int] = defaultdict(int)
    users_included = 0
    skipped = 0

    for user_id in user_ids:
        rhos = accumulate_user_matrix(
            client, user_id, min_feature_days=min_feature_days
        )
        if not rhos:
            skipped += 1
            continue
        users_included += 1
        for key, rho in rhos.items():
            sums[key] += rho
            counts[key] += 1

    mean_rho: Dict[str, float] = {}
    n_users: Dict[str, int] = {}
    for key, total in sums.items():
        n = counts[key]
        if n < min_users_per_cell:
            continue
        mean_rho[key] = round(total / n, 6)
        n_users[key] = n

    return {
        "baseline_version": "correlation_cohort_v1",
        "feature_keys": CORRELATION_FEATURE_KEYS,
        "mean_rho_json": mean_rho,
        "n_users_json": n_users,
        "min_users_per_cell": min_users_per_cell,
        "users_included": users_included,
        "metadata_json": {
            "candidate_users_scanned": len(user_ids),
            "users_skipped": skipped,
            "min_feature_days": min_feature_days,
            "cells_kept": len(mean_rho),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build correlation cohort baseline")
    parser.add_argument(
        "--min-feature-days",
        type=int,
        default=MIN_DAYS_FOR_CLUSTERING,
    )
    parser.add_argument(
        "--min-users-per-cell",
        type=int,
        default=MIN_COHORT_USERS_PER_CELL,
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute and print JSON without writing to DB",
    )
    args = parser.parse_args()

    load_dotenv(REPO_ROOT / ".env.local")
    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not supabase_key:
        print(json.dumps({"error": "Missing Supabase credentials"}))
        sys.exit(1)

    client = create_client(supabase_url, supabase_key)
    payload = build_baseline(
        client,
        min_feature_days=args.min_feature_days,
        min_users_per_cell=args.min_users_per_cell,
    )

    if args.dry_run:
        print(json.dumps(payload, indent=2))
        return

    response = client.table("correlation_cohort_baselines1").insert(payload).execute()
    row = (response.data or [{}])[0]
    print(
        json.dumps(
            {
                "status": "success",
                "baseline_id": row.get("baseline_id"),
                "users_included": payload["users_included"],
                "cells_kept": len(payload["mean_rho_json"]),
                "metadata": payload["metadata_json"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

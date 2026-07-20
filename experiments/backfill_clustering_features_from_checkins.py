"""
TEMPORARY: backfill clustering-relevant daily_features1 rows from
daily_overall + daily_checkins when a user has no engineered features yet.

Does not touch wearables. Safe for experiment users who only have self-reports.
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from supabase import Client, create_client

NEGATIVE_EMOTIONS = {
    "tired",
    "tense",
    "frustrated",
    "anxious",
    "angry",
    "sad",
    "overwhelmed",
    "lonely",
    "irritable",
    "stressed",
    "worried",
    "drained",
}


def _load_env() -> None:
    root = Path(__file__).resolve().parents[1]
    for p in (root / ".env.local", root / ".env", root / "python" / "coach" / ".env"):
        if p.exists():
            load_dotenv(p, override=False)


def _client() -> Client:
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    return create_client(url, key)


def _fetch_all(client: Client, table: str, user_id: str, date_col: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    page = 1000
    offset = 0
    while True:
        resp = (
            client.table(table)
            .select("*")
            .eq("user_id", user_id)
            .order(date_col)
            .range(offset, offset + page - 1)
            .execute()
        )
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return rows


def _neg_emotion_ratio(emotions: Optional[List[str]]) -> Optional[float]:
    if not emotions:
        return None
    total = len(emotions)
    if total == 0:
        return None
    neg = sum(1 for e in emotions if str(e).strip().lower() in NEGATIVE_EMOTIONS)
    return round(neg / total, 4)


def build_rows(user_id: str, overalls: List[Dict[str, Any]], checkins: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_date: Dict[str, Dict[str, Any]] = {}
    for row in overalls:
        d = row.get("date")
        if not d:
            continue
        by_date.setdefault(d, {})["overall_score"] = row.get("overall_score")

    for row in checkins:
        d = row.get("checkin_date")
        if not d:
            continue
        slot = by_date.setdefault(d, {})
        mapping = {
            "mood": row.get("mood_score"),
            "stress": row.get("stress_score"),
            "energy": row.get("energy_score"),
            "focus": row.get("focus_score"),
            "workload": row.get("workload_score"),
            "social_connectedness": row.get("social_score"),
        }
        for key, val in mapping.items():
            if val is not None:
                slot[key] = val
        emotions = row.get("mood_emotions")
        if isinstance(emotions, list):
            slot["emotions_count"] = len(emotions)
            ratio = _neg_emotion_ratio(emotions)
            if ratio is not None:
                slot["negative_emotion_ratio"] = ratio

    now = datetime.now(timezone.utc).isoformat()
    out: List[Dict[str, Any]] = []
    for feature_date, values in sorted(by_date.items()):
        for feature_key, value_num in values.items():
            if value_num is None:
                continue
            out.append(
                {
                    "user_id": user_id,
                    "feature_date": feature_date,
                    "feature_key": feature_key,
                    "value_num": float(value_num),
                    "unit": "score" if feature_key != "emotions_count" else "count",
                    "confidence": 1.0,
                    "feature_layer": "derived",
                    "source_lineage_json": {
                        "source": "experiments/backfill_clustering_features_from_checkins.py",
                        "computed_at": now,
                    },
                }
            )
    return out


def backfill_user(client: Client, user_id: str, *, dry_run: bool = False) -> Dict[str, Any]:
    existing = (
        client.table("daily_features1")
        .select("feature_date", count="exact")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    existing_count = existing.count or 0

    overalls = _fetch_all(client, "daily_overall", user_id, "date")
    checkins = _fetch_all(client, "daily_checkins", user_id, "checkin_date")
    rows = build_rows(user_id, overalls, checkins)
    dates = sorted({r["feature_date"] for r in rows})

    if dry_run:
        return {
            "user_id": user_id,
            "dry_run": True,
            "existing_feature_rows": existing_count,
            "overall_days": len(overalls),
            "checkin_days": len(checkins),
            "rows_to_upsert": len(rows),
            "feature_days": len(dates),
            "window": [dates[0], dates[-1]] if dates else None,
        }

    # Upsert in chunks
    chunk = 200
    for i in range(0, len(rows), chunk):
        client.table("daily_features1").upsert(rows[i : i + chunk]).execute()

    return {
        "user_id": user_id,
        "dry_run": False,
        "existing_feature_rows_before": existing_count,
        "overall_days": len(overalls),
        "checkin_days": len(checkins),
        "rows_upserted": len(rows),
        "feature_days": len(dates),
        "window": [dates[0], dates[-1]] if dates else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("user_ids", nargs="+")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    _load_env()
    client = _client()
    for uid in args.user_ids:
        summary = backfill_user(client, uid, dry_run=args.dry_run)
        print(summary)
        if not summary.get("feature_days"):
            print(f"WARNING: no features for {uid}", file=sys.stderr)


if __name__ == "__main__":
    main()

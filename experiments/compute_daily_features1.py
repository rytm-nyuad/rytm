"""
Backfill daily_features1 using the legacy FeatureComputer + FeatureAgent path.

Builds a raw snapshot per day from Fitbit (*_daily via app_user_id), check-ins,
overall, water, and meals — then persists derived features.

Usage (from repo root):
  python/coach/.venv/Scripts/python.exe experiments/compute_daily_features1.py \\
    <user_id> [<user_id> ...]
  python/coach/.venv/Scripts/python.exe experiments/compute_daily_features1.py --dry-run <user_id>
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from dotenv import load_dotenv
from supabase import Client, create_client

ROOT = Path(__file__).resolve().parents[1]
COACH_DIR = ROOT / "python" / "coach"
sys.path.insert(0, str(COACH_DIR))

from data.feature_computer import FeatureComputer  # noqa: E402

# Keys observed in production daily_features1 (enum-safe allowlist).
KNOWN_FEATURE_KEYS: Set[str] = {
    "activity_calories",
    "blood_oxygen_avg",
    "bmr_calories",
    "breakfast_logged",
    "breathing_rate",
    "caffeine_cups",
    "calories_out",
    "daily_checkin_streak",
    "deep_ratio",
    "dinner_logged",
    "distance_total_km",
    "emotions_count",
    "energy",
    "focus",
    "focus_volatility_7d",
    "focus_vs_7d",
    "hrv_deep_rmssd",
    "hrv_rmssd",
    "hrv_volatility_7d",
    "hrv_vs_7d",
    "meal_descriptions",
    "meals_count",
    "mood",
    "mood_volatility_7d",
    "overall_score",
    "oxygen_variation",
    "productivity_proxy_todos_completed_ratio",
    "rem_ratio",
    "resting_heart_rate",
    "sedentary_minutes",
    "skin_temp_relative",
    "sleep_duration_hours",
    "sleep_duration_streak",
    "sleep_efficiency",
    "sleep_volatility_7d",
    "sleep_vs_7d",
    "social_connectedness",
    "soda_ml",
    "steps",
    "steps_vs_7d",
    "stress",
    "stress_volatility_7d",
    "stress_vs_7d",
    "todos_completed_count",
    "todos_count",
    "total_water_ml",
    "very_active_minutes",
    "wake_ratio",
    "workload",
    "negative_emotion_ratio",
    "readiness_score",
}


def _load_env() -> None:
    for p in (ROOT / ".env.local", ROOT / ".env", COACH_DIR / ".env"):
        if p.exists():
            load_dotenv(p, override=False)


def _client() -> Client:
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    return create_client(url, key)


def _parse_date(value: str) -> date:
    return date.fromisoformat(value[:10])


def _fetch_all_eq(
    client: Client,
    table: str,
    *,
    eq_col: str,
    eq_val: str,
    order_col: str,
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    page = 1000
    offset = 0
    while True:
        resp = (
            client.table(table)
            .select("*")
            .eq(eq_col, eq_val)
            .order(order_col)
            .range(offset, offset + page - 1)
            .execute()
        )
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return rows


def _index_by_date(rows: List[Dict[str, Any]], date_col: str) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        d = row.get(date_col)
        if d:
            out[str(d)[:10]] = row
    return out


def _water_for_date(rows: List[Dict[str, Any]], day: date) -> List[Dict[str, Any]]:
    day_s = day.isoformat()
    out = []
    for row in rows:
        dt = row.get("intake_datetime") or ""
        if str(dt)[:10] == day_s:
            out.append(row)
    return out


def _meals_for_date(rows: List[Dict[str, Any]], day: date) -> List[Dict[str, Any]]:
    day_s = day.isoformat()
    out = []
    for row in rows:
        local = row.get("meal_local_date")
        if local and str(local)[:10] == day_s:
            out.append(row)
            continue
        dt = row.get("meal_datetime") or ""
        if str(dt)[:10] == day_s:
            out.append(row)
    return out


def _history_window(
    by_date: Dict[str, Dict[str, Any]],
    end: date,
    days: int = 7,
) -> List[Dict[str, Any]]:
    items = []
    for i in range(days):
        d = (end - timedelta(days=i)).isoformat()
        if d in by_date:
            items.append(by_date[d])
    return items


def build_raw_snapshot(
    *,
    day: date,
    overall_by_date: Dict[str, Dict[str, Any]],
    checkin_by_date: Dict[str, Dict[str, Any]],
    sleep_by_date: Dict[str, Dict[str, Any]],
    activity_by_date: Dict[str, Dict[str, Any]],
    hrv_by_date: Dict[str, Dict[str, Any]],
    overnight_by_date: Dict[str, Dict[str, Any]],
    water_rows: List[Dict[str, Any]],
    meal_rows: List[Dict[str, Any]],
) -> Dict[str, Any]:
    day_s = day.isoformat()
    return {
        "overall": overall_by_date.get(day_s),
        "checkin": checkin_by_date.get(day_s),
        "sleep": sleep_by_date.get(day_s),
        "activity": activity_by_date.get(day_s),
        "hrv": hrv_by_date.get(day_s),
        "overnight": overnight_by_date.get(day_s),
        "readiness": None,
        "water": _water_for_date(water_rows, day),
        "meals": _meals_for_date(meal_rows, day),
        "todos": [],
        "calendar": [],
        "history_7d": {
            "checkins": _history_window(checkin_by_date, day, 7),
            "sleep": _history_window(sleep_by_date, day, 7),
            "hrv": _history_window(hrv_by_date, day, 7),
            "activity": _history_window(activity_by_date, day, 7),
            "readiness": [],
        },
    }


def filter_features(features: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    return {k: v for k, v in features.items() if k in KNOWN_FEATURE_KEYS}


def persist_features(
    client: Client,
    user_id: str,
    for_date: date,
    features: Dict[str, Dict[str, Any]],
) -> None:
    """Upsert features with uniform row keys (PostgREST requires matching keys)."""
    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for feature_key, feature_data in features.items():
        rows.append(
            {
                "user_id": user_id,
                "feature_date": for_date.isoformat(),
                "feature_key": feature_key,
                "value_num": feature_data.get("value_num"),
                "value_text": feature_data.get("value_text"),
                "value_json": feature_data.get("value_json"),
                "unit": feature_data.get("unit"),
                "confidence": feature_data.get("confidence", 1.0),
                "source_lineage_json": {
                    "source": "experiments/compute_daily_features1.py",
                    "computed_at": now,
                },
                "ingestion_run_id": None,
                "feature_layer": "derived",
            }
        )
    if not rows:
        return
    # Chunk to keep payloads modest
    chunk = 80
    for i in range(0, len(rows), chunk):
        client.table("daily_features1").upsert(rows[i : i + chunk]).execute()


def compute_user(
    client: Client,
    user_id: str,
    *,
    dry_run: bool = False,
    start: Optional[date] = None,
    end: Optional[date] = None,
) -> Dict[str, Any]:
    overalls = _fetch_all_eq(client, "daily_overall", eq_col="user_id", eq_val=user_id, order_col="date")
    if not overalls:
        return {"user_id": user_id, "error": "no daily_overall rows"}

    checkins = _fetch_all_eq(
        client, "daily_checkins", eq_col="user_id", eq_val=user_id, order_col="checkin_date"
    )
    sleep = _fetch_all_eq(
        client, "fitbit_sleep_daily", eq_col="app_user_id", eq_val=user_id, order_col="date"
    )
    activity = _fetch_all_eq(
        client, "fitbit_activity_daily", eq_col="app_user_id", eq_val=user_id, order_col="date"
    )
    hrv = _fetch_all_eq(
        client, "fitbit_hrv_daily", eq_col="app_user_id", eq_val=user_id, order_col="date"
    )
    overnight = _fetch_all_eq(
        client, "fitbit_overnight_daily", eq_col="app_user_id", eq_val=user_id, order_col="date"
    )
    water = _fetch_all_eq(
        client, "water_intake_logs", eq_col="user_id", eq_val=user_id, order_col="intake_datetime"
    )
    meals = _fetch_all_eq(
        client, "meal_logs", eq_col="user_id", eq_val=user_id, order_col="meal_datetime"
    )

    overall_by_date = _index_by_date(overalls, "date")
    checkin_by_date = _index_by_date(checkins, "checkin_date")
    sleep_by_date = _index_by_date(sleep, "date")
    activity_by_date = _index_by_date(activity, "date")
    hrv_by_date = _index_by_date(hrv, "date")
    overnight_by_date = _index_by_date(overnight, "date")

    dates = sorted(_parse_date(r["date"]) for r in overalls if r.get("date"))
    if start:
        dates = [d for d in dates if d >= start]
    if end:
        dates = [d for d in dates if d <= end]

    computer = FeatureComputer()

    days_written = 0
    feature_rows = 0
    keys_seen: Set[str] = set()
    sample_day_keys: Dict[str, List[str]] = {}

    for day in dates:
        snapshot = build_raw_snapshot(
            day=day,
            overall_by_date=overall_by_date,
            checkin_by_date=checkin_by_date,
            sleep_by_date=sleep_by_date,
            activity_by_date=activity_by_date,
            hrv_by_date=hrv_by_date,
            overnight_by_date=overnight_by_date,
            water_rows=water,
            meal_rows=meals,
        )
        features = filter_features(computer.compute_all_features(snapshot, day))
        if not features:
            continue
        keys_seen.update(features.keys())
        if len(sample_day_keys) < 1:
            sample_day_keys[day.isoformat()] = sorted(features.keys())
        feature_rows += len(features)
        days_written += 1
        if not dry_run:
            persist_features(client, user_id, day, features)

    return {
        "user_id": user_id,
        "dry_run": dry_run,
        "overall_days": len(overalls),
        "fitbit_sleep_days": len(sleep),
        "fitbit_activity_days": len(activity),
        "days_computed": days_written,
        "feature_cells": feature_rows,
        "window": [dates[0].isoformat(), dates[-1].isoformat()] if dates else None,
        "distinct_feature_keys": sorted(keys_seen),
        "sample_day_keys": sample_day_keys,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill daily_features1 via FeatureComputer")
    parser.add_argument("user_ids", nargs="+")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--start", type=str, default=None, help="YYYY-MM-DD inclusive")
    parser.add_argument("--end", type=str, default=None, help="YYYY-MM-DD inclusive")
    args = parser.parse_args()

    _load_env()
    client = _client()
    start = _parse_date(args.start) if args.start else None
    end = _parse_date(args.end) if args.end else None

    for uid in args.user_ids:
        summary = compute_user(client, uid, dry_run=args.dry_run, start=start, end=end)
        print(summary)
        if summary.get("error"):
            print(f"FAILED {uid}: {summary['error']}", file=sys.stderr)


if __name__ == "__main__":
    main()

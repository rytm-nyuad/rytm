"""
Persistence helpers for user_behavior_profiles1.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Optional

from supabase import Client

PROFILE_REFRESH_DAYS = 21
MIN_DAYS_FOR_CLUSTERING = 7
EMPTY_PROFILE: Dict[str, Any] = {
    "profile_version": "none",
    "summary": "",
    "cluster_interpretations": {},
    "primary_coaching_rule": "",
}


def count_feature_days(client: Client, user_id: str) -> int:
    response = (
        client.table("daily_features1")
        .select("feature_date")
        .eq("user_id", user_id)
        .execute()
    )
    rows = response.data or []
    return len({row["feature_date"] for row in rows})


def get_latest_active_profile(client: Client, user_id: str) -> Optional[Dict[str, Any]]:
    response = (
        client.table("user_behavior_profiles1")
        .select("*")
        .eq("user_id", user_id)
        .eq("status", "active")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return rows[0] if rows else None


def profile_payload_from_row(row: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not row:
        return dict(EMPTY_PROFILE)

    profile_json = row.get("profile_json") or {}
    if profile_json:
        return profile_json

    return {
        "profile_version": row.get("profile_version", "cluster_profile_v1"),
        "summary": row.get("summary", ""),
        "cluster_interpretations": row.get("cluster_interpretations_json") or {},
        "primary_coaching_rule": row.get("primary_coaching_rule", ""),
    }


def is_profile_update_due(
    client: Client,
    user_id: str,
    *,
    as_of: Optional[date] = None,
) -> Dict[str, Any]:
    today = as_of or datetime.now(timezone.utc).date()
    feature_days = count_feature_days(client, user_id)
    latest = get_latest_active_profile(client, user_id)

    if feature_days < MIN_DAYS_FOR_CLUSTERING:
        return {
            "due": False,
            "reason": "insufficient_feature_days",
            "feature_days": feature_days,
            "min_feature_days": MIN_DAYS_FOR_CLUSTERING,
        }

    if not latest:
        return {
            "due": True,
            "reason": "no_active_profile",
            "feature_days": feature_days,
            "min_feature_days": MIN_DAYS_FOR_CLUSTERING,
        }

    created_at = latest.get("created_at")
    if not created_at:
        return {
            "due": True,
            "reason": "missing_created_at",
            "feature_days": feature_days,
            "min_feature_days": MIN_DAYS_FOR_CLUSTERING,
        }

    created_date = datetime.fromisoformat(created_at.replace("Z", "+00:00")).date()
    next_due = created_date + timedelta(days=PROFILE_REFRESH_DAYS)
    due = today >= next_due
    return {
        "due": due,
        "reason": "refresh_interval_elapsed" if due else "not_due_yet",
        "feature_days": feature_days,
        "min_feature_days": MIN_DAYS_FOR_CLUSTERING,
        "latest_profile_id": latest.get("profile_id"),
        "latest_created_at": created_at,
        "next_due_date": next_due.isoformat(),
    }


def has_running_profile_job(client: Client, user_id: str, *, within_hours: int = 2) -> bool:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=within_hours)
    response = (
        client.table("user_behavior_profiles1")
        .select("profile_id, created_at")
        .eq("user_id", user_id)
        .eq("status", "running")
        .gte("created_at", cutoff.isoformat())
        .limit(1)
        .execute()
    )
    return bool(response.data)


def create_running_profile_row(
    client: Client,
    user_id: str,
    run_trigger: str,
) -> str:
    response = (
        client.table("user_behavior_profiles1")
        .insert(
            {
                "user_id": user_id,
                "status": "running",
                "profile_version": "cluster_profile_v1",
                "run_trigger": run_trigger,
            }
        )
        .execute()
    )
    return response.data[0]["profile_id"]


def supersede_active_profiles(client: Client, user_id: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    client.table("user_behavior_profiles1").update(
        {
            "status": "superseded",
            "superseded_at": now,
        }
    ).eq("user_id", user_id).eq("status", "active").execute()


def finalize_profile_row(
    client: Client,
    profile_id: str,
    user_id: str,
    *,
    status: str,
    profile_payload: Dict[str, Any],
    cluster_stats: Dict[str, Any],
    clustering_metadata: Dict[str, Any],
    days_used: int,
    data_window_start: str,
    data_window_end: str,
    error_json: Optional[Dict[str, Any]] = None,
) -> None:
    if status == "active":
        supersede_active_profiles(client, user_id)

    update_payload = {
        "status": status,
        "profile_version": profile_payload.get("profile_version", "cluster_profile_v1"),
        "summary": profile_payload.get("summary", ""),
        "cluster_interpretations_json": profile_payload.get("cluster_interpretations", {}),
        "primary_coaching_rule": profile_payload.get("primary_coaching_rule", ""),
        "profile_json": profile_payload,
        "cluster_stats_json": cluster_stats,
        "clustering_metadata_json": clustering_metadata,
        "days_used": days_used,
        "data_window_start": data_window_start,
        "data_window_end": data_window_end,
        "error_json": error_json or {},
    }
    client.table("user_behavior_profiles1").update(update_payload).eq(
        "profile_id", profile_id
    ).execute()

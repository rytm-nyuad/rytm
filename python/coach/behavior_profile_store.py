"""
Persistence helpers for user_behavior_profiles1.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Optional

from supabase import Client

from behavior_clustering import (
    CLUSTERING_FEATURE_KEYS,
    MIN_DAYS_FOR_CLUSTERING,
    MIN_NEW_FEATURE_DAYS_FOR_REFRESH,
)

PROFILE_REFRESH_DAYS = 21
EMPTY_PROFILE: Dict[str, Any] = {
    "profile_version": "none",
    "summary": "",
    "cluster_interpretations": {},
    "primary_coaching_rule": "",
}


def _normalize_optional_date(value: Optional[str]) -> Optional[str]:
    """Return None for blank date-like values before DB writes."""
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _parse_iso_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    if "T" in text:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    return date.fromisoformat(text[:10])


def count_feature_days(client: Client, user_id: str) -> int:
    """Count distinct feature dates that include clustering-relevant feature keys."""
    dates: set[str] = set()
    page_size = 1000
    offset = 0

    while True:
        response = (
            client.table("daily_features1")
            .select("feature_date")
            .eq("user_id", user_id)
            .in_("feature_key", CLUSTERING_FEATURE_KEYS)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = response.data or []
        for row in batch:
            if row.get("feature_date"):
                dates.add(row["feature_date"])
        if len(batch) < page_size:
            break
        offset += page_size

    return len(dates)


def count_feature_days_after(
    client: Client,
    user_id: str,
    after_date: date,
) -> int:
    """Count distinct clustering-relevant feature dates strictly after after_date."""
    dates: set[str] = set()
    page_size = 1000
    offset = 0
    after_iso = after_date.isoformat()

    while True:
        response = (
            client.table("daily_features1")
            .select("feature_date")
            .eq("user_id", user_id)
            .in_("feature_key", CLUSTERING_FEATURE_KEYS)
            .gt("feature_date", after_iso)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = response.data or []
        for row in batch:
            if row.get("feature_date"):
                dates.add(row["feature_date"])
        if len(batch) < page_size:
            break
        offset += page_size

    return len(dates)


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
    force: bool = False,
) -> Dict[str, Any]:
    """
    Refresh is due when:
      - no active profile and enough total feature days, OR
      - refresh interval elapsed AND enough NEW feature days since data_window_end

    force=True bypasses schedule/new-day requirements (quality gates still apply later).
    """
    today = as_of or datetime.now(timezone.utc).date()
    feature_days = count_feature_days(client, user_id)
    latest = get_latest_active_profile(client, user_id)

    base = {
        "feature_days": feature_days,
        "min_feature_days": MIN_DAYS_FOR_CLUSTERING,
        "min_new_feature_days": MIN_NEW_FEATURE_DAYS_FOR_REFRESH,
        "refresh_interval_days": PROFILE_REFRESH_DAYS,
        "force": force,
    }

    if feature_days < MIN_DAYS_FOR_CLUSTERING and not force:
        return {
            **base,
            "due": False,
            "reason": "insufficient_feature_days",
            "new_feature_days": 0,
            "latest_data_window_end": None,
            "next_due_date": None,
        }

    if not latest:
        return {
            **base,
            "due": True,
            "reason": "no_active_profile" if feature_days >= MIN_DAYS_FOR_CLUSTERING else "force_no_active_profile",
            "new_feature_days": feature_days,
            "latest_data_window_end": None,
            "next_due_date": None,
        }

    created_at = latest.get("created_at")
    created_date = _parse_iso_date(created_at) or today
    next_due = created_date + timedelta(days=PROFILE_REFRESH_DAYS)
    data_window_end = _parse_iso_date(latest.get("data_window_end"))
    new_feature_days = (
        count_feature_days_after(client, user_id, data_window_end)
        if data_window_end
        else feature_days
    )

    payload = {
        **base,
        "latest_profile_id": latest.get("profile_id"),
        "latest_created_at": created_at,
        "latest_data_window_end": data_window_end.isoformat() if data_window_end else None,
        "new_feature_days": new_feature_days,
        "next_due_date": next_due.isoformat(),
    }

    if force:
        return {**payload, "due": True, "reason": "forced"}

    if today < next_due:
        return {**payload, "due": False, "reason": "not_due_yet"}

    if new_feature_days < MIN_NEW_FEATURE_DAYS_FOR_REFRESH:
        return {
            **payload,
            "due": False,
            "reason": "insufficient_new_feature_days",
        }

    return {
        **payload,
        "due": True,
        "reason": "refresh_interval_elapsed_with_new_data",
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


def fail_running_profile_jobs(
    client: Client,
    user_id: str,
    *,
    error_message: str,
) -> None:
    """Mark any currently-running profile refreshes as failed (used for manual recovery)."""
    client.table("user_behavior_profiles1").update(
        {
            "status": "failed",
            "error_json": {"message": error_message},
        }
    ).eq("user_id", user_id).eq("status", "running").execute()


def create_running_profile_row(
    client: Client,
    user_id: str,
    run_trigger: str,
) -> str:
    """
    Prefer atomic RPC claim when available; fall back to insert.
    Concurrent inserts are protected by partial unique index on status=running when applied.
    """
    try:
        rpc = client.rpc(
            "claim_behavior_profile_job",
            {"p_user_id": user_id, "p_run_trigger": run_trigger},
        ).execute()
        data = rpc.data
        if isinstance(data, list) and data:
            return data[0]
        if isinstance(data, str):
            return data
    except Exception:
        # Schema may not include the RPC yet.
        pass

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


def _build_finalize_payload(
    *,
    status: str,
    profile_payload: Dict[str, Any],
    cluster_stats: Dict[str, Any],
    clustering_metadata: Dict[str, Any],
    quality_evaluation: Optional[Dict[str, Any]],
    days_used: int,
    data_window_start: Optional[str],
    data_window_end: Optional[str],
    error_json: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    return {
        "status": status,
        "profile_version": profile_payload.get("profile_version", "cluster_profile_v1"),
        "summary": profile_payload.get("summary", ""),
        "cluster_interpretations_json": profile_payload.get("cluster_interpretations", {}),
        "primary_coaching_rule": profile_payload.get("primary_coaching_rule", ""),
        "profile_json": profile_payload,
        "cluster_stats_json": cluster_stats,
        "clustering_metadata_json": clustering_metadata,
        "quality_evaluation_json": quality_evaluation or {},
        "days_used": days_used,
        "data_window_start": _normalize_optional_date(data_window_start),
        "data_window_end": _normalize_optional_date(data_window_end),
        "error_json": error_json or {},
    }


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
    data_window_start: Optional[str],
    data_window_end: Optional[str],
    error_json: Optional[Dict[str, Any]] = None,
    quality_evaluation: Optional[Dict[str, Any]] = None,
) -> None:
    """
    Finalize a candidate row.

    Active promotion goes through promote_user_behavior_profile RPC (atomic).
    Non-active statuses use a normal update and never supersede the current active profile.
    """
    update_payload = _build_finalize_payload(
        status=status,
        profile_payload=profile_payload,
        cluster_stats=cluster_stats,
        clustering_metadata=clustering_metadata,
        quality_evaluation=quality_evaluation,
        days_used=days_used,
        data_window_start=data_window_start,
        data_window_end=data_window_end,
        error_json=error_json,
    )

    if status == "active":
        try:
            client.rpc(
                "promote_user_behavior_profile",
                {
                    "p_user_id": user_id,
                    "p_profile_id": profile_id,
                    "p_update_payload": update_payload,
                },
            ).execute()
            return
        except Exception as exc:
            raise RuntimeError(
                f"Atomic promote_user_behavior_profile failed; "
                f"previous active profile left unchanged: {exc}"
            ) from exc

    client.table("user_behavior_profiles1").update(update_payload).eq(
        "profile_id", profile_id
    ).eq("user_id", user_id).execute()

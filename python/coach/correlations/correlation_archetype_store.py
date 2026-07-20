"""
Persistence helpers for user_correlation_archetypes1.

Shares the same 7-day / 21-day refresh constants as behavior clustering.
Due checks are against this table's own active row (independent job schedule,
same numeric gates).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Optional

from supabase import Client

from profiling.behavior_clustering import (
    MIN_DAYS_FOR_CLUSTERING,
    MIN_NEW_FEATURE_DAYS_FOR_REFRESH,
)
from profiling.behavior_profile_store import (
    PROFILE_REFRESH_DAYS,
    count_feature_days,
    count_feature_days_after,
    _normalize_optional_date,
    _parse_iso_date,
)

EMPTY_ARCHETYPE: Dict[str, Any] = {
    "profile_version": "none",
    "archetype_title": "",
    "summary": "",
    "what_heatmap_shows": "",
    "what_it_reflects": "",
    "core_insight": "",
    "strength": "",
    "primary_coaching_rule": "",
    "key_correlations": [],
}


def get_latest_active_archetype(client: Client, user_id: str) -> Optional[Dict[str, Any]]:
    response = (
        client.table("user_correlation_archetypes1")
        .select("*")
        .eq("user_id", user_id)
        .eq("status", "active")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return rows[0] if rows else None


def get_latest_cohort_baseline(client: Client) -> Optional[Dict[str, Any]]:
    response = (
        client.table("correlation_cohort_baselines1")
        .select("*")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return rows[0] if rows else None


def archetype_payload_from_row(row: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not row:
        return dict(EMPTY_ARCHETYPE)

    archetype_json = row.get("archetype_json") or {}
    if isinstance(archetype_json, dict) and archetype_json.get("archetype_title"):
        return archetype_json

    return {
        "profile_version": row.get("profile_version", "correlation_archetype_v1"),
        "archetype_title": row.get("archetype_title", ""),
        "summary": row.get("summary", ""),
        "what_heatmap_shows": row.get("what_heatmap_shows", ""),
        "what_it_reflects": row.get("what_it_reflects", ""),
        "core_insight": row.get("core_insight", ""),
        "strength": row.get("strength", ""),
        "primary_coaching_rule": row.get("primary_coaching_rule", ""),
        "key_correlations": (
            archetype_json.get("key_correlations")
            if isinstance(archetype_json, dict)
            else []
        )
        or [],
    }


def is_correlation_archetype_update_due(
    client: Client,
    user_id: str,
    *,
    as_of: Optional[date] = None,
    force: bool = False,
) -> Dict[str, Any]:
    """
    Same numeric gates as behavior profiles:
      - no active archetype and enough total feature days, OR
      - refresh interval elapsed AND enough NEW feature days since data_window_end
    """
    today = as_of or datetime.now(timezone.utc).date()
    feature_days = count_feature_days(client, user_id)
    latest = get_latest_active_archetype(client, user_id)

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
            "reason": (
                "no_active_archetype"
                if feature_days >= MIN_DAYS_FOR_CLUSTERING
                else "force_no_active_archetype"
            ),
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
        "latest_archetype_id": latest.get("archetype_id"),
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


def has_running_archetype_job(client: Client, user_id: str, *, within_hours: int = 2) -> bool:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=within_hours)
    response = (
        client.table("user_correlation_archetypes1")
        .select("archetype_id, created_at")
        .eq("user_id", user_id)
        .eq("status", "running")
        .gte("created_at", cutoff.isoformat())
        .limit(1)
        .execute()
    )
    return bool(response.data)


def fail_running_archetype_jobs(
    client: Client,
    user_id: str,
    *,
    error_message: str,
) -> None:
    client.table("user_correlation_archetypes1").update(
        {
            "status": "failed",
            "error_json": {"message": error_message},
        }
    ).eq("user_id", user_id).eq("status", "running").execute()


def create_running_archetype_row(
    client: Client,
    user_id: str,
    run_trigger: str,
) -> str:
    try:
        rpc = client.rpc(
            "claim_correlation_archetype_job",
            {"p_user_id": user_id, "p_run_trigger": run_trigger},
        ).execute()
        data = rpc.data
        if isinstance(data, list) and data:
            return data[0]
        if isinstance(data, str):
            return data
    except Exception:
        pass

    response = (
        client.table("user_correlation_archetypes1")
        .insert(
            {
                "user_id": user_id,
                "status": "running",
                "profile_version": "correlation_archetype_v1",
                "run_trigger": run_trigger,
            }
        )
        .execute()
    )
    return response.data[0]["archetype_id"]


def _build_finalize_payload(
    *,
    status: str,
    archetype_payload: Dict[str, Any],
    heatmap: Dict[str, Any],
    trusted_edges: list,
    distinctive_edges: list,
    correlation_metadata: Dict[str, Any],
    quality_evaluation: Optional[Dict[str, Any]],
    days_used: int,
    data_window_start: Optional[str],
    data_window_end: Optional[str],
    error_json: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    return {
        "status": status,
        "profile_version": archetype_payload.get(
            "profile_version", "correlation_archetype_v1"
        ),
        "archetype_title": archetype_payload.get("archetype_title", ""),
        "summary": archetype_payload.get("summary", ""),
        "what_heatmap_shows": archetype_payload.get("what_heatmap_shows", ""),
        "what_it_reflects": archetype_payload.get("what_it_reflects", ""),
        "core_insight": archetype_payload.get("core_insight", ""),
        "strength": archetype_payload.get("strength", ""),
        "primary_coaching_rule": archetype_payload.get("primary_coaching_rule", ""),
        "archetype_json": archetype_payload,
        "heatmap_json": heatmap,
        "trusted_edges_json": trusted_edges,
        "distinctive_edges_json": distinctive_edges,
        "correlation_metadata_json": correlation_metadata,
        "quality_evaluation_json": quality_evaluation or {},
        "days_used": days_used,
        "data_window_start": _normalize_optional_date(data_window_start),
        "data_window_end": _normalize_optional_date(data_window_end),
        "error_json": error_json or {},
    }


def finalize_archetype_row(
    client: Client,
    archetype_id: str,
    user_id: str,
    *,
    status: str,
    archetype_payload: Dict[str, Any],
    heatmap: Dict[str, Any],
    trusted_edges: list,
    distinctive_edges: list,
    correlation_metadata: Dict[str, Any],
    days_used: int,
    data_window_start: Optional[str],
    data_window_end: Optional[str],
    error_json: Optional[Dict[str, Any]] = None,
    quality_evaluation: Optional[Dict[str, Any]] = None,
) -> None:
    update_payload = _build_finalize_payload(
        status=status,
        archetype_payload=archetype_payload,
        heatmap=heatmap,
        trusted_edges=trusted_edges,
        distinctive_edges=distinctive_edges,
        correlation_metadata=correlation_metadata,
        quality_evaluation=quality_evaluation,
        days_used=days_used,
        data_window_start=data_window_start,
        data_window_end=data_window_end,
        error_json=error_json,
    )

    if status == "active":
        try:
            client.rpc(
                "promote_user_correlation_archetype",
                {
                    "p_user_id": user_id,
                    "p_archetype_id": archetype_id,
                    "p_update_payload": update_payload,
                },
            ).execute()
            return
        except Exception as exc:
            raise RuntimeError(
                f"Atomic promote_user_correlation_archetype failed; "
                f"previous active archetype left unchanged: {exc}"
            ) from exc

    client.table("user_correlation_archetypes1").update(update_payload).eq(
        "archetype_id", archetype_id
    ).eq("user_id", user_id).execute()

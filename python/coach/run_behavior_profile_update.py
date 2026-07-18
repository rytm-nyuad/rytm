#!/usr/bin/env python3
"""
Refresh a user's behavioral profile from clustering + LLM interpretation.

Usage:
  python run_behavior_profile_update.py <user_id> [run_trigger]

run_trigger:
  manual | scheduled | morning_run | manual_force | force

manual_force / force bypasses refresh schedule + new-day requirements,
but never bypasses deterministic quality gates.
"""
from __future__ import annotations

import json
import os
import sys

from supabase import create_client

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    def load_dotenv(*args, **kwargs):
        return False

from behavior_clustering import InsufficientDataError, run_user_clustering
from behavior_profile_agent import BehaviorProfileInterpreter, BehaviorProfileValidationError
from llm_config import resolve_behavior_profile_llm_config
from behavior_profile_store import (
    EMPTY_PROFILE,
    create_running_profile_row,
    finalize_profile_row,
    fail_running_profile_jobs,
    has_running_profile_job,
    is_profile_update_due,
)


def main() -> None:
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env.local"))

    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: run_behavior_profile_update.py <user_id> [run_trigger]"}))
        sys.exit(1)

    user_id = sys.argv[1]
    run_trigger = sys.argv[2] if len(sys.argv) > 2 else "manual"
    force_override = str(run_trigger).lower() in {"manual_force", "force"}

    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not all([supabase_url, supabase_key]):
        print(json.dumps({"error": "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"}))
        sys.exit(1)

    try:
        llm_config = resolve_behavior_profile_llm_config()
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)

    client = create_client(supabase_url, supabase_key)

    due_state = is_profile_update_due(client, user_id, force=force_override)
    if not due_state.get("due"):
        print(json.dumps({"status": "skipped", "reason": due_state.get("reason"), "due_state": due_state}))
        sys.exit(0)

    if has_running_profile_job(client, user_id) and not force_override:
        print(json.dumps({"status": "skipped", "reason": "profile_job_already_running"}))
        sys.exit(0)

    if has_running_profile_job(client, user_id) and force_override:
        fail_running_profile_jobs(
            client,
            user_id,
            error_message="manual_force: overriding stuck running profile job",
        )

    try:
        profile_id = create_running_profile_row(client, user_id, run_trigger)
    except Exception as exc:
        print(json.dumps({"error": f"Failed to claim running profile job: {exc}"}))
        sys.exit(1)

    empty_payload = dict(EMPTY_PROFILE)
    clustering = None

    try:
        clustering = run_user_clustering(client, user_id)
        quality = clustering.quality_evaluation or {}

        if not quality.get("passed"):
            finalize_profile_row(
                client,
                profile_id,
                user_id,
                status="rejected",
                profile_payload=empty_payload,
                cluster_stats=clustering.cluster_stats,
                clustering_metadata=clustering.clustering_metadata,
                quality_evaluation=quality,
                days_used=clustering.days_used,
                data_window_start=clustering.data_window_start,
                data_window_end=clustering.data_window_end,
                error_json={
                    "kind": "quality_gate_rejection",
                    "rejection_reasons": quality.get("rejection_reasons") or [],
                    "warnings": quality.get("warnings") or [],
                },
            )
            print(
                json.dumps(
                    {
                        "status": "rejected",
                        "reason": "quality_gate_rejection",
                        "profile_id": profile_id,
                        "days_used": clustering.days_used,
                        "rejection_reasons": quality.get("rejection_reasons") or [],
                        "warnings": quality.get("warnings") or [],
                        "quality_evaluation": quality,
                        "due_state": due_state,
                    }
                )
            )
            sys.exit(0)

        interpreter = BehaviorProfileInterpreter(config=llm_config)
        profile_payload = interpreter.interpret(
            cluster_stats=clustering.cluster_stats,
            clustering_metadata=clustering.clustering_metadata,
            quality_evaluation=quality,
            days_used=clustering.days_used,
            data_window_start=clustering.data_window_start,
            data_window_end=clustering.data_window_end,
        )

        finalize_profile_row(
            client,
            profile_id,
            user_id,
            status="active",
            profile_payload=profile_payload,
            cluster_stats=clustering.cluster_stats,
            clustering_metadata=clustering.clustering_metadata,
            quality_evaluation=quality,
            days_used=clustering.days_used,
            data_window_start=clustering.data_window_start,
            data_window_end=clustering.data_window_end,
        )

        print(
            json.dumps(
                {
                    "status": "success",
                    "profile_id": profile_id,
                    "days_used": clustering.days_used,
                    "profile_version": profile_payload.get("profile_version"),
                    "llm_provider": llm_config.provider,
                    "llm_model": llm_config.model,
                    "quality_passed": True,
                    "warnings": quality.get("warnings") or [],
                    "due_state": due_state,
                }
            )
        )
        sys.exit(0)
    except InsufficientDataError as exc:
        finalize_profile_row(
            client,
            profile_id,
            user_id,
            status="skipped",
            profile_payload=empty_payload,
            cluster_stats={},
            clustering_metadata={},
            quality_evaluation={},
            days_used=int(due_state.get("feature_days") or 0),
            data_window_start="",
            data_window_end="",
            error_json={"kind": "insufficient_data", "message": str(exc)},
        )
        print(json.dumps({"status": "skipped", "reason": str(exc), "due_state": due_state}))
        sys.exit(0)
    except BehaviorProfileValidationError as exc:
        finalize_profile_row(
            client,
            profile_id,
            user_id,
            status="failed",
            profile_payload=empty_payload,
            cluster_stats=(clustering.cluster_stats if clustering else {}),
            clustering_metadata=(clustering.clustering_metadata if clustering else {}),
            quality_evaluation=(clustering.quality_evaluation if clustering else {}),
            days_used=(
                clustering.days_used
                if clustering
                else int(due_state.get("feature_days") or 0)
            ),
            data_window_start=(clustering.data_window_start if clustering else ""),
            data_window_end=(clustering.data_window_end if clustering else ""),
            error_json={"kind": "llm_validation_error", "message": str(exc)},
        )
        print(json.dumps({"error": str(exc), "profile_id": profile_id, "kind": "llm_validation_error"}))
        sys.exit(1)
    except Exception as exc:
        finalize_profile_row(
            client,
            profile_id,
            user_id,
            status="failed",
            profile_payload=empty_payload,
            cluster_stats=(clustering.cluster_stats if clustering else {}),
            clustering_metadata=(clustering.clustering_metadata if clustering else {}),
            quality_evaluation=(clustering.quality_evaluation if clustering else {}),
            days_used=(
                clustering.days_used
                if clustering
                else int(due_state.get("feature_days") or 0)
            ),
            data_window_start=(clustering.data_window_start if clustering else ""),
            data_window_end=(clustering.data_window_end if clustering else ""),
            error_json={"kind": "infrastructure_or_runtime_error", "message": str(exc)},
        )
        print(json.dumps({"error": str(exc), "profile_id": profile_id}))
        sys.exit(1)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Refresh a user's correlation-heatmap behavioral archetype.

Usage:
  python run_correlation_archetype_update.py <user_id> [run_trigger]

run_trigger:
  manual | scheduled | morning_run | morning_submission | manual_force | force

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

from profiling.behavior_clustering import InsufficientDataError
from correlations.behavior_correlation import run_user_correlation
from correlations.correlation_archetype_agent import (
    CorrelationArchetypeInterpreter,
    CorrelationArchetypeValidationError,
)
from correlations.correlation_archetype_store import (
    EMPTY_ARCHETYPE,
    create_running_archetype_row,
    fail_running_archetype_jobs,
    finalize_archetype_row,
    has_running_archetype_job,
    is_correlation_archetype_update_due,
)
from llm.llm_config import resolve_behavior_profile_llm_config


def main() -> None:
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env.local"))

    if len(sys.argv) < 2:
        print(
            json.dumps(
                {
                    "error": "Usage: run_correlation_archetype_update.py <user_id> [run_trigger]"
                }
            )
        )
        sys.exit(1)

    user_id = sys.argv[1]
    run_trigger = sys.argv[2] if len(sys.argv) > 2 else "manual"
    force_override = str(run_trigger).lower() in {"manual_force", "force"}

    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not all([supabase_url, supabase_key]):
        print(
            json.dumps(
                {"error": "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"}
            )
        )
        sys.exit(1)

    try:
        llm_config = resolve_behavior_profile_llm_config()
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)

    client = create_client(supabase_url, supabase_key)

    due_state = is_correlation_archetype_update_due(
        client, user_id, force=force_override
    )
    if not due_state.get("due"):
        print(
            json.dumps(
                {
                    "status": "skipped",
                    "reason": due_state.get("reason"),
                    "due_state": due_state,
                }
            )
        )
        sys.exit(0)

    if has_running_archetype_job(client, user_id) and not force_override:
        print(json.dumps({"status": "skipped", "reason": "archetype_job_already_running"}))
        sys.exit(0)

    if has_running_archetype_job(client, user_id) and force_override:
        fail_running_archetype_jobs(
            client,
            user_id,
            error_message="manual_force: overriding stuck running archetype job",
        )

    try:
        archetype_id = create_running_archetype_row(client, user_id, run_trigger)
    except Exception as exc:
        print(json.dumps({"error": f"Failed to claim running archetype job: {exc}"}))
        sys.exit(1)

    empty_payload = dict(EMPTY_ARCHETYPE)
    correlation = None

    try:
        correlation = run_user_correlation(client, user_id)
        quality = correlation.quality_evaluation or {}

        if not quality.get("passed"):
            finalize_archetype_row(
                client,
                archetype_id,
                user_id,
                status="rejected",
                archetype_payload=empty_payload,
                heatmap=correlation.heatmap,
                trusted_edges=correlation.trusted_edges,
                distinctive_edges=correlation.distinctive_edges,
                correlation_metadata=correlation.correlation_metadata,
                quality_evaluation=quality,
                days_used=correlation.days_used,
                data_window_start=correlation.data_window_start,
                data_window_end=correlation.data_window_end,
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
                        "archetype_id": archetype_id,
                        "days_used": correlation.days_used,
                        "rejection_reasons": quality.get("rejection_reasons") or [],
                        "warnings": quality.get("warnings") or [],
                        "quality_evaluation": quality,
                        "due_state": due_state,
                    }
                )
            )
            sys.exit(0)

        interpreter = CorrelationArchetypeInterpreter(config=llm_config)
        archetype_payload = interpreter.interpret(
            trusted_edges=correlation.trusted_edges,
            distinctive_edges=correlation.distinctive_edges,
            correlation_metadata=correlation.correlation_metadata,
            quality_evaluation=quality,
            days_used=correlation.days_used,
            days_after_junk_filter=correlation.days_after_junk_filter,
            data_window_start=correlation.data_window_start,
            data_window_end=correlation.data_window_end,
        )

        finalize_archetype_row(
            client,
            archetype_id,
            user_id,
            status="active",
            archetype_payload=archetype_payload,
            heatmap=correlation.heatmap,
            trusted_edges=correlation.trusted_edges,
            distinctive_edges=correlation.distinctive_edges,
            correlation_metadata=correlation.correlation_metadata,
            quality_evaluation=quality,
            days_used=correlation.days_used,
            data_window_start=correlation.data_window_start,
            data_window_end=correlation.data_window_end,
        )

        print(
            json.dumps(
                {
                    "status": "success",
                    "archetype_id": archetype_id,
                    "days_used": correlation.days_used,
                    "profile_version": archetype_payload.get("profile_version"),
                    "archetype_title": archetype_payload.get("archetype_title"),
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
        finalize_archetype_row(
            client,
            archetype_id,
            user_id,
            status="skipped",
            archetype_payload=empty_payload,
            heatmap={},
            trusted_edges=[],
            distinctive_edges=[],
            correlation_metadata={},
            quality_evaluation={},
            days_used=int(due_state.get("feature_days") or 0),
            data_window_start="",
            data_window_end="",
            error_json={"kind": "insufficient_data", "message": str(exc)},
        )
        print(json.dumps({"status": "skipped", "reason": str(exc), "due_state": due_state}))
        sys.exit(0)
    except CorrelationArchetypeValidationError as exc:
        finalize_archetype_row(
            client,
            archetype_id,
            user_id,
            status="failed",
            archetype_payload=empty_payload,
            heatmap=(correlation.heatmap if correlation else {}),
            trusted_edges=(correlation.trusted_edges if correlation else []),
            distinctive_edges=(correlation.distinctive_edges if correlation else []),
            correlation_metadata=(
                correlation.correlation_metadata if correlation else {}
            ),
            quality_evaluation=(
                correlation.quality_evaluation if correlation else {}
            ),
            days_used=(
                correlation.days_used
                if correlation
                else int(due_state.get("feature_days") or 0)
            ),
            data_window_start=(correlation.data_window_start if correlation else ""),
            data_window_end=(correlation.data_window_end if correlation else ""),
            error_json={"kind": "llm_validation_error", "message": str(exc)},
        )
        print(
            json.dumps(
                {
                    "error": str(exc),
                    "archetype_id": archetype_id,
                    "kind": "llm_validation_error",
                }
            )
        )
        sys.exit(1)
    except Exception as exc:
        finalize_archetype_row(
            client,
            archetype_id,
            user_id,
            status="failed",
            archetype_payload=empty_payload,
            heatmap=(correlation.heatmap if correlation else {}),
            trusted_edges=(correlation.trusted_edges if correlation else []),
            distinctive_edges=(correlation.distinctive_edges if correlation else []),
            correlation_metadata=(
                correlation.correlation_metadata if correlation else {}
            ),
            quality_evaluation=(
                correlation.quality_evaluation if correlation else {}
            ),
            days_used=(
                correlation.days_used
                if correlation
                else int(due_state.get("feature_days") or 0)
            ),
            data_window_start=(correlation.data_window_start if correlation else ""),
            data_window_end=(correlation.data_window_end if correlation else ""),
            error_json={"kind": "infrastructure_or_runtime_error", "message": str(exc)},
        )
        print(json.dumps({"error": str(exc), "archetype_id": archetype_id}))
        sys.exit(1)


if __name__ == "__main__":
    main()

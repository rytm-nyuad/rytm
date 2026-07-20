#!/usr/bin/env python3
"""
Refresh a user's behavioral profile from OS-only clustering + findings + LLM v2.

Usage:
  python run_behavior_profile_update.py <user_id> [run_trigger]

run_trigger:
  manual | scheduled | morning_run | manual_force | force

manual_force / force bypasses refresh schedule + new-day requirements.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime

from supabase import create_client

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    def load_dotenv(*args, **kwargs):
        return False

from profiling.behavior_clustering import InsufficientDataError, run_user_clustering
from profiling.behavior_profile_agent import BehaviorProfileInterpreter, BehaviorProfileValidationError
from llm.llm_config import resolve_behavior_profile_llm_config
from pipeline.agent_logger import AgentLogger
from profiling.behavior_profile_store import (
    EMPTY_PROFILE,
    create_running_profile_row,
    finalize_profile_row,
    fail_running_profile_jobs,
    has_running_profile_job,
    is_profile_update_due,
)
from profiling.findings import compute_findings
from profiling.gates import build_interpreter_package


def _create_ingestion_run(client, user_id: str, for_date: str) -> str:
    """Create an ingestion_runs1 row so agent_runs1 can reference it."""
    response = (
        client.table("ingestion_runs1")
        .insert(
            {
                "user_id": user_id,
                "for_date": for_date,
                "status": "success",
                "pipeline_version": "behavior-profile-v2",
            }
        )
        .select("ingestion_run_id")
        .single()
        .execute()
    )
    return response.data["ingestion_run_id"]


def _log_interpreter_agent_run(
    client,
    *,
    user_id: str,
    profile_id: str,
    package: dict,
    profile_payload: dict,
    validator_meta: dict,
    llm_config,
    started_at: datetime,
    status: str = "success",
    error_json: dict | None = None,
) -> None:
    """Persist findings package + interpreter output to agent_runs1 (best-effort)."""
    try:
        for_date_raw = (
            package.get("data_window_end")
            or package.get("data_window_start")
            or date.today().isoformat()
        )
        for_date = str(for_date_raw)[:10]
        ingestion_run_id = _create_ingestion_run(client, user_id, for_date)
        logger = AgentLogger(client)
        logger.log_agent_run(
            ingestion_run_id=ingestion_run_id,
            user_id=user_id,
            for_date=date.fromisoformat(for_date),
            agent_name="behavior_profile_interpreter",
            attempt=0,
            status=status,
            input_json={
                "profile_id": profile_id,
                "findings_package": package,
            },
            output_json={
                "profile_payload": profile_payload,
                "validator": validator_meta,
            },
            evidence_refs_json={
                "behavior_profile": {
                    "present": True,
                    "source": "user_behavior_profiles1",
                    "profile_id": profile_id,
                    "days_used": package.get("days_used"),
                    "data_window_start": package.get("data_window_start"),
                    "data_window_end": package.get("data_window_end"),
                    "os_tiers_meaningful": package.get("os_tiers_meaningful"),
                    "validator_source": (validator_meta or {}).get("source"),
                }
            },
            model_info_json={
                "provider": llm_config.provider,
                "model": llm_config.model,
            },
            error_json=error_json or {},
            started_at=started_at,
            ended_at=datetime.utcnow(),
        )
    except Exception as exc:  # noqa: BLE001
        print(
            json.dumps({"warning": "agent_runs1_log_failed", "message": str(exc)}),
            file=sys.stderr,
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
        clustering = run_user_clustering(client, user_id, mode="os_only")
        quality = dict(clustering.quality_evaluation or {})
        warnings = list(quality.get("warnings") or [])

        if clustering.feature_matrix is None or clustering.semantic_labels is None:
            raise RuntimeError("OS-only clustering did not return feature_matrix/labels")

        findings = compute_findings(
            clustering.feature_matrix,
            clustering.semantic_labels,
        )
        package = build_interpreter_package(
            days_used=clustering.days_used,
            data_window_start=clustering.data_window_start,
            data_window_end=clustering.data_window_end,
            feature_matrix=clustering.feature_matrix,
            semantic_labels=clustering.semantic_labels,
            findings=findings,
            quality_warnings=warnings,
            monitoring={
                "silhouette_score": (clustering.clustering_metadata or {}).get(
                    "silhouette_score"
                ),
                "stability_score": (clustering.clustering_metadata or {}).get(
                    "stability_score"
                ),
            },
        )

        metadata = dict(clustering.clustering_metadata or {})
        metadata["os_tiers_meaningful"] = package.get("os_tiers_meaningful")
        metadata["permutation_test"] = package.get("permutation_test")
        metadata["findings_summary"] = {
            "n_candidates_tested": findings.get("n_candidates_tested"),
            "n_candidates_passed_bh": findings.get("n_candidates_passed_bh"),
            "bh_q": findings.get("bh_q"),
            "cluster_statuses": {
                k: (package.get("clusters") or {}).get(k, {}).get("status")
                for k in ("cluster_0", "cluster_1", "cluster_2")
            },
        }

        quality["interpreter_package"] = {
            "os_tiers_meaningful": package.get("os_tiers_meaningful"),
            "tier_summary": package.get("tier_summary"),
            "cluster_statuses": metadata["findings_summary"]["cluster_statuses"],
        }
        quality["passed"] = True

        interpreter = BehaviorProfileInterpreter(config=llm_config)
        started_at = datetime.utcnow()
        profile_payload, validator_meta = (
            interpreter.interpret_findings_package_with_validation(package)
        )
        quality["validator"] = validator_meta
        metadata["validator"] = validator_meta

        finalize_profile_row(
            client,
            profile_id,
            user_id,
            status="active",
            profile_payload=profile_payload,
            cluster_stats={
                **(clustering.cluster_stats or {}),
                "findings": findings,
                "interpreter_package": package,
            },
            clustering_metadata=metadata,
            quality_evaluation=quality,
            days_used=clustering.days_used,
            data_window_start=clustering.data_window_start,
            data_window_end=clustering.data_window_end,
        )

        _log_interpreter_agent_run(
            client,
            user_id=user_id,
            profile_id=profile_id,
            package=package,
            profile_payload=profile_payload,
            validator_meta=validator_meta,
            llm_config=llm_config,
            started_at=started_at,
            status="success",
        )

        print(
            json.dumps(
                {
                    "status": "success",
                    "profile_id": profile_id,
                    "days_used": clustering.days_used,
                    "profile_version": profile_payload.get("profile_version"),
                    "os_tiers_meaningful": package.get("os_tiers_meaningful"),
                    "validator_source": validator_meta.get("source"),
                    "llm_provider": llm_config.provider,
                    "llm_model": llm_config.model,
                    "warnings": warnings,
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

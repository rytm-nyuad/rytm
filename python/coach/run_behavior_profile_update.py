#!/usr/bin/env python3
"""
Refresh a user's behavioral profile from clustering + LLM interpretation.

Usage:
  python run_behavior_profile_update.py <user_id> [run_trigger]
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
from behavior_profile_agent import BehaviorProfileInterpreter
from behavior_profile_store import (
    create_running_profile_row,
    finalize_profile_row,
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

    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    openrouter_key = os.getenv("OPENROUTER_API_KEY")

    if not all([supabase_url, supabase_key, openrouter_key]):
        print(json.dumps({"error": "Missing environment variables"}))
        sys.exit(1)

    client = create_client(supabase_url, supabase_key)

    due_state = is_profile_update_due(client, user_id)
    if not due_state.get("due"):
        print(json.dumps({"status": "skipped", "reason": due_state.get("reason"), "due_state": due_state}))
        sys.exit(0)

    if has_running_profile_job(client, user_id):
        print(json.dumps({"status": "skipped", "reason": "profile_job_already_running"}))
        sys.exit(0)

    profile_id = create_running_profile_row(client, user_id, run_trigger)

    try:
        clustering = run_user_clustering(client, user_id)
        interpreter = BehaviorProfileInterpreter(openrouter_key)
        profile_payload = interpreter.interpret(clustering.cluster_stats)

        finalize_profile_row(
            client,
            profile_id,
            user_id,
            status="active",
            profile_payload=profile_payload,
            cluster_stats=clustering.cluster_stats,
            clustering_metadata=clustering.clustering_metadata,
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
            profile_payload={
                "profile_version": "none",
                "summary": "",
                "cluster_interpretations": {},
                "primary_coaching_rule": "",
            },
            cluster_stats={},
            clustering_metadata={},
            days_used=int(due_state.get("feature_days") or 0),
            data_window_start="",
            data_window_end="",
            error_json={"message": str(exc)},
        )
        print(json.dumps({"status": "skipped", "reason": str(exc)}))
        sys.exit(0)
    except Exception as exc:
        finalize_profile_row(
            client,
            profile_id,
            user_id,
            status="failed",
            profile_payload={
                "profile_version": "none",
                "summary": "",
                "cluster_interpretations": {},
                "primary_coaching_rule": "",
            },
            cluster_stats={},
            clustering_metadata={},
            days_used=int(due_state.get("feature_days") or 0),
            data_window_start="",
            data_window_end="",
            error_json={"message": str(exc)},
        )
        print(json.dumps({"error": str(exc), "profile_id": profile_id}))
        sys.exit(1)


if __name__ == "__main__":
    main()

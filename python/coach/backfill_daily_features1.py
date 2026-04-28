#!/usr/bin/env python3
"""
Backfill daily_features1 using the same feature logic as the coach pipeline.

Defaults are set to the requested window/user:
  USER_ID = ba7806f0-d26f-4b9d-95d7-917d4159b638
  START_DATE = 2026-01-29
  END_DATE = 2026-02-26

By default this runs in dry-run mode (no DB writes).
Use --apply to write to Supabase.
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv

from data_fetcher import DataFetcher
from deterministic_agents import IngestionAgent, FeatureAgent
from langgraph_pipeline import MorningCoachPipeline


DEFAULT_USER_ID = "ba7806f0-d26f-4b9d-95d7-917d4159b638"
DEFAULT_START_DATE = "2026-01-29"
DEFAULT_END_DATE = "2026-02-26"


@dataclass
class BackfillStats:
    days_processed: int = 0
    days_failed: int = 0
    rows_upserted: int = 0


class DryRunFeatureAgent:
    """FeatureAgent-compatible shim for dry-run mode (no DB writes)."""

    def __init__(self):
        from feature_computer import FeatureComputer

        self.computer = FeatureComputer()

    def run(self, user_id: str, for_date: date, validated_snapshot: dict, ingestion_run_id: str):
        return self.computer.compute_all_features(validated_snapshot, for_date)


def run_node_compute_features(feature_agent, state: dict) -> dict:
    """Invoke MorningCoachPipeline.node_compute_features without full pipeline init."""
    pipeline = MorningCoachPipeline.__new__(MorningCoachPipeline)
    pipeline.feature_agent = feature_agent
    return MorningCoachPipeline.node_compute_features(pipeline, state)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill daily_features1 with the same logic used by the coach pipeline."
    )
    parser.add_argument("--user-id", default=DEFAULT_USER_ID)
    parser.add_argument("--start-date", default=DEFAULT_START_DATE)
    parser.add_argument("--end-date", default=DEFAULT_END_DATE)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually write rows to daily_features1. If omitted, script runs dry-run.",
    )
    parser.add_argument(
        "--skip-ingestion-run",
        action="store_true",
        help="Do not create ingestion_runs1 rows; use generated UUIDs for ingestion_run_id.",
    )
    return parser.parse_args()


def daterange(start: date, end: date):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def get_fetcher() -> DataFetcher:
    project_root = Path(__file__).resolve().parents[2]
    load_dotenv(project_root / ".env.local")

    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        raise RuntimeError(
            "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
        )

    return DataFetcher(supabase_url=supabase_url, supabase_key=service_key)


def create_ingestion_run_id(
    fetcher: DataFetcher,
    user_id: str,
    for_date: date,
    skip_ingestion_run: bool,
) -> str:
    last_errors = []

    if skip_ingestion_run:
        return str(uuid4())

    try:
        existing = (
            fetcher.client.table("ingestion_runs1")
            .select("ingestion_run_id")
            .eq("user_id", user_id)
            .eq("for_date", for_date.isoformat())
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if existing.data:
            existing_id = existing.data[0].get("ingestion_run_id")
            if existing_id:
                return existing_id
    except Exception as exc:
        last_errors.append(f"precheck query failed: {exc}")

    try:
        insert_result = fetcher.client.table("ingestion_runs1").insert(
            {
                "user_id": user_id,
                "for_date": for_date.isoformat(),
                "status": "success",
                "pipeline_version": "backfill-v1-feature-only",
            }
        )
        result = insert_result.execute()

        ingestion_run_id = None
        if isinstance(result.data, dict):
            ingestion_run_id = result.data.get("ingestion_run_id")
        elif isinstance(result.data, list) and result.data:
            ingestion_run_id = result.data[0].get("ingestion_run_id")

        if ingestion_run_id:
            return ingestion_run_id
    except Exception as exc:
        last_errors.append(f"insert failed: {exc}")

    try:
        existing = (
            fetcher.client.table("ingestion_runs1")
            .select("ingestion_run_id")
            .eq("user_id", user_id)
            .eq("for_date", for_date.isoformat())
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if existing.data and existing.data[0].get("ingestion_run_id"):
            return existing.data[0]["ingestion_run_id"]
    except Exception as exc:
        last_errors.append(f"postcheck query failed: {exc}")

    raise RuntimeError(
        "Could not create/find ingestion_runs1 row for "
        f"user_id={user_id} date={for_date.isoformat()}"
        + (f" | details: {' ; '.join(last_errors)}" if last_errors else "")
    )


def main() -> None:
    args = parse_args()
    start = date.fromisoformat(args.start_date)
    end = date.fromisoformat(args.end_date)
    if end < start:
        raise ValueError("end-date must be on or after start-date")

    fetcher = get_fetcher()
    ingestion_agent = IngestionAgent(fetcher.client)
    apply_feature_agent = FeatureAgent(fetcher.client)
    dry_run_feature_agent = DryRunFeatureAgent()

    stats = BackfillStats()
    mode = "APPLY" if args.apply else "DRY-RUN"

    print(
        f"[{mode}] user_id={args.user_id} range={args.start_date}..{args.end_date} "
        f"skip_ingestion_run={args.skip_ingestion_run}"
    )

    for day in daterange(start, end):
        try:
            raw_snapshot = fetcher.fetch_all_daily_data(args.user_id, day)
            validation_result = ingestion_agent.run(
                user_id=args.user_id,
                for_date=day,
                raw_snapshot=raw_snapshot,
            )

            ingestion_run_id = create_ingestion_run_id(
                fetcher=fetcher,
                user_id=args.user_id,
                for_date=day,
                skip_ingestion_run=args.skip_ingestion_run,
            )

            normalized_data = validation_result.get("normalized_data", raw_snapshot)
            node_state = {
                "user_id": args.user_id,
                "for_date": day.isoformat(),
                "validation_result": {"normalized_data": normalized_data},
                "ingestion_run_id": ingestion_run_id,
            }

            feature_agent = apply_feature_agent if args.apply else dry_run_feature_agent
            node_state = run_node_compute_features(feature_agent, node_state)
            features = node_state.get("features", {})

            stats.days_processed += 1
            stats.rows_upserted += len(features)
            print(
                f"{day.isoformat()} -> features={len(features)} rows={len(features)} "
                f"ingestion_run_id={ingestion_run_id}"
            )
        except Exception as exc:
            stats.days_failed += 1
            print(f"{day.isoformat()} -> ERROR: {exc}")

    print(
        "\nDone. "
        f"processed_days={stats.days_processed}, failed_days={stats.days_failed}, "
        f"total_rows={stats.rows_upserted}, mode={mode}"
    )


if __name__ == "__main__":
    main()

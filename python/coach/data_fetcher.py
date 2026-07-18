"""
Prepared-context fetch module for the morning coach pipeline.
Loads the deterministic bundle/state artifacts built before the coach runs.
"""
import os
from datetime import timedelta, date
from typing import Dict, Any, Optional

from supabase import create_client, Client


class DataFetcher:
    def __init__(self, supabase_url: str, supabase_key: str):
        self.client: Client = create_client(supabase_url, supabase_key)
        self.ignore_journal_in_coach = os.getenv("IGNORE_JOURNAL_IN_COACH", "").lower() == "true"

    def _strip_journal_from_bundle(self, input_bundle_row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not input_bundle_row:
            return input_bundle_row

        row = dict(input_bundle_row)
        bundle_json = dict(row.get("bundle_json") or {})
        missingness_json = dict(row.get("missingness_json") or {})
        confidence_json = dict(row.get("confidence_json") or {})

        bundle_json["journal"] = {
            "narrative_summary": None,
            "themes": [],
            "topics": [],
            "episodic_events": [],
            "commitments": [],
            "recurring_topics": [],
            "stressor_types": [],
            "coping_actions": [],
            "barriers": [],
            "tone_hint": None,
            "risk_flags": [],
            "self_appraisal_style": None,
            "self_efficacy_language": None,
            "goals_conflict_today": None,
            "evidence_quotes": [],
            "context": {
                "as_of_date": None,
                "narrative_arc": "",
                "open_commitments": [],
                "recurring_topics": [],
                "recent_day_summaries": [],
            },
        }
        missingness_json["missing_journal"] = True
        confidence_json["confidence_journal"] = 0

        row["bundle_json"] = bundle_json
        row["missingness_json"] = missingness_json
        row["confidence_json"] = confidence_json
        return row

    def _strip_journal_from_state_json(self, state_json: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        cleaned = dict(state_json or {})
        cleaned["episodic_memory"] = {
            "active_events": [],
            "recent_stressor_distribution": [],
            "open_commitments": [],
            "recurring_topics": [],
            "narrative_arc": "",
            "narrative_summary": None,
        }
        return cleaned

    def _strip_journal_from_state_history_row(self, row: Dict[str, Any]) -> Dict[str, Any]:
        cleaned = dict(row)
        snapshot = dict(cleaned.get("state_snapshot_json") or {})
        snapshot["episodic_memory"] = {
            "active_events": [],
            "recent_stressor_distribution": [],
            "open_commitments": [],
            "recurring_topics": [],
            "narrative_arc": "",
            "narrative_summary": None,
        }
        cleaned["state_snapshot_json"] = snapshot
        return cleaned

    def fetch_prepared_context(self, user_id: str, target_date: date) -> Dict[str, Any]:
        """Fetch bundle/state/history artifacts for the given morning-summary date."""
        target_iso = target_date.isoformat()
        history_start = (target_date - timedelta(days=14)).isoformat()

        bundle_result = (
            self.client.table("daily_input_bundle_v12")
            .select("user_id, date, bundle_version, timezone, generated_at, overall_true_today, physio_proxy_score_0_100, gap_today, missingness_json, confidence_json, bundle_json")
            .eq("user_id", user_id)
            .eq("date", target_iso)
            .limit(1)
            .execute()
        )

        state_result = (
            self.client.table("user_state_current2")
            .select("user_id, state_version, as_of_date, updated_at, state_json")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )

        target_state_history_result = (
            self.client.table("user_state_history2")
            .select("date, state_version, state_snapshot_json, actions_generated_json")
            .eq("user_id", user_id)
            .eq("date", target_iso)
            .limit(1)
            .execute()
        )

        state_history_result = (
            self.client.table("user_state_history2")
            .select("date, overall_true_today, physio_proxy_score_0_100, gap_today, deviations_json, state_snapshot_json, actions_generated_json")
            .eq("user_id", user_id)
            .gte("date", history_start)
            .lt("date", target_iso)
            .order("date", desc=True)
            .execute()
        )

        input_bundle = bundle_result.data[0] if bundle_result.data else None
        current_state = state_result.data[0] if state_result.data else None
        target_state_history = target_state_history_result.data[0] if target_state_history_result.data else None

        if current_state and current_state.get("as_of_date") != target_iso and target_state_history:
            current_state = {
                "user_id": user_id,
                "state_version": target_state_history.get("state_version", "v1"),
                "as_of_date": target_iso,
                "updated_at": None,
                "state_json": target_state_history.get("state_snapshot_json") or {},
            }

        recent_state_history = state_history_result.data or []

        if self.ignore_journal_in_coach:
            input_bundle = self._strip_journal_from_bundle(input_bundle)
            if current_state:
                current_state = dict(current_state)
                current_state["state_json"] = self._strip_journal_from_state_json(current_state.get("state_json"))
            recent_state_history = [
                self._strip_journal_from_state_history_row(row)
                for row in recent_state_history
            ]

        return {
            "input_bundle": input_bundle,
            "current_state": current_state,
            "recent_state_history": recent_state_history,
        }

    def fetch_user_profile(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Fetch user profile (name, timezone)."""
        result = (
            self.client.table("profiles")
            .select("user_id, first_name, last_name, timezone")
            .eq("user_id", user_id)
            .execute()
        )
        return result.data[0] if result.data else None

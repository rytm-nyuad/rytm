"""
LangGraph Pipeline - Orchestrates morning coach workflow
Combines Python deterministic agents + LLM reasoning agents
"""
import os
import sys
import re
from datetime import datetime, date
from typing import Dict, List, Any, TypedDict, Annotated, Optional
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
import json

from data_fetcher import DataFetcher
from behavior_profile_store import get_latest_active_profile, profile_payload_from_row
from deterministic_agents import (
    BudgetEnforcerAgent,
    PersistenceAgent,
    RegenerationController
)
from action_utils import add_action_ids_to_candidates
from agent_logger import AgentLogger
from llm_config import LlmClientConfig, resolve_coach_pipeline_llm_config

# Helper for debug logging to stderr
def debug_log(msg: str):
    print(msg, file=sys.stderr)


# State definition
class PipelineState(TypedDict):
    # Input
    user_id: str
    for_date: str
    overall_score: int
    ingestion_run_id: str
    
    # Prepared coach context
    input_bundle: Dict[str, Any]
    current_state: Dict[str, Any]
    recent_state_history: List[Dict[str, Any]]
    coach_readiness: Dict[str, Any]
    behavior_profile: Dict[str, Any]

    # User context
    user_name: str
    recent_action_history: List[Dict]

    # User goal
    user_goal: Dict[str, Any]
    
    # Holistic status report (objective, pre-goal)
    holistic_status_report: Dict[str, Any]
    
    # Agent outputs
    day_constraints: Dict[str, Any]
    selected_domains: List[str]
    action_proposals: List[Dict]
    review_result: Dict[str, Any]
    budget_result: Dict[str, Any]
    morning_message: str
    
    # Control
    attempt: int
    plan_id: str
    error: str


class MorningCoachPipeline:
    """LangGraph-based morning coach pipeline"""
    
    def __init__(
        self,
        supabase_client,
        openrouter_api_key: Optional[str] = None,
        *,
        llm_config: Optional[LlmClientConfig] = None,
    ):
        self.client = supabase_client
        self.data_fetcher = DataFetcher(
            os.getenv('NEXT_PUBLIC_SUPABASE_URL'),
            os.getenv('SUPABASE_SERVICE_ROLE_KEY')
        )
        self.budget_enforcer = BudgetEnforcerAgent()
        self.persistence_agent = PersistenceAgent(supabase_client)
        self.regen_controller = RegenerationController()
        self.logger = AgentLogger(supabase_client)

        # LLM client: OpenRouter or OpenAI via COACH_LLM_PROVIDER
        if llm_config is not None:
            self.llm_config = llm_config
        elif openrouter_api_key:
            # Backward-compatible path used by older callers.
            self.llm_config = LlmClientConfig(
                provider="openrouter",
                api_key=openrouter_api_key,
                api_base="https://openrouter.ai/api/v1",
                model=os.getenv("COACH_LLM_MODEL") or "gpt-5.4-mini",
                env_key_name="OPENROUTER_API_KEY",
            )
        else:
            self.llm_config = resolve_coach_pipeline_llm_config()

        self.model_name = self.llm_config.model
        self.llm = self._build_chat_model(temperature=0.7)
        
        # Build graph
        self.graph = self._build_graph()

    def _build_chat_model(self, temperature: float) -> ChatOpenAI:
        """Create a ChatOpenAI client pointed at the configured provider."""
        kwargs = {
            "model": self.llm_config.model,
            "api_key": self.llm_config.api_key,
            "base_url": self.llm_config.api_base,
            "temperature": temperature,
        }
        headers = self.llm_config.langchain_default_headers()
        if headers:
            kwargs["default_headers"] = headers
        return ChatOpenAI(**kwargs)
    
    def _build_graph(self) -> StateGraph:
        """Build the LangGraph workflow"""
        workflow = StateGraph(PipelineState)
        
        # Add nodes (agents)
        workflow.add_node("fetch_data", self.node_fetch_data)
        workflow.add_node("fetch_goal", self.node_fetch_goal)
        workflow.add_node("generate_holistic_status_report", self.node_holistic_status_report)
        workflow.add_node("build_constraints", self.node_build_constraints)
        workflow.add_node("route_domains", self.node_route_domains)
        workflow.add_node("generate_actions", self.node_generate_actions)
        workflow.add_node("review_actions", self.node_review_actions)
        workflow.add_node("enforce_budget", self.node_enforce_budget)
        workflow.add_node("compose_brief", self.node_compose_brief)
        workflow.add_node("persist_plan", self.node_persist_plan)
        
        # Define edges (flow)
        # Holistic runs before goal fetch: status report is intentionally goal-agnostic.
        workflow.set_entry_point("fetch_data")
        workflow.add_edge("fetch_data", "generate_holistic_status_report")
        workflow.add_edge("generate_holistic_status_report", "fetch_goal")
        workflow.add_edge("fetch_goal", "build_constraints")
        workflow.add_edge("build_constraints", "route_domains")
        workflow.add_edge("route_domains", "generate_actions")
        workflow.add_edge("generate_actions", "review_actions")
        
        # Conditional: regen or continue
        workflow.add_conditional_edges(
            "review_actions",
            self._should_regenerate,
            {
                "regenerate": "generate_actions",
                "continue": "enforce_budget"
            }
        )
        
        workflow.add_edge("enforce_budget", "compose_brief")
        workflow.add_edge("compose_brief", "persist_plan")
        workflow.add_edge("persist_plan", END)
        
        return workflow.compile()
    
    # === Python Deterministic Agents ===

    def _strip_goal_fields_from_missingness(self, missingness: Dict[str, Any]) -> Dict[str, Any]:
        cleaned = dict(missingness or {})
        cleaned.pop("missing_goals", None)
        return cleaned

    def _strip_goal_fields_from_confidence(self, confidence: Dict[str, Any]) -> Dict[str, Any]:
        cleaned = dict(confidence or {})
        cleaned.pop("confidence_goals", None)
        return cleaned

    @staticmethod
    def _pick(d: Optional[Dict[str, Any]], keys: List[str]) -> Dict[str, Any]:
        src = d or {}
        return {k: src[k] for k in keys if k in src and src[k] is not None}

    @staticmethod
    def _omit_empty(d: Dict[str, Any]) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        for k, v in d.items():
            if v is None:
                continue
            if v == [] or v == {}:
                continue
            out[k] = v
        return out

    def _slim_watch(self, watch: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        watch = watch or {}
        overnight = dict(watch.get("overnight") or {})
        overnight.pop("blood_oxygen_avg", None)
        return self._omit_empty({
            "hrv": self._pick(watch.get("hrv"), ["hrv_deep_rmssd", "hrv_daily_rmssd"]),
            "sleep": self._pick(
                watch.get("sleep"),
                [
                    "sleep_duration_hours",
                    "sleep_efficiency",
                    "wake_ratio_pct",
                    "wake_time_minutes",
                    "sleep_onset_time_minutes",
                    "sleep_fragmentation_index",
                ],
            ),
            "activity": self._pick(
                watch.get("activity"),
                [
                    "steps",
                    "mvpa_minutes",
                    "sedentary_minutes",
                    "total_active_minutes",
                    "distance_total_km",
                    "resting_heart_rate",
                    "energy_burned_calories_out",
                ],
            ),
            "overnight": self._omit_empty(overnight),
        })

    def _remap_commitment_timeframe_for_coach_day(self, timeframe: Optional[str]) -> str:
        """Map journal-day commitment timeframes onto this morning's coach day.

        Journal covers YESTERDAY (source local date). A journal `today` commitment
        already happened on that journal day, so it is `yesterday` for morning coaching.
        """
        mapping = {
            "past": "past",
            "today": "yesterday",
            "upcoming": "upcoming",
            "ongoing": "ongoing",
        }
        key = (timeframe or "").strip().lower()
        return mapping.get(key, "upcoming")

    def _slim_commitment_for_coach(self, commitment: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(commitment, dict):
            return None
        description = commitment.get("description")
        if not description:
            return None
        status = commitment.get("status")
        if status in ("done", "cancelled", "missed"):
            return None
        return self._omit_empty({
            "description": description,
            "timeframe": self._remap_commitment_timeframe_for_coach_day(
                commitment.get("timeframe")
            ),
            "when_text": commitment.get("when_text"),
            "status": status,
            "confidence": commitment.get("confidence"),
        })

    def _slim_commitments_for_coach(
        self,
        commitments: Any,
        *,
        open_only: bool = False,
    ) -> List[Dict[str, Any]]:
        """Normalize commitments for morning coach timing.

        - Remap journal `today` -> `yesterday`
        - `open_only`: keep schedule-relevant items (`upcoming` / `ongoing`) only
        """
        if not isinstance(commitments, list):
            return []
        slim_rows: List[Dict[str, Any]] = []
        for item in commitments:
            slim = self._slim_commitment_for_coach(item)
            if not slim:
                continue
            if open_only and slim.get("timeframe") not in ("upcoming", "ongoing"):
                continue
            slim_rows.append(slim)
        return slim_rows

    def _slim_journal(self, journal: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        journal = journal or {}
        context = journal.get("context") if isinstance(journal.get("context"), dict) else {}
        raw_commitments = journal.get("commitments")
        raw_open = context.get("open_commitments") or journal.get("open_commitments")
        remapped_commitments = self._slim_commitments_for_coach(raw_commitments, open_only=False)
        open_commitments = self._slim_commitments_for_coach(raw_open, open_only=True)
        slim = {
            "themes": journal.get("themes"),
            "topics": journal.get("topics"),
            "narrative_summary": journal.get("narrative_summary"),
            "tone_hint": journal.get("tone_hint"),
            "coping_actions": journal.get("coping_actions"),
            "stressor_types": journal.get("stressor_types"),
            "barriers": journal.get("barriers"),
            "risk_flags": journal.get("risk_flags"),
            # All remapped commitments (incl. yesterday) for lived context.
            "commitments": remapped_commitments,
            # Schedule blockers for THIS morning only: upcoming + ongoing.
            "open_commitments": open_commitments,
            "recurring_topics": context.get("recurring_topics") or journal.get("recurring_topics"),
            "commitment_timing_note": (
                "Journal is from yesterday. Commitment timeframes are remapped to this morning: "
                "journal-day 'today' -> 'yesterday'; only 'upcoming'/'ongoing' are open schedule constraints."
                if remapped_commitments or open_commitments
                else None
            ),
        }
        return self._omit_empty(slim)

    def _slim_nutrition(self, nutrition: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        nutrition = nutrition or {}
        meal_context = dict(nutrition.get("meal_context") or {})
        meals = meal_context.get("meal_descriptions")
        if isinstance(meals, list):
            meal_context["meal_descriptions"] = [
                self._pick(
                    m if isinstance(m, dict) else {},
                    ["meal_type", "description", "logged_at_local", "estimated_caffeine_mg"],
                )
                for m in meals
                if isinstance(m, dict)
            ]
        daily = dict(nutrition.get("daily_nutrition") or {})
        for flag in ("breakfast_logged", "lunch_logged", "dinner_logged"):
            daily.pop(flag, None)
        return self._omit_empty({
            "meal_context": self._omit_empty(meal_context),
            "daily_nutrition": self._omit_empty(daily),
        })

    def _slim_input_bundle(self, bundle: Dict[str, Any]) -> Dict[str, Any]:
        meta = self._pick(
            bundle.get("meta") if isinstance(bundle.get("meta"), dict) else {},
            ["date", "timezone", "source_local_date"],
        )
        checkin = bundle.get("checkin") if isinstance(bundle.get("checkin"), dict) else {}
        slim_checkin = self._omit_empty({"raw": checkin.get("raw")})

        slim = {
            "meta": meta,
            "watch": self._slim_watch(
                bundle.get("watch") if isinstance(bundle.get("watch"), dict) else {}
            ),
            "checkin": slim_checkin,
            "journal": self._slim_journal(
                bundle.get("journal") if isinstance(bundle.get("journal"), dict) else {}
            ),
            "nutrition": self._slim_nutrition(
                bundle.get("nutrition") if isinstance(bundle.get("nutrition"), dict) else {}
            ),
            "confidence": self._strip_goal_fields_from_confidence(
                bundle.get("confidence") if isinstance(bundle.get("confidence"), dict) else {}
            ),
            "missingness": self._strip_goal_fields_from_missingness(
                bundle.get("missingness") if isinstance(bundle.get("missingness"), dict) else {}
            ),
        }
        return self._omit_empty(slim)

    def _slim_baselines(self, baselines: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """Collapse EWMA payloads to last/baseline/z for normal-vs-unusual framing."""
        out: Dict[str, Any] = {}
        for key, payload in (baselines or {}).items():
            if not isinstance(payload, dict):
                continue
            fast = payload.get("fast") if isinstance(payload.get("fast"), dict) else {}
            last_value = fast.get("last_value")
            center = fast.get("center_ewma")
            scale = fast.get("scale_robust")
            n_valid = fast.get("n_valid")
            if last_value is None and center is None:
                continue
            z_fast = None
            if last_value is not None and center is not None and scale not in (None, 0):
                try:
                    z_fast = round((float(last_value) - float(center)) / float(scale), 3)
                except (TypeError, ValueError, ZeroDivisionError):
                    z_fast = None
            out[key] = self._omit_empty({
                "last": last_value,
                "baseline": center,
                "z_fast": z_fast,
                "n_valid": n_valid,
            })
        return out

    def _slim_slopes(self, slopes: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        for key, payload in (slopes or {}).items():
            if not isinstance(payload, dict):
                continue
            slope_fast = payload.get("slope_fast")
            if slope_fast is None:
                continue
            out[key] = {"slope_fast": slope_fast}
        return out

    def _slim_residual(self, residual: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        residual = residual or {}
        gap = residual.get("gap") if isinstance(residual.get("gap"), dict) else {}
        run_length = gap.get("run_length") if isinstance(gap.get("run_length"), dict) else {}
        return self._omit_empty({
            "gap_run_length": self._omit_empty(run_length) if run_length else None,
        })

    def _slim_episodic_memory(self, episodic: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        episodic = episodic or {}
        if not isinstance(episodic, dict):
            return {}
        return self._omit_empty({
            "active_events": episodic.get("active_events"),
            "narrative_summary": episodic.get("narrative_summary"),
            "open_commitments": self._slim_commitments_for_coach(
                episodic.get("open_commitments"),
                open_only=True,
            ),
            "recurring_topics": episodic.get("recurring_topics"),
            "recent_stressor_distribution": episodic.get("recent_stressor_distribution"),
        })

    def _slim_current_state(self, current_state: Dict[str, Any]) -> Dict[str, Any]:
        volatility = current_state.get("volatility") if isinstance(current_state.get("volatility"), dict) else {}
        global_vol = volatility.get("global") if isinstance(volatility.get("global"), dict) else {}
        return self._omit_empty({
            "as_of_date": current_state.get("as_of_date"),
            "baselines": self._slim_baselines(current_state.get("baselines")),
            "slopes": self._slim_slopes(current_state.get("slopes")),
            "volatility": {"global": global_vol} if global_vol else None,
            "uncertainty": current_state.get("uncertainty"),
            "episodic_memory": self._slim_episodic_memory(current_state.get("episodic_memory")),
            "residual_signature": self._slim_residual(current_state.get("residual_signature")),
        })

    def _slim_recent_history(self, history: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        slim_rows: List[Dict[str, Any]] = []
        for row in history[:7]:
            if not isinstance(row, dict):
                continue
            deviations = row.get("deviations_json") if isinstance(row.get("deviations_json"), dict) else {}
            top_trends = deviations.get("top_trends") or []
            top_anomalies = deviations.get("top_anomalies") or []
            slim_dev = None
            if top_trends or top_anomalies:
                slim_dev = self._omit_empty({
                    "top_trends": top_trends or None,
                    "top_anomalies": top_anomalies or None,
                })
            slim_rows.append(self._omit_empty({
                "date": row.get("date"),
                "overall_true_today": row.get("overall_true_today"),
                "gap_today": row.get("gap_today"),
                "physio_proxy_score_0_100": row.get("physio_proxy_score_0_100"),
                "deviations_json": slim_dev,
            }))
        return slim_rows

    def _slim_behavior_profile(
        self,
        profile: Optional[Dict[str, Any]],
        *,
        include_clusters: bool = True,
    ) -> Dict[str, Any]:
        profile = profile or {}
        slim = {
            "summary": profile.get("summary") or None,
            "primary_coaching_rule": profile.get("primary_coaching_rule") or None,
        }
        if include_clusters:
            slim["cluster_interpretations"] = profile.get("cluster_interpretations") or None
        return self._omit_empty(slim)

    def _slim_user_goal(
        self,
        goal: Optional[Dict[str, Any]],
        *,
        mode: str = "full",
    ) -> Dict[str, Any]:
        """Slim goal by consumer.

        mode:
          - full: action-generator style (prefs/budgets/indicators)
          - constraints: statement + domains + constraint defaults
          - router: statement + domains only
        """
        if not goal or not isinstance(goal, dict):
            return {}
        spec = goal.get("goal_spec_json") if isinstance(goal.get("goal_spec_json"), dict) else {}
        constraints_defaults = (
            spec.get("constraints_defaults")
            if isinstance(spec.get("constraints_defaults"), dict)
            else {}
        )

        if mode == "router":
            slim_spec = self._omit_empty({
                "goal_statement": spec.get("goal_statement"),
                "primary_domains": spec.get("primary_domains"),
                "secondary_domains": spec.get("secondary_domains"),
            })
        elif mode == "constraints":
            slim_spec = self._omit_empty({
                "goal_statement": spec.get("goal_statement"),
                "primary_domains": spec.get("primary_domains"),
                "secondary_domains": spec.get("secondary_domains"),
                "constraints_defaults": self._omit_empty(dict(constraints_defaults)),
            })
        else:
            prefs = spec.get("preferences") if isinstance(spec.get("preferences"), dict) else {}
            budgets = spec.get("budgets") if isinstance(spec.get("budgets"), dict) else {}
            slim_spec = self._omit_empty({
                "goal_statement": spec.get("goal_statement"),
                "primary_domains": spec.get("primary_domains"),
                "secondary_domains": spec.get("secondary_domains"),
                "preferences": self._omit_empty(dict(prefs)),
                "constraints_defaults": self._omit_empty(dict(constraints_defaults)),
                "budgets": self._pick(
                    budgets,
                    ["max_actions_per_day", "max_domains_per_day", "target_actions_per_day"],
                ),
                "target_outcomes": spec.get("target_outcomes"),
                "leading_indicators": spec.get("leading_indicators"),
            })

        return self._omit_empty({
            "title": goal.get("title"),
            "status": goal.get("status"),
            "priority": goal.get("priority"),
            "goal_type": goal.get("goal_type"),
            "goal_spec": slim_spec,
        })

    def _top_baseline_deviations(
        self,
        baselines: Optional[Dict[str, Any]],
        *,
        limit: int = 5,
        min_abs_z: float = 1.0,
    ) -> List[Dict[str, Any]]:
        """Top-|z| baseline deviations for constraint risk framing."""
        digests = self._slim_baselines(baselines)
        ranked: List[Dict[str, Any]] = []
        for key, payload in digests.items():
            z = payload.get("z_fast")
            if z is None:
                continue
            try:
                abs_z = abs(float(z))
            except (TypeError, ValueError):
                continue
            if abs_z < min_abs_z:
                continue
            ranked.append({
                "feature": key,
                "last": payload.get("last"),
                "baseline": payload.get("baseline"),
                "z_fast": z,
            })
        ranked.sort(key=lambda row: abs(float(row["z_fast"])), reverse=True)
        return ranked[:limit]

    def _constraint_slopes(self, slopes: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """Keep only constraint-relevant slopes."""
        keep = {
            "sleep_duration_hours",
            "sleep_efficiency",
            "energy_score",
            "stress_score",
            "focus_score",
            "hrv_daily_rmssd",
        }
        slim = self._slim_slopes(slopes)
        return {k: v for k, v in slim.items() if k in keep}

    def _build_constraint_signal_pack(self, bundle: Dict[str, Any]) -> Dict[str, Any]:
        """Compact signals for constraints builder (no full bundle)."""
        watch = bundle.get("watch") if isinstance(bundle.get("watch"), dict) else {}
        sleep = watch.get("sleep") if isinstance(watch.get("sleep"), dict) else {}
        hrv = watch.get("hrv") if isinstance(watch.get("hrv"), dict) else {}
        activity = watch.get("activity") if isinstance(watch.get("activity"), dict) else {}
        overnight = watch.get("overnight") if isinstance(watch.get("overnight"), dict) else {}

        checkin = bundle.get("checkin") if isinstance(bundle.get("checkin"), dict) else {}
        raw = checkin.get("raw") if isinstance(checkin.get("raw"), dict) else {}

        nutrition = bundle.get("nutrition") if isinstance(bundle.get("nutrition"), dict) else {}
        daily = nutrition.get("daily_nutrition") if isinstance(nutrition.get("daily_nutrition"), dict) else {}
        meal_context = nutrition.get("meal_context") if isinstance(nutrition.get("meal_context"), dict) else {}

        journal = bundle.get("journal") if isinstance(bundle.get("journal"), dict) else {}
        slim_journal = self._slim_journal(journal)

        return self._omit_empty({
            "meta": self._pick(
                bundle.get("meta") if isinstance(bundle.get("meta"), dict) else {},
                ["date", "source_local_date", "timezone"],
            ),
            "sleep": self._pick(
                sleep,
                ["sleep_duration_hours", "sleep_efficiency", "wake_ratio_pct"],
            ),
            "recovery": self._omit_empty({
                **self._pick(hrv, ["hrv_daily_rmssd", "hrv_deep_rmssd"]),
                **self._pick(activity, ["resting_heart_rate"]),
                **self._pick(overnight, ["spo2_avg", "skin_temp_relative"]),
            }),
            "activity": self._pick(
                activity,
                ["steps", "mvpa_minutes", "sedentary_minutes", "total_active_minutes"],
            ),
            "checkin": self._pick(
                raw,
                [
                    "emotions",
                    "mood_score",
                    "energy_score",
                    "focus_score",
                    "stress_score",
                    "social_score",
                    "workload_score",
                    "coping_capacity_score",
                    "sleep_quality",
                ],
            ),
            "nutrition": self._omit_empty({
                **self._pick(
                    daily,
                    [
                        "protein_g_day",
                        "total_kcal_day",
                        "meal_count_day",
                        "time_first_meal_minutes",
                        "time_last_meal_minutes",
                        "eating_window_minutes",
                        "nutrition_confidence_day",
                    ],
                ),
                "caffeine_after_2pm": meal_context.get("caffeine_after_2pm"),
                "estimated_caffeine_mg_day": meal_context.get("estimated_caffeine_mg_day"),
            }),
            "journal": self._omit_empty({
                "narrative_summary": slim_journal.get("narrative_summary"),
                "open_commitments": slim_journal.get("open_commitments"),
                "commitments": slim_journal.get("commitments"),
                "barriers": slim_journal.get("barriers"),
                "risk_flags": slim_journal.get("risk_flags"),
                "coping_actions": slim_journal.get("coping_actions"),
                "stressor_types": slim_journal.get("stressor_types"),
                "commitment_timing_note": slim_journal.get("commitment_timing_note"),
            }),
            "confidence": self._strip_goal_fields_from_confidence(
                bundle.get("confidence") if isinstance(bundle.get("confidence"), dict) else {}
            ),
            "missingness": self._strip_goal_fields_from_missingness(
                bundle.get("missingness") if isinstance(bundle.get("missingness"), dict) else {}
            ),
        })

    def _build_constraints_state_digest(self, current_state: Dict[str, Any]) -> Dict[str, Any]:
        """State digest for constraints: top deviations + key slopes + volatility/residual/episodic."""
        volatility = current_state.get("volatility") if isinstance(current_state.get("volatility"), dict) else {}
        global_vol = volatility.get("global") if isinstance(volatility.get("global"), dict) else {}
        return self._omit_empty({
            "as_of_date": current_state.get("as_of_date"),
            "top_deviations": self._top_baseline_deviations(current_state.get("baselines")),
            "slopes": self._constraint_slopes(current_state.get("slopes")),
            "volatility": {"global": global_vol} if global_vol else None,
            "uncertainty": current_state.get("uncertainty"),
            "episodic_memory": self._slim_episodic_memory(current_state.get("episodic_memory")),
            "residual_signature": self._slim_residual(current_state.get("residual_signature")),
        })

    def _build_holistic_agent_inputs(self, state: PipelineState) -> Dict[str, Any]:
        """Slim status-only inputs for holistic reporter (goals intentionally excluded)."""
        readiness_src = state.get("coach_readiness") or {}
        return {
            "overall_score": state["overall_score"],
            "input_bundle": self._slim_input_bundle(state.get("input_bundle") or {}),
            "current_state": self._slim_current_state(state.get("current_state") or {}),
            "recent_state_history": self._slim_recent_history(
                state.get("recent_state_history") or []
            ),
            "coach_readiness": {
                "fast_ready": bool(readiness_src.get("fast_ready")),
                "slow_ready": bool(readiness_src.get("slow_ready")),
            },
            "behavior_profile": self._slim_behavior_profile(
                state.get("behavior_profile") or {}
            ),
        }

    def _build_constraints_agent_inputs(self, state: PipelineState) -> Dict[str, Any]:
        """Compact inputs for constraints builder."""
        bundle = state.get("input_bundle") or {}
        return {
            "overall_score": state["overall_score"],
            "energy_mode": self._get_energy_mode(state["overall_score"]),
            "user_goal": self._slim_user_goal(state.get("user_goal"), mode="constraints"),
            "signal_pack": self._build_constraint_signal_pack(bundle),
            "state_digest": self._build_constraints_state_digest(
                state.get("current_state") or {}
            ),
            "behavior_profile": self._slim_behavior_profile(
                state.get("behavior_profile") or {},
                include_clusters=False,
            ),
        }

    def _slim_holistic_for_router(self, report: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """Holistic report trimmed for domain routing (1 evidence note per domain)."""
        slim = self._slim_holistic_status_report(report)
        summaries = slim.get("domain_summaries")
        if isinstance(summaries, list):
            trimmed = []
            for item in summaries:
                if not isinstance(item, dict):
                    continue
                evidence = item.get("key_evidence")
                if isinstance(evidence, list) and evidence:
                    evidence = evidence[:1]
                trimmed.append(self._omit_empty({
                    "domain": item.get("domain"),
                    "status": item.get("status"),
                    "significant_deviation": item.get("significant_deviation"),
                    "observation": item.get("observation"),
                    "key_evidence": evidence or None,
                }))
            slim["domain_summaries"] = trimmed
        return self._omit_empty(slim)

    def _slim_coach_readiness_with_coverage(self, readiness: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """Baseline flags + signal coverage (for agents that do not receive the bundle)."""
        readiness = readiness or {}
        return self._omit_empty({
            "fast_ready": bool(readiness.get("fast_ready")),
            "slow_ready": bool(readiness.get("slow_ready")),
            "bundle_confidence": self._strip_goal_fields_from_confidence(
                readiness.get("bundle_confidence")
                if isinstance(readiness.get("bundle_confidence"), dict)
                else {}
            ),
            "bundle_missingness": self._strip_goal_fields_from_missingness(
                readiness.get("bundle_missingness")
                if isinstance(readiness.get("bundle_missingness"), dict)
                else {}
            ),
        })

    def _slim_day_constraints(self, constraints: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        slim = dict(constraints or {})
        evidence = slim.get("evidence_used")
        if isinstance(evidence, dict):
            cleaned = dict(evidence)
            cleaned.pop("missing_goals", None)
            cleaned.pop("confidence_goals", None)
            slim["evidence_used"] = cleaned
        return self._omit_empty(slim)

    def _slim_recent_deviations(self, history: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        slim_rows: List[Dict[str, Any]] = []
        for row in (history or [])[:5]:
            if not isinstance(row, dict):
                continue
            deviations = row.get("deviations_json") if isinstance(row.get("deviations_json"), dict) else {}
            top_trends = deviations.get("top_trends") or []
            top_anomalies = deviations.get("top_anomalies") or []
            if not top_trends and not top_anomalies:
                continue
            slim_rows.append({
                "date": row.get("date"),
                "deviations": self._omit_empty({
                    "top_trends": top_trends or None,
                    "top_anomalies": top_anomalies or None,
                }),
            })
        return slim_rows

    def _slim_holistic_status_report(self, report: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """Pass through the report, dropping empty fields and goal-related data_gaps."""
        if not report or not isinstance(report, dict):
            return {}
        slim = dict(report)
        gaps = slim.get("data_gaps")
        if isinstance(gaps, list):
            cleaned = [
                g for g in gaps
                if isinstance(g, str) and "goal" not in g.lower()
            ]
            if cleaned:
                slim["data_gaps"] = cleaned
            else:
                slim.pop("data_gaps", None)
        return self._omit_empty(slim)

    def _build_domain_router_agent_inputs(self, state: PipelineState) -> Dict[str, Any]:
        """Compact inputs for domain router: holistic + constraints + goal domains + profile."""
        user_goal = self._slim_user_goal(state.get("user_goal"), mode="router")
        goal_spec = user_goal.get("goal_spec") if isinstance(user_goal.get("goal_spec"), dict) else {}
        recent_deviations = self._slim_recent_deviations(state.get("recent_state_history") or [])
        payload = {
            "energy_mode": self._get_energy_mode(state["overall_score"]),
            "user_goal": user_goal,
            "primary_domains": goal_spec.get("primary_domains") or [],
            "secondary_domains": goal_spec.get("secondary_domains") or [],
            "day_constraints": self._slim_day_constraints(state.get("day_constraints")),
            "holistic_status_report": self._slim_holistic_for_router(
                state.get("holistic_status_report")
            ),
            "coach_readiness": self._slim_coach_readiness_with_coverage(
                state.get("coach_readiness")
            ),
            "behavior_profile": self._slim_behavior_profile(
                state.get("behavior_profile") or {},
                include_clusters=True,
            ),
        }
        if recent_deviations:
            payload["recent_deviations"] = recent_deviations
        return payload

    def _slim_recent_action_history(
        self,
        history: Optional[List[Dict[str, Any]]],
        *,
        limit: int = 15,
    ) -> List[Dict[str, Any]]:
        """Keep enough to avoid repeats without full action payloads."""
        slim_rows: List[Dict[str, Any]] = []
        for row in (history or [])[:limit]:
            if not isinstance(row, dict):
                continue
            reason = row.get("reason") or row.get("rationale") or ""
            if isinstance(reason, str) and len(reason) > 80:
                reason = reason[:80]
            slim_rows.append(self._omit_empty({
                "for_date": row.get("for_date"),
                "domain": row.get("domain"),
                "title": row.get("title"),
                "priority": row.get("priority"),
                "reason": reason or None,
            }))
        return slim_rows

    def _build_action_generator_agent_inputs(self, state: PipelineState) -> Dict[str, Any]:
        """Slim inputs for action candidate generator."""
        user_goal = self._slim_user_goal(state.get("user_goal"))
        goal_spec = user_goal.get("goal_spec") if isinstance(user_goal.get("goal_spec"), dict) else {}
        slim_bundle = self._slim_input_bundle(state.get("input_bundle") or {})
        nutrition = slim_bundle.get("nutrition") if isinstance(slim_bundle.get("nutrition"), dict) else {}
        meal_context = nutrition.get("meal_context") if isinstance(nutrition.get("meal_context"), dict) else {}
        readiness_src = state.get("coach_readiness") or {}
        return {
            "overall_score": state["overall_score"],
            "energy_mode": self._get_energy_mode(state["overall_score"]),
            "selected_domains": state.get("selected_domains") or [],
            "goal_domains": goal_spec.get("primary_domains") or [],
            "user_goal": user_goal,
            "day_constraints": self._slim_day_constraints(state.get("day_constraints")),
            "holistic_status_report": self._slim_holistic_status_report(
                state.get("holistic_status_report")
            ),
            "input_bundle": slim_bundle,
            "meal_context": meal_context,
            "current_state": self._slim_current_state(state.get("current_state") or {}),
            "recent_state_history": self._slim_recent_history(
                state.get("recent_state_history") or []
            )[:5],
            "recent_action_history": self._slim_recent_action_history(
                state.get("recent_action_history")
            ),
            "coach_readiness": {
                "fast_ready": bool(readiness_src.get("fast_ready")),
                "slow_ready": bool(readiness_src.get("slow_ready")),
            },
            "behavior_profile": self._slim_behavior_profile(
                state.get("behavior_profile") or {}
            ),
        }

    def _slim_action_proposal(self, action: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """Keep critic-relevant action fields; drop empty shells and duplicate metadata."""
        if not action or not isinstance(action, dict):
            return {}
        evidence = action.get("evidence") if isinstance(action.get("evidence"), dict) else {}
        evaluation = action.get("evaluation") if isinstance(action.get("evaluation"), dict) else {}
        feasibility = (
            action.get("feasibility_constraints")
            if isinstance(action.get("feasibility_constraints"), dict)
            else {}
        )
        cooldown = action.get("cooldown_logic") if isinstance(action.get("cooldown_logic"), dict) else {}
        slim_eval = self._omit_empty({
            "mode": evaluation.get("mode") or action.get("evaluation_mode"),
            "signal_refs": evaluation.get("signal_refs"),
            "completion_prompt": evaluation.get("completion_prompt"),
            "success_definition": evaluation.get("success_definition"),
        })
        return self._omit_empty({
            "action_id": action.get("action_id"),
            "title": action.get("title"),
            "description": action.get("description"),
            "domain": action.get("domain"),
            "when": action.get("when"),
            "priority": action.get("priority"),
            "effort_level": action.get("effort_level"),
            "tags": action.get("tags"),
            "rationale": action.get("rationale"),
            "assumptions": action.get("assumptions"),
            "fallbacks": action.get("fallbacks"),
            "requires_user_rating": action.get("requires_user_rating"),
            "evidence": self._omit_empty({
                "bundle_refs": evidence.get("bundle_refs"),
                "state_refs": evidence.get("state_refs"),
                "history_refs": evidence.get("history_refs"),
            }) or None,
            "evaluation": slim_eval or None,
            "feasibility_constraints": self._omit_empty({
                "time_minutes": feasibility.get("time_minutes"),
                "requires_equipment": feasibility.get("requires_equipment"),
                "must_avoid": feasibility.get("must_avoid"),
            }) or None,
            "cooldown_logic": self._omit_empty(dict(cooldown)) or None,
        })

    def _build_fusion_critic_agent_inputs(self, state: PipelineState) -> Dict[str, Any]:
        """Slim inputs for fusion critic review."""
        user_goal = self._slim_user_goal(state.get("user_goal"))
        goal_spec = user_goal.get("goal_spec") if isinstance(user_goal.get("goal_spec"), dict) else {}
        proposals = state.get("action_proposals") or []
        return {
            "selected_domains": state.get("selected_domains") or [],
            "goal_domains": goal_spec.get("primary_domains") or [],
            "user_goal": user_goal,
            "day_constraints": self._slim_day_constraints(state.get("day_constraints")),
            "action_proposals": [
                self._slim_action_proposal(a) for a in proposals if isinstance(a, dict)
            ],
            "coach_readiness": self._slim_coach_readiness_with_coverage(
                state.get("coach_readiness")
            ),
            "budget_policy": {
                "max_displayed_actions": 3,
                "hard_cap": 4,
                "min_valid": 3,
            },
        }

    def _slim_display_action_for_brief(self, action: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """Brief only needs narrative action fields; UI renders the rest."""
        if not action or not isinstance(action, dict):
            return {}
        return self._omit_empty({
            "title": action.get("title"),
            "description": action.get("description"),
            "rationale": action.get("rationale"),
            "when": action.get("when"),
            "domain": action.get("domain"),
            "priority": action.get("priority"),
        })

    def _build_morning_brief_agent_inputs(self, state: PipelineState) -> Dict[str, Any]:
        """Slim inputs for morning brief composer."""
        budget = state.get("budget_result") or {}
        display_actions = budget.get("display_actions") or []
        return {
            "user_name": state.get("user_name") or None,
            "energy_mode": self._get_energy_mode(state["overall_score"]),
            "overall_score": state["overall_score"],
            "selected_domains": state.get("selected_domains") or [],
            "coach_readiness": self._slim_coach_readiness_with_coverage(
                state.get("coach_readiness")
            ),
            "holistic_status_report": self._slim_holistic_status_report(
                state.get("holistic_status_report")
            ),
            "display_actions": [
                self._slim_display_action_for_brief(a)
                for a in display_actions
                if isinstance(a, dict)
            ],
        }

    def _extract_recent_action_memory(self, recent_state_history: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Flatten recent generated actions from state history for deduplication/variety."""
        flattened: List[Dict[str, Any]] = []
        for row in recent_state_history:
            actions_payload = row.get('actions_generated_json') or {}
            actions = actions_payload.get('actions', []) if isinstance(actions_payload, dict) else []
            if not isinstance(actions, list):
                continue

            for action in actions:
                if not isinstance(action, dict):
                    continue
                flattened.append({
                    'for_date': row.get('date'),
                    'action_id': action.get('action_id'),
                    'title': action.get('title'),
                    'description': action.get('description'),
                    'domain': action.get('domain'),
                    'priority': action.get('priority'),
                    'reason': action.get('rationale') or action.get('reason') or '',
                })
        return flattened[:15]
    
    def node_fetch_data(self, state: PipelineState) -> PipelineState:
        """Prepared context fetch."""
        target_date = date.fromisoformat(state['for_date'])
        prepared_context = self.data_fetcher.fetch_prepared_context(state['user_id'], target_date)

        # Fetch user profile for personalization
        profile = self.data_fetcher.fetch_user_profile(state['user_id'])
        state['user_name'] = profile.get('first_name', '') if profile else ''

        input_bundle = prepared_context.get('input_bundle') or {}
        current_state = prepared_context.get('current_state') or {}
        recent_state_history = prepared_context.get('recent_state_history') or []

        if not input_bundle:
            raise ValueError(f"Missing daily_input_bundle_v12 for {state['for_date']}")
        if not current_state:
            raise ValueError("Missing user_state_current2 for morning coach pipeline")

        state_json = current_state.get('state_json') or {}
        uncertainty = state_json.get('uncertainty') or {}
        baseline_flags = uncertainty.get('baseline_stability_flags') or {}

        state['input_bundle'] = input_bundle.get('bundle_json') or {}
        state['current_state'] = state_json
        state['recent_state_history'] = recent_state_history
        state['recent_action_history'] = self._extract_recent_action_memory(recent_state_history)
        state['coach_readiness'] = {
            'fast_ready': bool(baseline_flags.get('fast_ready')),
            'slow_ready': bool(baseline_flags.get('slow_ready')),
            'bundle_missingness': input_bundle.get('missingness_json') or {},
            'bundle_confidence': input_bundle.get('confidence_json') or {},
        }
        state['behavior_profile'] = profile_payload_from_row(
            get_latest_active_profile(self.client, state['user_id'])
        )
        return state
    
    def node_holistic_status_report(self, state: PipelineState) -> PipelineState:
        """Holistic Status Reporter using prepared bundle + auditable state."""
        from prompts import HOLISTIC_STATUS_REPORTER_SYSTEM_PROMPT

        started_at = datetime.utcnow()
        holistic_inputs = self._build_holistic_agent_inputs(state)

        user_prompt = f"""Overall score today: {holistic_inputs['overall_score']}

Prepared daily input bundle (slimmed status signals):
{json.dumps(holistic_inputs['input_bundle'], indent=2)}

Current auditable state (baselines as last/baseline/z_fast; slopes/volatility slimmed):
{json.dumps(holistic_inputs['current_state'], indent=2)}

Recent state history (most recent first; scores/deviations only):
{json.dumps(holistic_inputs['recent_state_history'], indent=2)}

Coach readiness (baseline stability only; missingness/confidence are in the bundle):
{json.dumps(holistic_inputs['coach_readiness'], indent=2)}

Behavior profile:
{json.dumps(holistic_inputs['behavior_profile'], indent=2)}

Generate the holistic status report JSON.
Do not mention goals or treat goals as missing."""
        
        # Use temperature=0 for maximum determinism
        response = self._call_llm(HOLISTIC_STATUS_REPORTER_SYSTEM_PROMPT, user_prompt, temperature=0)
        debug_log(f"[HOLISTIC_STATUS_REPORTER] Response: {response[:400]}...")
        
        report = self._parse_or_retry_llm_json(
            response,
            HOLISTIC_STATUS_REPORTER_SYSTEM_PROMPT,
            user_prompt,
            'holistic_status_reporter',
            retry_temperature=0,
        )
        
        state['holistic_status_report'] = report
        
        debug_log(f"[HOLISTIC_STATUS_REPORTER] Generated report for user {state['user_id']} on {state['for_date']}")
        
        # Log the exact holistic view (goals intentionally null / out of scope)
        self.logger.log_agent_run(
            ingestion_run_id=state['ingestion_run_id'],
            user_id=state['user_id'],
            for_date=date.fromisoformat(state['for_date']),
            agent_name='holistic_status_reporter',  # closest valid enum; report stored in output_json
            attempt=state.get('attempt', 0) + 100,
            status='success',
            input_json=holistic_inputs,
            output_json=report,
            evidence_refs_json={
                d: s.get('key_evidence', []) 
                for d, s in {s['domain']: s for s in report.get('domain_summaries', [])}.items()
            },
            started_at=started_at,
            ended_at=datetime.utcnow()
        )
        
        debug_log(f"[HOLISTIC_STATUS_REPORTER] Daily wellness index: {report.get('daily_wellness_index')} | Self-report: {report.get('user_self_report_score')} | Alignment: {report.get('self_report_vs_data_alignment')}")
        return state
    
    def node_fetch_goal(self, state: PipelineState) -> PipelineState:
        """Fetch user goal from database"""
        result = self.client.table('user_goals1') \
            .select('*') \
            .eq('user_id', state['user_id']) \
            .eq('status', 'active') \
            .order('created_at', desc=True) \
            .limit(1) \
            .execute()
        
        state['user_goal'] = result.data[0] if result.data else None
        return state
    
    def node_enforce_budget(self, state: PipelineState) -> PipelineState:
        """Budget Enforcer Agent"""
        energy_mode = self._get_energy_mode(state['overall_score'])
        accepted_actions = [
            a for a in state['action_proposals']
            if a['action_id'] in state['review_result']['accepted_action_ids']
        ]
        
        budget_result = self.budget_enforcer.run(
            accepted_actions,
            energy_mode,
            state['day_constraints']
        )
        state['budget_result'] = budget_result
        
        # Log final display actions after budget enforcement
        # Note: Skip logging for deterministic budget enforcer to avoid UUID issues
        # Or log it to a separate table if needed
        
        return state
    
    def node_persist_plan(self, state: PipelineState) -> PipelineState:
        """Persistence Agent"""
        target_date = date.fromisoformat(state['for_date'])
        plan_id = self.persistence_agent.persist_daily_plan(
            state['ingestion_run_id'],
            state['user_id'],
            target_date,
            state['day_constraints'],
            state['selected_domains'],
            state['morning_message'],
            state['budget_result'],
            state['budget_result']['display_actions']
        )
        state['plan_id'] = plan_id
        return state
    
    # === LLM Reasoning Agents ===
    
    def node_build_constraints(self, state: PipelineState) -> PipelineState:
        """Constraints Builder LLM Agent"""
        from prompts import CONSTRAINTS_BUILDER_SYSTEM_PROMPT
        
        started_at = datetime.utcnow()
        constraints_inputs = self._build_constraints_agent_inputs(state)
        user_prompt = f"""Energy mode: {constraints_inputs['energy_mode']}
Overall score: {constraints_inputs['overall_score']}

User goal (statement/domains/constraint defaults only):
{json.dumps(constraints_inputs['user_goal'], indent=2)}

Constraint signal pack (core recovery/load/journal signals only):
{json.dumps(constraints_inputs['signal_pack'], indent=2)}

State digest (top |z| deviations, key slopes, volatility/residual/episodic):
{json.dumps(constraints_inputs['state_digest'], indent=2)}

Behavior profile (summary + coaching rule):
{json.dumps(constraints_inputs['behavior_profile'], indent=2)}

Generate day constraints JSON.
"""
        
        response = self._call_llm(CONSTRAINTS_BUILDER_SYSTEM_PROMPT, user_prompt)
        debug_log(f"[CONSTRAINTS_BUILDER] Response: {response[:200]}...")
        
        output = self._parse_or_retry_llm_json(
            response,
            CONSTRAINTS_BUILDER_SYSTEM_PROMPT,
            user_prompt,
            'constraints_builder',
            retry_temperature=0,
        )
        
        state['day_constraints'] = output
        
        # Log agent run — persist the exact slimmed inputs sent to the LLM
        self.logger.log_agent_run(
            ingestion_run_id=state['ingestion_run_id'],
            user_id=state['user_id'],
            for_date=date.fromisoformat(state['for_date']),
            agent_name='constraints_builder',
            attempt=state.get('attempt', 0),
            status='success',
            input_json=constraints_inputs,
            output_json=output,
            evidence_refs_json=output.get('evidence_used', {}),
            started_at=started_at,
            ended_at=datetime.utcnow()
        )
        
        return state
    
    def node_route_domains(self, state: PipelineState) -> PipelineState:
        """Domain Router LLM Agent"""
        from prompts import DOMAIN_ROUTER_SYSTEM_PROMPT
        
        started_at = datetime.utcnow()
        router_inputs = self._build_domain_router_agent_inputs(state)
        recent_dev_block = ""
        if router_inputs.get("recent_deviations"):
            recent_dev_block = (
                "\nRecent state-history deviations (non-empty only):\n"
                f"{json.dumps(router_inputs['recent_deviations'], indent=2)}\n"
            )

        user_prompt = f"""Energy mode: {router_inputs['energy_mode']}

Day constraints:
{json.dumps(router_inputs['day_constraints'], indent=2)}

User goal (statement + domains only):
{json.dumps(router_inputs['user_goal'], indent=2)}

Primary domains: {json.dumps(router_inputs['primary_domains'])}
Secondary domains: {json.dumps(router_inputs['secondary_domains'])}

Coach readiness / signal coverage (goal fields removed):
{json.dumps(router_inputs['coach_readiness'], indent=2)}

Holistic status report (trimmed evidence):
{json.dumps(router_inputs['holistic_status_report'], indent=2)}

Behavior profile (incl. cluster interpretations for routing):
{json.dumps(router_inputs['behavior_profile'], indent=2)}
{recent_dev_block}
Select 2-3 domains.
"""
        
        response = self._call_llm(DOMAIN_ROUTER_SYSTEM_PROMPT, user_prompt)
        debug_log(f"[DOMAIN_ROUTER] Response: {response[:300]}...")
        
        output = self._parse_or_retry_llm_json(
            response,
            DOMAIN_ROUTER_SYSTEM_PROMPT,
            user_prompt,
            'domain_router',
            retry_temperature=0,
        )
        
        # Extract domain names from selected_domains (which may be dicts with 'domain' key)
        selected = output['selected_domains']
        if selected and isinstance(selected[0], dict):
            state['selected_domains'] = [d['domain'] for d in selected]
        else:
            state['selected_domains'] = selected
        
        # Log agent run — persist the exact slimmed inputs sent to the LLM
        self.logger.log_agent_run(
            ingestion_run_id=state['ingestion_run_id'],
            user_id=state['user_id'],
            for_date=date.fromisoformat(state['for_date']),
            agent_name='domain_router',
            attempt=state.get('attempt', 0),
            status='success',
            input_json=router_inputs,
            output_json=output,
            rationale_json={d.get('domain'): d.get('rationale') for d in selected if isinstance(d, dict)},
            evidence_refs_json={d.get('domain'): d.get('evidence') for d in selected if isinstance(d, dict)},
            started_at=started_at,
            ended_at=datetime.utcnow()
        )
        
        return state

    def node_generate_actions(self, state: PipelineState) -> PipelineState:
        """Action Generator LLM Agent"""
        from prompts import ACTION_GENERATOR_SYSTEM_PROMPT

        started_at = datetime.utcnow()
        action_inputs = self._build_action_generator_agent_inputs(state)
        action_history_context = ""
        if action_inputs.get("recent_action_history"):
            action_history_context = (
                "\nRecent actions (last 7 days — avoid repeating the same suggestions):\n"
                f"{json.dumps(action_inputs['recent_action_history'], indent=2)}\n"
            )

        user_prompt = f"""Overall score today: {action_inputs['overall_score']}
Energy mode: {action_inputs['energy_mode']}
Selected domains: {json.dumps(action_inputs['selected_domains'])}
User goal domains: {json.dumps(action_inputs['goal_domains'])}

User goal (slimmed):
{json.dumps(action_inputs['user_goal'], indent=2)}

Day constraints (slimmed):
{json.dumps(action_inputs['day_constraints'], indent=2)}

Holistic status report:
{json.dumps(action_inputs['holistic_status_report'], indent=2)}

Prepared daily input bundle (slimmed):
{json.dumps(action_inputs['input_bundle'], indent=2)}

Current auditable state (baselines as last/baseline/z_fast; slopes/volatility slimmed):
{json.dumps(action_inputs['current_state'], indent=2)}

Recent state history (scores/deviations only):
{json.dumps(action_inputs['recent_state_history'], indent=2)}

Meal context (from slimmed bundle):
{json.dumps(action_inputs['meal_context'], indent=2)}

Behavior profile:
{json.dumps(action_inputs['behavior_profile'], indent=2)}
{action_history_context}
Generate 4-5 actions. Follow the rules: If selected and goal domains overlap, generate 3-4 actions for those domains.
 If different, generate at least 3 for selected domains and at least 1 (ideally 1-2) for the goal domain(s).
 **DO NOT include action_id - it will be generated automatically.**
"""

        response = self._call_llm(ACTION_GENERATOR_SYSTEM_PROMPT, user_prompt)
        debug_log(f"[ACTION_GENERATOR] Response (first 800 chars): {response[:800]}")

        output = self._parse_or_retry_llm_json(
            response,
            ACTION_GENERATOR_SYSTEM_PROMPT,
            user_prompt,
            'action_generator',
            retry_temperature=0,
        )

        # Add action IDs
        actions = add_action_ids_to_candidates(output['actions'])
        state['action_proposals'] = actions
        state['attempt'] = state.get('attempt', 0) + 1

        # Log agent run — persist the exact slimmed inputs sent to the LLM
        agent_run_id = self.logger.log_agent_run(
            ingestion_run_id=state['ingestion_run_id'],
            user_id=state['user_id'],
            for_date=date.fromisoformat(state['for_date']),
            agent_name='action_candidate_generator',
            attempt=state['attempt'],
            status='success',
            input_json=action_inputs,
            output_json={'actions': actions},
            rationale_json={a['action_id']: a.get('rationale', '') for a in actions},
            started_at=started_at,
            ended_at=datetime.utcnow()
        )

        # Log action proposals
        self.logger.log_action_proposals(
            ingestion_run_id=state['ingestion_run_id'],
            user_id=state['user_id'],
            for_date=date.fromisoformat(state['for_date']),
            stage='candidates',
            attempt=state['attempt'],
            agent_run_id=agent_run_id,
            proposals_json=actions
        )

        return state
    
    def node_review_actions(self, state: PipelineState) -> PipelineState:
        """Fusion Critic LLM Agent"""
        from prompts import FUSION_CRITIC_SYSTEM_PROMPT

        started_at = datetime.utcnow()
        critic_inputs = self._build_fusion_critic_agent_inputs(state)
        user_prompt = f"""Selected domains:
{json.dumps(critic_inputs['selected_domains'], indent=2)}

User goal domains:
{json.dumps(critic_inputs['goal_domains'], indent=2)}

User goal (slimmed):
{json.dumps(critic_inputs['user_goal'], indent=2)}

Day constraints (slimmed):
{json.dumps(critic_inputs['day_constraints'], indent=2)}

Proposed actions (slimmed):
{json.dumps(critic_inputs['action_proposals'], indent=2)}

Budget policy:
{json.dumps(critic_inputs['budget_policy'], indent=2)}

Coach readiness / signal coverage (goal fields removed):
{json.dumps(critic_inputs['coach_readiness'], indent=2)}

Review for coherence, feasibility, safety, and domain/goal coverage rules. Accept at least 4 if possible.
"""
        
        response = self._call_llm(FUSION_CRITIC_SYSTEM_PROMPT, user_prompt)
        debug_log(f"[FUSION_CRITIC] Response: {response[:400]}...")
        
        review_result = self._parse_or_retry_llm_json(
            response,
            FUSION_CRITIC_SYSTEM_PROMPT,
            user_prompt,
            'fusion_critic',
            retry_temperature=0,
        )
        
        state['review_result'] = review_result
        
        # Ensure accepted_action_ids exists (handle both formats)
        if 'accepted_action_ids' not in state['review_result']:
            if 'accepted_actions' in state['review_result']:
                # Convert accepted_actions (indices) to action_ids
                accepted_indices = state['review_result']['accepted_actions']
                state['review_result']['accepted_action_ids'] = [
                    state['action_proposals'][i]['action_id'] 
                    for i in accepted_indices 
                    if i < len(state['action_proposals'])
                ]
                debug_log(f"[FUSION_CRITIC] Converted accepted_actions to accepted_action_ids: {state['review_result']['accepted_action_ids']}")
            else:
                debug_log(f"[WARNING] No accepted_action_ids in review_result. Keys: {state['review_result'].keys()}")
                # Default: accept all action IDs
                state['review_result']['accepted_action_ids'] = [a['action_id'] for a in state['action_proposals']]
        
        # Log agent run — persist the exact slimmed inputs sent to the LLM
        agent_run_id = self.logger.log_agent_run(
            ingestion_run_id=state['ingestion_run_id'],
            user_id=state['user_id'],
            for_date=date.fromisoformat(state['for_date']),
            agent_name='fusion_critic',
            attempt=state.get('attempt', 0),
            status='success',
            input_json=critic_inputs,
            output_json=review_result,
            evidence_refs_json=review_result.get('evidence_used', {}),
            started_at=started_at,
            ended_at=datetime.utcnow()
        )
        
        # Log accepted actions as separate proposal stage
        accepted_actions = [
            a for a in state['action_proposals']
            if a['action_id'] in state['review_result']['accepted_action_ids']
        ]
        if accepted_actions:
            self.logger.log_action_proposals(
                ingestion_run_id=state['ingestion_run_id'],
                user_id=state['user_id'],
                for_date=date.fromisoformat(state['for_date']),
                stage='revised_candidates',
                attempt=state.get('attempt', 0),
                agent_run_id=agent_run_id,
                proposals_json=accepted_actions
            )
        
        return state
    
    def node_compose_brief(self, state: PipelineState) -> PipelineState:
        """Morning Brief Composer LLM Agent"""
        from prompts import MORNING_BRIEF_COMPOSER_SYSTEM_PROMPT

        started_at = datetime.utcnow()
        brief_inputs = self._build_morning_brief_agent_inputs(state)
        user_name = brief_inputs.get("user_name")
        user_name_line = (
            f"- User name: {user_name}" if user_name else "- User name: not available"
        )

        user_prompt = f"""Today's situation:
- Energy mode: {brief_inputs['energy_mode']}
- Overall score: {brief_inputs['overall_score']}
- Selected domains: {', '.join(brief_inputs['selected_domains'])}
- Coach readiness / signal coverage (goal fields removed): {json.dumps(brief_inputs['coach_readiness'], indent=2)}
{user_name_line}

Holistic status report:
{json.dumps(brief_inputs['holistic_status_report'], indent=2)}

Display actions (title/description/rationale/when only — UI renders details):
{json.dumps(brief_inputs['display_actions'], indent=2)}

Write a personal morning note (200-250 words). Spend most of the words on the narrative — dig into the data, tell the story of yesterday and what it means for today. Keep actions concise. Use markdown for formatting.
"""
        
        response = self._call_llm(MORNING_BRIEF_COMPOSER_SYSTEM_PROMPT, user_prompt)
        debug_log(f"[MORNING_BRIEF_COMPOSER] Response:\n{response}")
        
        output = self._parse_or_retry_llm_json(
            response,
            MORNING_BRIEF_COMPOSER_SYSTEM_PROMPT,
            user_prompt,
            'morning_brief_composer',
            retry_temperature=0,
        )
        
        state['morning_message'] = output['morning_message']
        
        # Log agent run — persist the exact slimmed inputs sent to the LLM
        self.logger.log_agent_run(
            ingestion_run_id=state['ingestion_run_id'],
            user_id=state['user_id'],
            for_date=date.fromisoformat(state['for_date']),
            agent_name='morning_brief_composer',
            attempt=state.get('attempt', 0),
            status='success',
            input_json=brief_inputs,
            output_json=output,
            started_at=started_at,
            ended_at=datetime.utcnow()
        )
        
        return state
    
    # === Helper methods ===
    
    def _call_llm(self, system_prompt: str, user_prompt: str, temperature: float = 0.7) -> str:
        """Call LLM with system and user prompts"""
        if temperature != self.llm.temperature:
            llm = self._build_chat_model(temperature=temperature)
        else:
            llm = self.llm
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt)
        ]
        response = llm.invoke(messages)
        content = response.content
        
        # Validate we got actual content
        if not content or content.strip() == '':
            raise ValueError("LLM returned empty response")
        
        debug_log(
            f"[LLM] provider={self.llm_config.provider} model={self.llm_config.model} "
            f"raw response length: {len(content)}"
        )
        return content

    def _parse_llm_json(self, response: str, agent_name: str) -> Dict[str, Any]:
        """Parse LLM JSON robustly, handling fences, wrapper text, and minor JSON drift."""
        cleaned = self._normalize_llm_response_to_text(response)
        candidates = self._build_json_candidates(cleaned)

        for candidate in candidates:
            parsed = self._try_parse_json_candidate(candidate)
            if parsed is not None:
                return parsed

        debug_log(f"[ERROR] Failed to parse {agent_name} JSON")
        debug_log(f"[ERROR] Raw response: {response}")
        raise ValueError(f"{agent_name} returned invalid JSON")

    def _parse_or_retry_llm_json(
        self,
        initial_response: str,
        system_prompt: str,
        user_prompt: str,
        agent_name: str,
        retry_temperature: float = 0,
    ) -> Dict[str, Any]:
        """Parse JSON, retrying the LLM once if the first response is malformed."""
        try:
            return self._parse_llm_json(initial_response, agent_name)
        except ValueError:
            debug_log(f"[WARN] {agent_name} returned invalid JSON on first attempt, retrying once.")
            retry_prompt = (
                f"{user_prompt}\n\n"
                "Your previous response was not valid JSON. "
                "Return ONLY valid JSON matching the requested schema. "
                "Do not use markdown fences. Do not add commentary."
            )
            retry_response = self._call_llm(system_prompt, retry_prompt, temperature=retry_temperature)
            debug_log(f"[{agent_name.upper()} RETRY] Response: {retry_response[:400]}...")
            return self._parse_llm_json(retry_response, agent_name)

    def _normalize_llm_response_to_text(self, response: Any) -> str:
        """Normalize LangChain/OpenAI response content into a plain string."""
        if isinstance(response, str):
            text = response
        elif isinstance(response, list):
            parts = []
            for item in response:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict):
                    text_part = item.get("text")
                    if isinstance(text_part, str):
                        parts.append(text_part)
            text = "\n".join(parts)
        else:
            text = str(response)

        text = text.strip()

        if text.startswith("```"):
            lines = text.splitlines()
            if lines and lines[0].strip().startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            text = "\n".join(lines).strip()

        if text.lower().startswith("json\n"):
            text = text[5:].strip()

        return text

    def _build_json_candidates(self, text: str) -> List[str]:
        """Generate likely JSON substrings from model output."""
        candidates: List[str] = []

        def add_candidate(value: str):
            candidate = value.strip()
            if candidate and candidate not in candidates:
                candidates.append(candidate)

        add_candidate(text)

        fenced_blocks = re.findall(r"```(?:json)?\s*(.*?)```", text, flags=re.DOTALL | re.IGNORECASE)
        for block in fenced_blocks:
            add_candidate(block)

        balanced = self._extract_balanced_json_substring(text)
        if balanced:
            add_candidate(balanced)

        start_candidates = [idx for idx in (text.find("{"), text.find("[")) if idx != -1]
        end_candidates = [idx for idx in (text.rfind("}"), text.rfind("]")) if idx != -1]
        if start_candidates and end_candidates:
            start = min(start_candidates)
            end = max(end_candidates)
            if end > start:
                add_candidate(text[start:end + 1])

        return candidates

    def _extract_balanced_json_substring(self, text: str) -> str:
        """Extract the first balanced JSON object/array from mixed text."""
        start = None
        stack: List[str] = []
        in_string = False
        escape = False

        for i, ch in enumerate(text):
            if start is None:
                if ch in "{[":
                    start = i
                    stack = [ch]
                continue

            if in_string:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_string = False
                continue

            if ch == '"':
                in_string = True
            elif ch in "{[":
                stack.append(ch)
            elif ch in "}]":
                if not stack:
                    break
                opener = stack.pop()
                if (opener, ch) not in {("{", "}"), ("[", "]")}:
                    break
                if not stack:
                    return text[start:i + 1]

        return ""

    def _try_parse_json_candidate(self, candidate: str) -> Any:
        """Try parsing a candidate, including a few safe cleanup passes."""
        attempts = [
            candidate,
            self._strip_json_prefix(candidate),
            self._remove_trailing_commas(candidate),
            self._remove_trailing_commas(self._strip_json_prefix(candidate)),
            self._coerce_common_json_glitches(candidate),
            self._remove_trailing_commas(self._coerce_common_json_glitches(candidate)),
            self._coerce_common_json_glitches(self._strip_json_prefix(candidate)),
            self._remove_trailing_commas(self._coerce_common_json_glitches(self._strip_json_prefix(candidate))),
        ]

        for attempt in attempts:
            if not attempt:
                continue
            try:
                return json.loads(attempt)
            except json.JSONDecodeError:
                continue

        return None

    def _strip_json_prefix(self, text: str) -> str:
        stripped = text.strip()
        if stripped.lower().startswith("json"):
            stripped = stripped[4:].lstrip(":").strip()
        return stripped

    def _remove_trailing_commas(self, text: str) -> str:
        return re.sub(r",(\s*[}\]])", r"\1", text)

    def _coerce_common_json_glitches(self, text: str) -> str:
        cleaned = text.strip()

        if cleaned in {"```", "```json"}:
            return ""

        # Bare tokens like A2 in numeric arrays should usually be 2.
        cleaned = re.sub(r'(?<=\[|,)\s*[A-Za-z](\d+)\s*(?=,|\])', r' \1', cleaned)
        cleaned = re.sub(r'(:\s*)[A-Za-z](\d+)(\s*[,}])', r'\1\2\3', cleaned)

        return cleaned

    def _get_energy_mode(self, overall_score: int) -> str:
        """Map overall score to energy mode"""
        if overall_score <= 39:
            return 'low'
        elif overall_score <= 69:
            return 'normal'
        return 'high'
    
    def _should_regenerate(self, state: PipelineState) -> str:
        """Decide if regeneration is needed"""
        accepted_count = len(state['review_result']['accepted_action_ids'])
        should_regen = self.regen_controller.should_regenerate(
            state['attempt'],
            accepted_count,
            state['review_result']['regen_required']
        )
        return "regenerate" if should_regen else "continue"
    
    def run(self, user_id: str, for_date: str, overall_score: int, ingestion_run_id: str) -> Dict:
        """Execute the pipeline"""
        initial_state: PipelineState = {
            'user_id': user_id,
            'for_date': for_date,
            'overall_score': overall_score,
            'ingestion_run_id': ingestion_run_id,
            'attempt': 0,
            'input_bundle': {},
            'current_state': {},
            'recent_state_history': [],
            'coach_readiness': {},
            'behavior_profile': {},
            'user_name': '',
            'recent_action_history': [],
            'user_goal': None,
            'holistic_status_report': {},
            'day_constraints': {},
            'selected_domains': [],
            'action_proposals': [],
            'review_result': {},
            'budget_result': {},
            'morning_message': '',
            'plan_id': '',
            'error': ''
        }
        
        final_state = self.graph.invoke(initial_state)
        
        return {
            'plan_id': final_state['plan_id'],
            'morning_message': final_state['morning_message'],
            'actions': final_state['budget_result']['display_actions'],
            'debug': {
                'energy_mode': self._get_energy_mode(overall_score),
                'selected_domains': final_state['selected_domains'],
                'day_constraints': final_state['day_constraints'],
                'confidence': final_state['coach_readiness'].get('bundle_confidence', {}),
                'behavior_profile': final_state.get('behavior_profile', {}),
                'attempts': final_state['attempt'],
                'holistic_status_report': final_state['holistic_status_report'],
                'llm_provider': self.llm_config.provider,
                'llm_model': self.llm_config.model,
            }
        }

"""
LangGraph Pipeline - Orchestrates morning coach workflow
Combines Python deterministic agents + LLM reasoning agents
"""
import os
import sys
import re
from datetime import datetime, date, timedelta
from typing import Dict, List, Any, TypedDict, Annotated, Optional
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
import json

from data.data_fetcher import DataFetcher
from data_prep.day_validity import apply_day_validity
from data_prep.feature_series import fetch_recent_feature_matrix
from data_prep.rolling_windows import (
    KEY_FEATURES,
    compute_rolling_aggregates,
)
from profiling.behavior_profile_store import get_latest_active_profile, profile_payload_from_row
from profiling.patterns import (
    DEFAULT_PATTERN_CONFIG,
    detect_active_patterns,
    domains_for_high_patterns,
    high_severity_patterns,
    recovery_energy_cap_required,
)
from correlations.correlation_archetype_store import (
    get_latest_active_archetype,
    archetype_payload_from_row,
)
from pipeline.deterministic_agents import (
    BudgetEnforcerAgent,
    PersistenceAgent,
    RegenerationController
)
from pipeline.action_utils import add_action_ids_to_candidates
from pipeline.agent_logger import AgentLogger
from llm.llm_config import (
    DEFAULT_COACH_OPENROUTER_MODEL,
    LlmClientConfig,
    resolve_coach_pipeline_llm_config,
)

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
    correlation_archetype: Dict[str, Any]

    # User context
    user_name: str
    recent_action_history: List[Dict]
    previous_morning_brief: Dict[str, Any]
    active_patterns: List[Dict[str, Any]]

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
                model=os.getenv("COACH_LLM_MODEL") or DEFAULT_COACH_OPENROUTER_MODEL,
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
        
        # Conditional: regen or continue to budget/compose
        workflow.add_conditional_edges(
            "review_actions",
            self._should_regenerate,
            {
                "regenerate": "generate_actions",
                "continue": "enforce_budget",
            }
        )
        
        workflow.add_edge("enforce_budget", "compose_brief")
        workflow.add_edge("compose_brief", "persist_plan")
        workflow.add_edge("persist_plan", END)
        
        return workflow.compile()
    
    # === Python Deterministic Agents ===

    RECOVERY_DOMAINS = frozenset({"sleep", "recovery", "stress"})
    ENERGY_MODE_RANK = {"low": 0, "moderate": 1, "normal": 2, "high": 3}
    FAST_READY_MIN_N_VALID = 7
    # Lower-confidence tier: enough same-feature history for a hedged early comparison
    # ("early trend, still calibrating"), well before the full fast_ready bar (7 days).
    # Never unlocks z-scores/volatility/slopes — only a hedged last-vs-recent-average
    # mention for a small fixed feature set. Hard floor: never below this many valid days.
    TREND_READY_MIN_N_VALID = 4
    EARLY_TREND_FEATURES = frozenset({
        "sleep_duration_hours",
        "sleep_efficiency",
        "energy_score",
        "stress_score",
        "focus_score",
        "hrv_daily_rmssd",
    })
    BANNED_HIGH_ENERGY_PHRASES = (
        "harness your energy",
        "harness that energy",
        "channel your high energy",
        "ride this high energy",
        "capitalize on your energy",
    )

    def _strip_goal_fields_from_missingness(self, missingness: Dict[str, Any]) -> Dict[str, Any]:
        cleaned = dict(missingness or {})
        cleaned.pop("missing_goals", None)
        return cleaned

    def _strip_goal_fields_from_confidence(self, confidence: Dict[str, Any]) -> Dict[str, Any]:
        cleaned = dict(confidence or {})
        cleaned.pop("confidence_goals", None)
        return cleaned

    def _is_fast_ready(self, state: PipelineState) -> bool:
        """True only when baseline stability flag is set and core features have enough history."""
        readiness = state.get("coach_readiness") or {}
        if not bool(readiness.get("fast_ready")):
            return False
        baselines = (state.get("current_state") or {}).get("baselines") or {}
        if not isinstance(baselines, dict) or not baselines:
            return False
        n_vals: List[int] = []
        for payload in baselines.values():
            if not isinstance(payload, dict):
                continue
            fast = payload.get("fast") if isinstance(payload.get("fast"), dict) else {}
            n = fast.get("n_valid")
            if isinstance(n, (int, float)) and n > 0:
                n_vals.append(int(n))
        if not n_vals:
            return False
        # Require typical tracked features to have enough history.
        ready_count = sum(1 for n in n_vals if n >= self.FAST_READY_MIN_N_VALID)
        return ready_count >= max(3, len(n_vals) // 3)

    def _is_trend_ready(self, state: PipelineState) -> bool:
        """Lower-confidence tier than _is_fast_ready: True once enough of the
        EARLY_TREND_FEATURES have >= TREND_READY_MIN_N_VALID days, independent of the
        upstream fast_ready flag. Only unlocks a hedged early_trend digest — never
        z-scores/volatility/slopes. Callers should only consult this when fast_ready
        is already False."""
        baselines = (state.get("current_state") or {}).get("baselines") or {}
        if not isinstance(baselines, dict) or not baselines:
            return False
        n_vals: List[int] = []
        for key, payload in baselines.items():
            if key not in self.EARLY_TREND_FEATURES or not isinstance(payload, dict):
                continue
            fast = payload.get("fast") if isinstance(payload.get("fast"), dict) else {}
            n = fast.get("n_valid")
            if isinstance(n, (int, float)) and n > 0:
                n_vals.append(int(n))
        if not n_vals:
            return False
        ready_count = sum(1 for n in n_vals if n >= self.TREND_READY_MIN_N_VALID)
        return ready_count >= max(2, len(n_vals) // 4)

    def _build_early_trend_digest(self, current_state: Dict[str, Any]) -> Dict[str, Any]:
        """Hedged last-vs-recent-average for a small fixed feature set once
        TREND_READY_MIN_N_VALID days exist. No z-score, no volatility — just two
        directly-observed numbers so the model can make an honestly-hedged comparison
        well before the full fast_ready bar (7 days)."""
        baselines = current_state.get("baselines") if isinstance(current_state.get("baselines"), dict) else {}
        out: Dict[str, Any] = {}
        for key, payload in baselines.items():
            if key not in self.EARLY_TREND_FEATURES or not isinstance(payload, dict):
                continue
            fast = payload.get("fast") if isinstance(payload.get("fast"), dict) else {}
            n_valid = fast.get("n_valid")
            if not isinstance(n_valid, (int, float)) or n_valid < self.TREND_READY_MIN_N_VALID:
                continue
            last_value = fast.get("last_value")
            recent_avg = fast.get("center_ewma")
            if last_value is None or recent_avg is None:
                continue
            out[key] = {"last": last_value, "recent_avg": recent_avg, "n_valid": int(n_valid)}
        return out

    def _sleep_duration_hours(self, state: PipelineState) -> Optional[float]:
        bundle = state.get("input_bundle") or {}
        watch = bundle.get("watch") if isinstance(bundle.get("watch"), dict) else {}
        sleep = watch.get("sleep") if isinstance(watch.get("sleep"), dict) else {}
        value = sleep.get("sleep_duration_hours")
        try:
            return float(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    def _cap_energy_mode(self, mode: str, cap: str) -> str:
        """Upper-bound energy_mode by rank (low < moderate < normal < high)."""
        mode_n = str(mode or "normal").lower()
        cap_n = str(cap or "normal").lower()
        if self.ENERGY_MODE_RANK.get(mode_n, 2) > self.ENERGY_MODE_RANK.get(cap_n, 2):
            return cap_n
        return mode_n

    def _safety_override_triggers(
        self,
        state: PipelineState,
        *,
        constraints: Optional[Dict[str, Any]] = None,
    ) -> List[str]:
        """Deterministic recovery-safety triggers (code, not prompt)."""
        triggers: List[str] = []
        sleep_h = self._sleep_duration_hours(state)
        if sleep_h is not None and sleep_h < 5.0:
            triggers.append("sleep_under_5h")

        constraints = constraints if constraints is not None else (state.get("day_constraints") or {})
        risk_flags = constraints.get("risk_flags") or []
        if isinstance(risk_flags, list):
            lowered = {str(f).lower() for f in risk_flags}
            if "low_recovery" in lowered:
                triggers.append("low_recovery")
            if "burnout_risk" in lowered:
                triggers.append("burnout_risk")

        if recovery_energy_cap_required(state.get("active_patterns") or []):
            triggers.append("high_severity_recovery_pattern")
        return triggers

    def _effective_energy_mode(
        self,
        state: PipelineState,
        *,
        constraints: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Score-based energy mode, capped under recovery-safety / multi-day patterns."""
        base = self._get_energy_mode(state["overall_score"])
        mode = base
        # High-severity sleep/recovery patterns: hard cap at moderate (code, not prompt).
        if recovery_energy_cap_required(state.get("active_patterns") or []):
            mode = self._cap_energy_mode(mode, "moderate")
        # Legacy single-night / risk-flag safety: never allow high.
        elif self._safety_override_triggers(state, constraints=constraints):
            mode = self._cap_energy_mode(mode, "normal")
        return mode

    def _safety_override_payload(
        self,
        state: PipelineState,
        *,
        constraints: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        triggers = self._safety_override_triggers(state, constraints=constraints)
        if not triggers:
            return {}
        capped_to = "moderate" if "high_severity_recovery_pattern" in triggers else "normal"
        return {
            "active": True,
            "triggers": triggers,
            "energy_mode_capped_to": capped_to,
            "require_recovery_action": True,
            "banned_framing": list(self.BANNED_HIGH_ENERGY_PHRASES),
        }

    def _compute_multiday_context(self, user_id: str, for_date: str) -> Dict[str, Any]:
        """Layer A + B: validity → rolling aggregates → active_patterns.

        Rolling windows are consumed by pattern detectors (and attached onto
        pattern objects). They are not stored separately or dumped into prompts.
        """
        try:
            anchor = date.fromisoformat(for_date)
        except ValueError:
            return {"active_patterns": []}

        try:
            raw = fetch_recent_feature_matrix(
                self.client,
                user_id,
                as_of_date=anchor,
                lookback_days=max(DEFAULT_PATTERN_CONFIG.baseline_days, 30),
                features=KEY_FEATURES,
            )
        except Exception as exc:
            debug_log(f"[multiday] feature matrix unavailable: {exc}")
            return {"active_patterns": []}

        if raw is None or raw.empty:
            return {"active_patterns": []}

        valid = apply_day_validity(raw, require_overall_score=False)
        rolling = compute_rolling_aggregates(valid, features=KEY_FEATURES)
        patterns = detect_active_patterns(valid, config=DEFAULT_PATTERN_CONFIG, rolling=rolling)
        return {"active_patterns": patterns}

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

    CONFIDENCE_NOTE = (
        "Each baseline entry includes n_valid (days of history behind it). Scale claim strength to "
        "n_valid yourself, per feature, instead of treating every entry as equally reliable: "
        "n_valid < 4 -> describe `last` only as an absolute observation, no comparison. "
        "n_valid 4-6 -> comparison allowed but MUST be hedged ('early trend, still calibrating', "
        "'not enough days yet to call this a pattern'). n_valid >= 7 -> full baseline/z-score/"
        "volatility language, no hedge required. STALENESS: `last` is the most recent VALID reading, "
        "not necessarily from this window — before calling it 'last night'/'yesterday', confirm the "
        "matching raw bundle field is non-null this window (check the matching missingness.missing_* "
        "flag is false); if the raw field is null while `last` still has a value, that reading is "
        "stale from an earlier day — call it 'your last available reading', not 'last night'/'yesterday'."
    )

    def _slim_current_state(
        self,
        current_state: Dict[str, Any],
        *,
        fast_ready: Optional[bool] = None,
        trend_ready: bool = False,
        always_visible: bool = False,
    ) -> Dict[str, Any]:
        """Slim auditable state.

        Default (always_visible=False): binary gate — baseline/z/volatility omitted until
        fast_ready, with a hedged early_trend digest once trend_ready. Used by agents that only
        emit structured fields (e.g. the action generator), where a hard floor is the simpler
        contract.

        always_visible=True: baselines/slopes/volatility are always included; each baseline entry
        carries n_valid and a confidence_note instructs the caller to scale claim strength to
        n_valid itself instead of code deciding visibility. Used by the holistic reporter, which
        is trusted to reason about data confidence directly (see CONFIDENCE SCALING in its prompt).
        """
        if always_visible:
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
                "confidence_note": self.CONFIDENCE_NOTE,
            })
        if fast_ready is False:
            if trend_ready:
                early_trend = self._build_early_trend_digest(current_state)
                note = (
                    "Baselines not ready (need ~7 valid days). Do NOT use z-scores, full baseline "
                    "comparisons, or volatility language. `early_trend` below has only "
                    f">= {self.TREND_READY_MIN_N_VALID} valid days per feature — mention it ONLY "
                    "with explicit hedge language ('early trend, still calibrating', 'not enough "
                    "days yet to call this a pattern'), never as a settled baseline comparison."
                )
            else:
                early_trend = {}
                note = (
                    "Baselines not ready (need ~7 valid days). "
                    "Do NOT use z-scores, baseline comparisons, or volatility language."
                )
            return self._omit_empty({
                "as_of_date": current_state.get("as_of_date"),
                "baseline_ready": False,
                "learning_mode": True,
                "trend_ready": trend_ready,
                "learning_mode_note": note,
                "early_trend": early_trend or None,
                "episodic_memory": self._slim_episodic_memory(current_state.get("episodic_memory")),
            })
        volatility = current_state.get("volatility") if isinstance(current_state.get("volatility"), dict) else {}
        global_vol = volatility.get("global") if isinstance(volatility.get("global"), dict) else {}
        return self._omit_empty({
            "as_of_date": current_state.get("as_of_date"),
            "baseline_ready": True if fast_ready else None,
            "baselines": self._slim_baselines(current_state.get("baselines")),
            "slopes": self._slim_slopes(current_state.get("slopes")),
            "volatility": {"global": global_vol} if global_vol else None,
            "uncertainty": current_state.get("uncertainty"),
            "episodic_memory": self._slim_episodic_memory(current_state.get("episodic_memory")),
            "residual_signature": self._slim_residual(current_state.get("residual_signature")),
        })

    def _slim_recent_history(
        self,
        history: List[Dict[str, Any]],
        *,
        fast_ready: bool = True,
    ) -> List[Dict[str, Any]]:
        slim_rows: List[Dict[str, Any]] = []
        for row in history[:7]:
            if not isinstance(row, dict):
                continue
            slim_dev = None
            if fast_ready:
                deviations = row.get("deviations_json") if isinstance(row.get("deviations_json"), dict) else {}
                top_trends = deviations.get("top_trends") or []
                top_anomalies = deviations.get("top_anomalies") or []
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
        """
        Slim behavior profile for LLM prompts AND agent_runs1.input_json.

        Always returns an auditable object (never silently omit the key upstream):
        - present=false when no injectable v2 profile
        - profile_id / window / os_tiers_meaningful when available
        - content fields when present
        """
        profile = profile or {}
        version = str(profile.get("profile_version") or "").strip() or None

        # Never inject legacy v1 profiles into coach prompts; still record exclusion.
        if version and version not in {"cluster_profile_v2", "none"}:
            return {
                "present": False,
                "source": "user_behavior_profiles1",
                "excluded": True,
                "exclude_reason": "legacy_profile_version",
                "profile_version": version,
                "profile_id": profile.get("profile_id") or None,
            }

        rule = profile.get("primary_coaching_rule")
        if isinstance(rule, str):
            rule = rule.strip() or None
        elif rule is not None:
            rule = None

        summary = profile.get("summary")
        if isinstance(summary, str):
            summary = summary.strip() or None
        else:
            summary = None

        cluster_interpretations: Optional[Dict[str, Any]] = None
        if include_clusters:
            raw = profile.get("cluster_interpretations") or {}
            if isinstance(raw, dict) and raw:
                flattened: Dict[str, Any] = {}
                for key in ("cluster_0", "cluster_1", "cluster_2"):
                    entry = raw.get(key)
                    if isinstance(entry, dict):
                        flattened[key] = {
                            "status": entry.get("status"),
                            "n_days": entry.get("n_days"),
                            "text": entry.get("text"),
                        }
                    elif isinstance(entry, str) and entry.strip():
                        flattened[key] = entry.strip()
                cluster_interpretations = flattened or None

        present = bool(
            version == "cluster_profile_v2"
            and (
                summary
                or rule
                or cluster_interpretations
                or profile.get("profile_id")
            )
        )

        slim: Dict[str, Any] = {
            "present": present,
            "source": "user_behavior_profiles1",
            "profile_id": profile.get("profile_id") or None,
            "profile_version": version,
            "data_window_start": profile.get("data_window_start") or None,
            "data_window_end": profile.get("data_window_end") or None,
            "days_used": profile.get("days_used"),
            "os_tiers_meaningful": profile.get("os_tiers_meaningful"),
            "validator_source": profile.get("validator_source") or None,
            "summary": summary,
            "primary_coaching_rule": rule,
        }
        if include_clusters:
            slim["cluster_interpretations"] = cluster_interpretations

        content = self._omit_empty(
            {k: v for k, v in slim.items() if k not in {"present", "source"}}
        )
        return {
            "present": present,
            "source": "user_behavior_profiles1",
            **content,
        }

    def _behavior_profile_evidence_refs(
        self, state: PipelineState
    ) -> Dict[str, Any]:
        """Compact provenance for agent_runs1.evidence_refs_json."""
        profile = state.get("behavior_profile") or {}
        version = str(profile.get("profile_version") or "").strip()
        profile_id = profile.get("profile_id")
        has_content = bool(
            profile_id
            or profile.get("summary")
            or profile.get("primary_coaching_rule")
            or profile.get("cluster_interpretations")
        )
        if version and version not in {"cluster_profile_v2", "none"}:
            return {
                "behavior_profile": {
                    "present": False,
                    "source": "user_behavior_profiles1",
                    "excluded": True,
                    "exclude_reason": "legacy_profile_version",
                    "profile_version": version,
                    "profile_id": profile_id,
                }
            }
        if not has_content or version != "cluster_profile_v2":
            return {
                "behavior_profile": {
                    "present": False,
                    "source": "user_behavior_profiles1",
                }
            }
        return {
            "behavior_profile": {
                "present": True,
                "source": "user_behavior_profiles1",
                "profile_id": profile_id,
                "profile_version": version,
                "data_window_start": profile.get("data_window_start") or None,
                "data_window_end": profile.get("data_window_end") or None,
                "days_used": profile.get("days_used"),
                "os_tiers_meaningful": profile.get("os_tiers_meaningful"),
                "validator_source": profile.get("validator_source") or None,
            }
        }

    def _slim_correlation_archetype(
        self,
        archetype: Optional[Dict[str, Any]],
        *,
        include_correlations: bool = True,
    ) -> Dict[str, Any]:
        """
        Slim correlation archetype for LLM prompts AND agent_runs1.input_json.

        Always returns an auditable object (never silently omit the key upstream):
        - present=false when no active archetype
        - archetype_id / window metadata when available
        - content fields when present
        """
        archetype = archetype or {}
        title = (archetype.get("archetype_title") or "").strip() or None
        summary = (archetype.get("summary") or "").strip() or None
        rule = (archetype.get("primary_coaching_rule") or "").strip() or None
        keys = archetype.get("key_correlations") or []
        if not isinstance(keys, list):
            keys = []

        present = bool(
            title
            or summary
            or rule
            or keys
            or archetype.get("archetype_id")
        )

        slim: Dict[str, Any] = {
            "present": present,
            "source": "user_correlation_archetypes1",
            "archetype_id": archetype.get("archetype_id") or None,
            "profile_version": archetype.get("profile_version") or None,
            "data_window_start": archetype.get("data_window_start") or None,
            "data_window_end": archetype.get("data_window_end") or None,
            "days_used": archetype.get("days_used"),
            "archetype_title": title,
            "summary": summary,
            "primary_coaching_rule": rule,
        }
        if include_correlations:
            slim["core_insight"] = (archetype.get("core_insight") or "").strip() or None
            slim["strength"] = (archetype.get("strength") or "").strip() or None
            if keys:
                slim["key_correlations"] = keys[:6]

        # Drop null/empty content fields but keep audit anchors.
        content = self._omit_empty(
            {k: v for k, v in slim.items() if k not in {"present", "source"}}
        )
        return {
            "present": present,
            "source": "user_correlation_archetypes1",
            **content,
        }

    def _correlation_archetype_evidence_refs(
        self, state: PipelineState
    ) -> Dict[str, Any]:
        """Compact provenance for agent_runs1.evidence_refs_json."""
        archetype = state.get("correlation_archetype") or {}
        archetype_id = archetype.get("archetype_id")
        if not archetype_id and not (
            archetype.get("archetype_title") or archetype.get("summary")
        ):
            return {
                "correlation_archetype": {
                    "present": False,
                    "source": "user_correlation_archetypes1",
                }
            }
        return {
            "correlation_archetype": {
                "present": True,
                "source": "user_correlation_archetypes1",
                "archetype_id": archetype_id,
                "archetype_title": archetype.get("archetype_title") or None,
                "data_window_start": archetype.get("data_window_start") or None,
                "data_window_end": archetype.get("data_window_end") or None,
                "days_used": archetype.get("days_used"),
            }
        }

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
        """Compact signals for constraints builder (no full bundle).

        Explicit as_of labels prevent treating yesterday check-in as today's feeling.
        """
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
            "timing_note": (
                "overall_score/energy_mode = THIS MORNING only. "
                "sleep_last_night = LAST NIGHT. "
                "All other pack fields = YESTERDAY (source_local_date). "
                "Never call yesterday check-in energy/focus/stress 'today'."
            ),
            "sleep_last_night": self._pick(
                sleep,
                ["sleep_duration_hours", "sleep_efficiency", "wake_ratio_pct"],
            ),
            "recovery_last_night": self._omit_empty({
                **self._pick(hrv, ["hrv_daily_rmssd", "hrv_deep_rmssd"]),
                **self._pick(activity, ["resting_heart_rate"]),
                **self._pick(overnight, ["spo2_avg", "skin_temp_relative"]),
            }),
            "activity_yesterday": self._pick(
                activity,
                ["steps", "mvpa_minutes", "sedentary_minutes", "total_active_minutes"],
            ),
            "checkin_yesterday": self._pick(
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
            "nutrition_yesterday": self._omit_empty({
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
            "journal_yesterday": self._omit_empty({
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

    def _build_constraints_state_digest(
        self,
        current_state: Dict[str, Any],
        *,
        fast_ready: bool,
        trend_ready: bool = False,
    ) -> Dict[str, Any]:
        """State digest for constraints. Baseline/z/volatility only when fast_ready."""
        if not fast_ready:
            if trend_ready:
                early_trend = self._build_early_trend_digest(current_state)
                note = (
                    "Baselines not ready (need ~7 valid days). "
                    "Do NOT use z-scores, baseline comparisons, or volatility language. "
                    "Do not emit risk_flags that depend on baseline deviation (e.g. volatility). "
                    f"`early_trend` below has only >= {self.TREND_READY_MIN_N_VALID} valid days per "
                    "feature — treat as a hedged early signal only, never a settled baseline."
                )
            else:
                early_trend = {}
                note = (
                    "Baselines not ready (need ~7 valid days). "
                    "Do NOT use z-scores, baseline comparisons, or volatility language. "
                    "Do not emit risk_flags that depend on baseline deviation (e.g. volatility)."
                )
            return self._omit_empty({
                "as_of_date": current_state.get("as_of_date"),
                "baseline_ready": False,
                "learning_mode": True,
                "trend_ready": trend_ready,
                "learning_mode_note": note,
                "early_trend": early_trend or None,
                "episodic_memory": self._slim_episodic_memory(current_state.get("episodic_memory")),
            })

        volatility = current_state.get("volatility") if isinstance(current_state.get("volatility"), dict) else {}
        global_vol = volatility.get("global") if isinstance(volatility.get("global"), dict) else {}
        return self._omit_empty({
            "as_of_date": current_state.get("as_of_date"),
            "baseline_ready": True,
            "top_deviations": self._top_baseline_deviations(current_state.get("baselines")),
            "slopes": self._constraint_slopes(current_state.get("slopes")),
            "volatility": {"global": global_vol} if global_vol else None,
            "uncertainty": current_state.get("uncertainty"),
            "episodic_memory": self._slim_episodic_memory(current_state.get("episodic_memory")),
            "residual_signature": self._slim_residual(current_state.get("residual_signature")),
        })

    def _build_holistic_agent_inputs(self, state: PipelineState) -> Dict[str, Any]:
        """Slim status-only inputs for holistic reporter (goals intentionally excluded).

        current_state uses always_visible=True: baselines are never hidden by a fast_ready
        cliff here — the reporter is trusted to scale claim strength to each feature's
        n_valid itself (see CONFIDENCE SCALING in HOLISTIC_STATUS_REPORTER_SYSTEM_PROMPT).
        fast_ready is still used for recent_state_history's deviation rows (a narrower,
        upstream-computed signal, not part of this scoped change) and for behavior-profile /
        correlation-archetype clustering readiness (slow_ready), which are unrelated gates.
        """
        readiness_src = state.get("coach_readiness") or {}
        fast_ready = self._is_fast_ready(state)
        return {
            "overall_score": state["overall_score"],
            "input_bundle": self._slim_input_bundle(state.get("input_bundle") or {}),
            "current_state": self._slim_current_state(
                state.get("current_state") or {},
                always_visible=True,
            ),
            "recent_state_history": self._slim_recent_history(
                state.get("recent_state_history") or [],
                fast_ready=fast_ready,
            ),
            "coach_readiness": {
                "slow_ready": bool(readiness_src.get("slow_ready")),
            },
            "behavior_profile": self._slim_behavior_profile(
                state.get("behavior_profile") or {}
            ),
            "correlation_archetype": self._slim_correlation_archetype(
                state.get("correlation_archetype") or {}
            ),
            "previous_morning_brief": state.get("previous_morning_brief") or {"present": False},
        }

    def _build_constraints_agent_inputs(self, state: PipelineState) -> Dict[str, Any]:
        """Compact inputs for constraints builder."""
        bundle = state.get("input_bundle") or {}
        fast_ready = self._is_fast_ready(state)
        trend_ready = False if fast_ready else self._is_trend_ready(state)
        energy_mode = self._effective_energy_mode(state)
        return {
            "overall_score": state["overall_score"],
            "energy_mode": energy_mode,
            "learning_mode": not fast_ready,
            "trend_ready": trend_ready,
            "safety_override": self._safety_override_payload(state) or None,
            "user_goal": self._slim_user_goal(state.get("user_goal"), mode="constraints"),
            "signal_pack": self._build_constraint_signal_pack(bundle),
            "state_digest": self._build_constraints_state_digest(
                state.get("current_state") or {},
                fast_ready=fast_ready,
                trend_ready=trend_ready,
            ),
            "behavior_profile": self._slim_behavior_profile(
                state.get("behavior_profile") or {},
                include_clusters=False,
            ),
            "correlation_archetype": self._slim_correlation_archetype(
                state.get("correlation_archetype") or {},
                include_correlations=False,
            ),
            "previous_morning_brief": state.get("previous_morning_brief") or {"present": False},
            "active_patterns": list(state.get("active_patterns") or []),
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

    def _slim_coach_readiness_with_coverage(
        self,
        readiness: Optional[Dict[str, Any]],
        *,
        fast_ready: Optional[bool] = None,
        trend_ready: bool = False,
    ) -> Dict[str, Any]:
        """Baseline flags + signal coverage (for agents that do not receive the bundle)."""
        readiness = readiness or {}
        ready = bool(readiness.get("fast_ready")) if fast_ready is None else bool(fast_ready)
        return self._omit_empty({
            "fast_ready": ready,
            "slow_ready": bool(readiness.get("slow_ready")),
            "learning_mode": not ready,
            "trend_ready": False if ready else trend_ready,
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

    def _slim_recent_deviations(
        self,
        history: List[Dict[str, Any]],
        *,
        fast_ready: bool = True,
    ) -> List[Dict[str, Any]]:
        if not fast_ready:
            return []
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
        fast_ready = self._is_fast_ready(state)
        recent_deviations = self._slim_recent_deviations(
            state.get("recent_state_history") or [],
            fast_ready=fast_ready,
        )
        payload = {
            "energy_mode": self._effective_energy_mode(state),
            "learning_mode": not fast_ready,
            "safety_override": self._safety_override_payload(state) or None,
            "user_goal": user_goal,
            "primary_domains": goal_spec.get("primary_domains") or [],
            "secondary_domains": goal_spec.get("secondary_domains") or [],
            "day_constraints": self._slim_day_constraints(state.get("day_constraints")),
            "holistic_status_report": self._slim_holistic_for_router(
                state.get("holistic_status_report")
            ),
            "coach_readiness": self._slim_coach_readiness_with_coverage(
                state.get("coach_readiness"),
                fast_ready=fast_ready,
            ),
            "behavior_profile": self._slim_behavior_profile(
                state.get("behavior_profile") or {},
                include_clusters=True,
            ),
            "correlation_archetype": self._slim_correlation_archetype(
                state.get("correlation_archetype") or {}
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
        feedback_only: bool = False,
    ) -> List[Dict[str, Any]]:
        """Keep enough to avoid repeats without full action payloads (≤7 days upstream).

        When feedback_only=True, keep only rows that have a user rating, comment, or completion.
        """
        slim_rows: List[Dict[str, Any]] = []
        for row in (history or []):
            if not isinstance(row, dict):
                continue
            has_feedback = bool(
                row.get("user_rating_num") is not None
                or row.get("user_comment")
                or row.get("user_completed")
            )
            if feedback_only and not has_feedback:
                continue
            reason = row.get("reason") or row.get("rationale") or ""
            if isinstance(reason, str) and len(reason) > 100:
                reason = reason[:100]
            desc = row.get("description") or ""
            if isinstance(desc, str) and len(desc) > 100:
                desc = desc[:100]
            comment = row.get("user_comment") or ""
            if isinstance(comment, str) and len(comment) > 160:
                comment = comment[:160] + "…"
            slim_rows.append(self._omit_empty({
                "for_date": row.get("for_date"),
                "action_id": row.get("action_id"),
                "domain": row.get("domain"),
                "title": row.get("title"),
                "description": desc or None,
                "priority": row.get("priority"),
                "reason": reason or None,
                "user_completed": True if row.get("user_completed") else None,
                "user_rating_num": row.get("user_rating_num"),
                "user_rating_text": row.get("user_rating_text"),
                "user_comment": comment or None,
                "rating_scale": row.get("rating_scale"),
            }))
            if len(slim_rows) >= limit:
                break
        return slim_rows

    def _build_action_generator_agent_inputs(self, state: PipelineState) -> Dict[str, Any]:
        """Slim inputs for action candidate generator."""
        user_goal = self._slim_user_goal(state.get("user_goal"))
        goal_spec = user_goal.get("goal_spec") if isinstance(user_goal.get("goal_spec"), dict) else {}
        slim_bundle = self._slim_input_bundle(state.get("input_bundle") or {})
        nutrition = slim_bundle.get("nutrition") if isinstance(slim_bundle.get("nutrition"), dict) else {}
        meal_context = nutrition.get("meal_context") if isinstance(nutrition.get("meal_context"), dict) else {}
        readiness_src = state.get("coach_readiness") or {}
        fast_ready = self._is_fast_ready(state)
        return {
            "overall_score": state["overall_score"],
            "energy_mode": self._effective_energy_mode(state),
            "learning_mode": not fast_ready,
            "safety_override": self._safety_override_payload(state) or None,
            "selected_domains": state.get("selected_domains") or [],
            "goal_domains": goal_spec.get("primary_domains") or [],
            "user_goal": user_goal,
            "day_constraints": self._slim_day_constraints(state.get("day_constraints")),
            "holistic_status_report": self._slim_holistic_status_report(
                state.get("holistic_status_report")
            ),
            "input_bundle": slim_bundle,
            "meal_context": meal_context,
            "current_state": self._slim_current_state(
                state.get("current_state") or {},
                fast_ready=fast_ready,
            ),
            "recent_state_history": self._slim_recent_history(
                state.get("recent_state_history") or [],
                fast_ready=fast_ready,
            )[:5],
            "recent_action_history": self._slim_recent_action_history(
                state.get("recent_action_history")
            ),
            "coach_readiness": {
                "fast_ready": fast_ready,
                "slow_ready": bool(readiness_src.get("slow_ready")),
                "learning_mode": not fast_ready,
            },
            "behavior_profile": self._slim_behavior_profile(
                state.get("behavior_profile") or {}
            ),
            "correlation_archetype": self._slim_correlation_archetype(
                state.get("correlation_archetype") or {}
            ),
            "previous_morning_brief": state.get("previous_morning_brief") or {"present": False},
            "active_patterns": list(state.get("active_patterns") or []),
            "regen_feedback": (
                (state.get("review_result") or {}).get("regen_feedback")
                if int(state.get("attempt") or 0) > 0
                else None
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
                "max_displayed_actions": 4,
                "hard_cap": 6,
                "min_valid": 4,
            },
            "recent_action_history": self._slim_recent_action_history(
                state.get("recent_action_history")
            ),
            "overall_score": state.get("overall_score"),
            "active_patterns": list(state.get("active_patterns") or []),
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
        fast_ready = self._is_fast_ready(state)
        trend_ready = False if fast_ready else self._is_trend_ready(state)
        safety = self._safety_override_payload(state)
        return {
            "user_name": state.get("user_name") or None,
            "energy_mode": self._effective_energy_mode(state),
            "overall_score": state["overall_score"],
            "selected_domains": state.get("selected_domains") or [],
            "learning_mode": not fast_ready,
            "trend_ready": trend_ready,
            "safety_override": safety or None,
            "coach_readiness": self._slim_coach_readiness_with_coverage(
                state.get("coach_readiness"),
                fast_ready=fast_ready,
                trend_ready=trend_ready,
            ),
            "holistic_status_report": self._slim_holistic_status_report(
                state.get("holistic_status_report")
            ),
            "display_actions": [
                self._slim_display_action_for_brief(a)
                for a in display_actions
                if isinstance(a, dict)
            ],
            "recent_action_history": self._slim_recent_action_history(
                state.get("recent_action_history"),
                limit=10,
                feedback_only=True,
            ),
            "previous_morning_brief": state.get("previous_morning_brief") or {"present": False},
            "active_patterns": list(state.get("active_patterns") or []),
        }

    def _extract_recent_action_memory(
        self,
        recent_state_history: List[Dict[str, Any]],
        *,
        for_date: str,
        lookback_days: int = 7,
        ratings_by_key: Optional[Dict[tuple, Dict[str, Any]]] = None,
    ) -> List[Dict[str, Any]]:
        """Flatten generated actions from the last `lookback_days` for deduplication/variety.

        Merges user ratings/comments from action_user_ratings1 when provided.
        """
        try:
            anchor = date.fromisoformat(for_date)
        except ValueError:
            anchor = date.today()
        cutoff = anchor - timedelta(days=lookback_days)
        ratings_by_key = ratings_by_key or {}

        flattened: List[Dict[str, Any]] = []
        seen_keys = set()
        for row in recent_state_history:
            row_date_raw = row.get('date')
            try:
                row_date = date.fromisoformat(str(row_date_raw)[:10]) if row_date_raw else None
            except ValueError:
                row_date = None
            if row_date is None or row_date < cutoff or row_date >= anchor:
                continue

            actions_payload = row.get('actions_generated_json') or {}
            actions = actions_payload.get('actions', []) if isinstance(actions_payload, dict) else []
            if not isinstance(actions, list):
                continue

            for action in actions:
                if not isinstance(action, dict):
                    continue
                action_id = action.get('action_id')
                for_date_str = str(row.get('date') or row_date.isoformat())[:10]
                key = (for_date_str, str(action_id or ''))
                rating = ratings_by_key.get(key) or {}
                completed_raw = action.get('user_completed_at')
                user_completed = bool(
                    isinstance(completed_raw, str) and completed_raw.strip()
                )
                entry = {
                    'for_date': for_date_str,
                    'action_id': action_id,
                    'title': action.get('title'),
                    'description': action.get('description'),
                    'domain': action.get('domain'),
                    'priority': action.get('priority'),
                    'reason': action.get('rationale') or action.get('reason') or '',
                    'user_completed': user_completed,
                }
                if rating:
                    if rating.get('rating_value_num') is not None:
                        entry['user_rating_num'] = rating.get('rating_value_num')
                    if rating.get('rating_value_text'):
                        entry['user_rating_text'] = rating.get('rating_value_text')
                    if rating.get('comment'):
                        entry['user_comment'] = rating.get('comment')
                    if rating.get('rating_scale'):
                        entry['rating_scale'] = rating.get('rating_scale')
                flattened.append(entry)
                if action_id:
                    seen_keys.add(key)

        # Include ratings that exist without a matching generated-action row
        # (e.g. safety fallback actions persisted only to plan_actions1).
        for key, rating in ratings_by_key.items():
            if key in seen_keys:
                continue
            for_date_str, action_id = key
            try:
                rating_date = date.fromisoformat(for_date_str)
            except ValueError:
                continue
            if rating_date < cutoff or rating_date >= anchor:
                continue
            flattened.append({
                'for_date': for_date_str,
                'action_id': action_id or None,
                'title': rating.get('action_title') or action_id,
                'description': None,
                'domain': rating.get('domain'),
                'priority': None,
                'reason': '',
                'user_completed': False,
                'user_rating_num': rating.get('rating_value_num'),
                'user_rating_text': rating.get('rating_value_text'),
                'user_comment': rating.get('comment'),
                'rating_scale': rating.get('rating_scale'),
            })
        return flattened

    def _fetch_recent_action_ratings(
        self,
        user_id: str,
        for_date: str,
        *,
        lookback_days: int = 7,
    ) -> Dict[tuple, Dict[str, Any]]:
        """Load user ratings/comments from action_user_ratings1 for the lookback window."""
        try:
            anchor = date.fromisoformat(for_date)
        except ValueError:
            return {}
        cutoff = (anchor - timedelta(days=lookback_days)).isoformat()
        try:
            response = (
                self.client.table("action_user_ratings1")
                .select(
                    "for_date, action_id, plan_action_id, rating_scale, "
                    "rating_value_num, rating_value_text, comment, provided_at"
                )
                .eq("user_id", user_id)
                .gte("for_date", cutoff)
                .lt("for_date", for_date)
                .order("provided_at", desc=True)
                .execute()
            )
        except Exception as exc:
            debug_log(f"[fetch_data] action_user_ratings1 unavailable: {exc}")
            return {}

        by_key: Dict[tuple, Dict[str, Any]] = {}
        for row in response.data or []:
            if not isinstance(row, dict):
                continue
            for_date_str = str(row.get("for_date") or "")[:10]
            action_id = str(row.get("action_id") or "").strip()
            if not for_date_str or not action_id:
                continue
            key = (for_date_str, action_id)
            # Keep newest rating per (date, action_id)
            if key in by_key:
                continue
            comment = row.get("comment")
            if isinstance(comment, str):
                comment = comment.strip()[:2000] or None
            rating_num = row.get("rating_value_num")
            try:
                rating_num = float(rating_num) if rating_num is not None else None
            except (TypeError, ValueError):
                rating_num = None
            by_key[key] = {
                "rating_scale": row.get("rating_scale"),
                "rating_value_num": rating_num,
                "rating_value_text": row.get("rating_value_text"),
                "comment": comment,
                "provided_at": row.get("provided_at"),
                "plan_action_id": row.get("plan_action_id"),
            }
        return by_key

    def _fetch_previous_morning_brief(self, user_id: str, for_date: str) -> Dict[str, Any]:
        """Load yesterday's morning_message for anti-repetition (best-effort)."""
        try:
            prev_date = (date.fromisoformat(for_date) - timedelta(days=1)).isoformat()
            response = (
                self.client.table("daily_plans1")
                .select("for_date, morning_message, selected_domains_json")
                .eq("user_id", user_id)
                .eq("for_date", prev_date)
                .limit(1)
                .execute()
            )
            rows = response.data or []
            if not rows:
                return {"present": False, "source": "daily_plans1"}
            row = rows[0]
            message = str(row.get("morning_message") or "").strip()
            if not message:
                return {"present": False, "source": "daily_plans1", "for_date": prev_date}
            max_chars = 1200
            truncated = len(message) > max_chars
            return {
                "present": True,
                "source": "daily_plans1",
                "for_date": row.get("for_date") or prev_date,
                "morning_message": message[:max_chars] + ("…" if truncated else ""),
                "truncated": truncated,
                "selected_domains": row.get("selected_domains_json") or [],
            }
        except Exception as exc:
            debug_log(f"[fetch_data] previous morning brief unavailable: {exc}")
            return {"present": False, "source": "daily_plans1"}
    
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
        ratings_by_key = self._fetch_recent_action_ratings(
            state['user_id'],
            state['for_date'],
            lookback_days=7,
        )
        state['recent_action_history'] = self._extract_recent_action_memory(
            recent_state_history,
            for_date=state['for_date'],
            lookback_days=7,
            ratings_by_key=ratings_by_key,
        )
        state['coach_readiness'] = {
            'fast_ready': bool(baseline_flags.get('fast_ready')),
            'slow_ready': bool(baseline_flags.get('slow_ready')),
            'bundle_missingness': input_bundle.get('missingness_json') or {},
            'bundle_confidence': input_bundle.get('confidence_json') or {},
        }
        state['behavior_profile'] = {}
        try:
            profile_row = get_latest_active_profile(self.client, state['user_id'])
            payload = profile_payload_from_row(profile_row)
            if profile_row:
                # Provenance for agent_runs1.input_json / evidence_refs_json
                payload["profile_id"] = profile_row.get("profile_id")
                payload["data_window_start"] = profile_row.get("data_window_start")
                payload["data_window_end"] = profile_row.get("data_window_end")
                payload["days_used"] = profile_row.get("days_used")
                meta = profile_row.get("clustering_metadata_json") or {}
                if isinstance(meta, dict):
                    if "os_tiers_meaningful" in meta:
                        payload["os_tiers_meaningful"] = meta.get("os_tiers_meaningful")
                    validator = meta.get("validator") or {}
                    if isinstance(validator, dict) and validator.get("source"):
                        payload["validator_source"] = validator.get("source")
                payload["profile_version"] = (
                    payload.get("profile_version")
                    or profile_row.get("profile_version")
                )
            state['behavior_profile'] = payload
        except Exception as exc:
            debug_log(f"[fetch_data] behavior profile unavailable: {exc}")
            state['behavior_profile'] = {}
        try:
            archetype_row = get_latest_active_archetype(self.client, state['user_id'])
            payload = archetype_payload_from_row(archetype_row)
            if archetype_row:
                # Provenance for agent_runs1.input_json / evidence_refs_json
                payload["archetype_id"] = archetype_row.get("archetype_id")
                payload["data_window_start"] = archetype_row.get("data_window_start")
                payload["data_window_end"] = archetype_row.get("data_window_end")
                payload["days_used"] = archetype_row.get("days_used")
                payload["profile_version"] = (
                    payload.get("profile_version")
                    or archetype_row.get("profile_version")
                )
            state['correlation_archetype'] = payload
        except Exception as exc:
            debug_log(f"[fetch_data] correlation archetype unavailable: {exc}")
            state['correlation_archetype'] = {}
        state['previous_morning_brief'] = self._fetch_previous_morning_brief(
            state['user_id'],
            state['for_date'],
        )
        multiday = self._compute_multiday_context(state['user_id'], state['for_date'])
        state['active_patterns'] = multiday.get('active_patterns') or []
        if state['active_patterns']:
            debug_log(
                f"[multiday] active_patterns={json.dumps(state['active_patterns'])}"
            )
        return state
    
    def node_holistic_status_report(self, state: PipelineState) -> PipelineState:
        """Holistic Status Reporter using prepared bundle + auditable state."""
        from llm.prompts import HOLISTIC_STATUS_REPORTER_SYSTEM_PROMPT

        started_at = datetime.utcnow()
        holistic_inputs = self._build_holistic_agent_inputs(state)

        user_prompt = f"""Overall score today: {holistic_inputs['overall_score']}

Prepared daily input bundle (slimmed status signals; yesterday / last night):
{json.dumps(holistic_inputs['input_bundle'], indent=2)}

Current auditable state (baselines as last/baseline/z_fast + n_valid per feature; slopes/volatility slimmed — see CONFIDENCE SCALING, nothing here is hidden, scale claim strength to n_valid yourself):
{json.dumps(holistic_inputs['current_state'], indent=2)}

Recent state history (most recent first; scores/deviations only when baselines ready):
{json.dumps(holistic_inputs['recent_state_history'], indent=2)}

Coach readiness (behavior-profile / correlation-archetype clustering stability only — unrelated to the per-feature confidence on the auditable state above):
{json.dumps(holistic_inputs['coach_readiness'], indent=2)}

Behavior profile:
{json.dumps(holistic_inputs['behavior_profile'], indent=2)}

Correlation archetype:
{json.dumps(holistic_inputs['correlation_archetype'], indent=2)}

Previous morning brief (yesterday — avoid repeating the same cross-domain narrative verbatim):
{json.dumps(holistic_inputs.get('previous_morning_brief') or {}, indent=2)}

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
        evidence_refs = {
            d: s.get('key_evidence', [])
            for d, s in {s['domain']: s for s in report.get('domain_summaries', [])}.items()
        }
        evidence_refs.update(self._behavior_profile_evidence_refs(state))
        evidence_refs.update(self._correlation_archetype_evidence_refs(state))
        self.logger.log_agent_run(
            ingestion_run_id=state['ingestion_run_id'],
            user_id=state['user_id'],
            for_date=date.fromisoformat(state['for_date']),
            agent_name='holistic_status_reporter',  # closest valid enum; report stored in output_json
            attempt=state.get('attempt', 0) + 100,
            status='success',
            input_json=holistic_inputs,
            output_json=report,
            evidence_refs_json=evidence_refs,
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
        energy_mode = self._effective_energy_mode(state)
        review = state.get("review_result") or {}
        accepted_ids = review.get("accepted_action_ids") or []
        accepted_actions = [
            a for a in (state.get("action_proposals") or [])
            if a.get("action_id") in accepted_ids
        ]

        budget_result = self.budget_enforcer.run(
            accepted_actions,
            energy_mode,
            state.get("day_constraints") or {},
        )
        budget_result = self._ensure_recovery_action_in_budget(state, budget_result, accepted_actions)
        state["budget_result"] = budget_result
        return state

    def _ensure_recovery_action_in_budget(
        self,
        state: PipelineState,
        budget_result: Dict[str, Any],
        accepted_actions: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """When safety override is active, guarantee ≥1 sleep/recovery/stress action displayed."""
        if not self._safety_override_triggers(state):
            return budget_result

        display = list(budget_result.get("display_actions") or [])
        if any(
            str(a.get("domain") or "").lower() in self.RECOVERY_DOMAINS
            for a in display
            if isinstance(a, dict)
        ):
            budget_result.setdefault("budget_applied", {})["safety_recovery_enforced"] = True
            return budget_result

        pool = list(accepted_actions) + list(state.get("action_proposals") or [])
        recovery_candidate = None
        seen_ids = set()
        for action in pool:
            if not isinstance(action, dict):
                continue
            aid = action.get("action_id")
            if aid in seen_ids:
                continue
            seen_ids.add(aid)
            if str(action.get("domain") or "").lower() in self.RECOVERY_DOMAINS:
                recovery_candidate = action
                break

        if recovery_candidate is None:
            # Deterministic fallback recovery action so the gate is never skipped.
            recovery_candidate = {
                "action_id": "safety_recovery_protect",
                "action_source": "generated",
                "tags": ["safety_override"],
                "title": "Protect recovery today",
                "description": (
                    "Keep today's load light: one short rest break and an earlier wind-down. "
                    "Prioritize sleep/recovery over pushing hard."
                ),
                "domain": "recovery",
                "when": "today",
                "priority": 1,
                "effort_level": "low",
                "rationale": "Safety override: short sleep and/or low recovery / burnout risk.",
                "evaluation_mode": "user_rating",
            }

        # Insert at front; drop last if at hard cap.
        hard_cap = getattr(self.budget_enforcer, "hard_cap", 6)
        display = [recovery_candidate] + [
            a for a in display
            if isinstance(a, dict) and a.get("action_id") != recovery_candidate.get("action_id")
        ]
        display = display[:hard_cap]
        budget_result["display_actions"] = display
        all_valid = list(budget_result.get("all_valid_actions") or [])
        if recovery_candidate.get("action_id") not in {
            a.get("action_id") for a in all_valid if isinstance(a, dict)
        }:
            all_valid = [recovery_candidate] + all_valid
        budget_result["all_valid_actions"] = all_valid
        applied = dict(budget_result.get("budget_applied") or {})
        applied["safety_recovery_enforced"] = True
        applied["energy_mode"] = self._effective_energy_mode(state)
        budget_result["budget_applied"] = applied
        return budget_result
    
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
        from llm.prompts import CONSTRAINTS_BUILDER_SYSTEM_PROMPT
        
        started_at = datetime.utcnow()
        constraints_inputs = self._build_constraints_agent_inputs(state)
        learning_line = (
            "LEARNING MODE: baselines not ready — do not cite z-scores, baselines, or volatility."
            if constraints_inputs.get("learning_mode")
            else "Baselines ready: state_digest may include deviations/slopes/volatility."
        )
        safety = constraints_inputs.get("safety_override") or {}
        safety_line = (
            f"SAFETY OVERRIDE ACTIVE (code-enforced): {json.dumps(safety)}. "
            "Keep energy_mode at normal or below; include recovery caution in hard/soft constraints."
            if safety
            else ""
        )
        user_prompt = f"""Energy mode (THIS MORNING from overall_score, may be safety-capped): {constraints_inputs['energy_mode']}
Overall score (THIS MORNING): {constraints_inputs['overall_score']}
{learning_line}
{safety_line}

User goal (statement/domains/constraint defaults only):
{json.dumps(constraints_inputs['user_goal'], indent=2)}

Constraint signal pack (explicitly labeled yesterday / last night — never call checkin_yesterday "today"):
{json.dumps(constraints_inputs['signal_pack'], indent=2)}

State digest:
{json.dumps(constraints_inputs['state_digest'], indent=2)}

Behavior profile (summary + coaching rule):
{json.dumps(constraints_inputs['behavior_profile'], indent=2)}

Correlation archetype (title + coaching rule):
{json.dumps(constraints_inputs['correlation_archetype'], indent=2)}

Active patterns (code-detected multi-day facts — use for risk_flags / energy caution; never invent streaks):
{json.dumps(constraints_inputs.get('active_patterns') or [], indent=2)}

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

        state['day_constraints'] = self._apply_deterministic_constraint_overrides(state, output)
        
        # Log agent run — persist the exact slimmed inputs sent to the LLM
        evidence_refs = dict((state['day_constraints'] or {}).get('evidence_used', {}) or {})
        evidence_refs.update(self._behavior_profile_evidence_refs(state))
        evidence_refs.update(self._correlation_archetype_evidence_refs(state))
        self.logger.log_agent_run(
            ingestion_run_id=state['ingestion_run_id'],
            user_id=state['user_id'],
            for_date=date.fromisoformat(state['for_date']),
            agent_name='constraints_builder',
            attempt=state.get('attempt', 0),
            status='success',
            input_json=constraints_inputs,
            output_json=state['day_constraints'],
            evidence_refs_json=evidence_refs,
            started_at=started_at,
            ended_at=datetime.utcnow()
        )
        
        return state
    
    def node_route_domains(self, state: PipelineState) -> PipelineState:
        """Domain Router LLM Agent"""
        from llm.prompts import DOMAIN_ROUTER_SYSTEM_PROMPT
        
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

Correlation archetype:
{json.dumps(router_inputs['correlation_archetype'], indent=2)}
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

        # Deterministic: high-severity patterns inject their mapped domain into the candidate set.
        injected = []
        existing = [str(d).lower() for d in (state.get("selected_domains") or [])]
        for domain in domains_for_high_patterns(state.get("active_patterns") or []):
            if domain not in existing:
                state.setdefault("selected_domains", []).append(domain)
                existing.append(domain)
                injected.append(domain)
        if injected:
            debug_log(f"[DOMAIN_ROUTER] injected high-pattern domains={injected}")
        
        # Log agent run — persist the exact slimmed inputs sent to the LLM
        evidence_refs = {
            d.get('domain'): d.get('evidence') for d in selected if isinstance(d, dict)
        }
        evidence_refs.update(self._behavior_profile_evidence_refs(state))
        evidence_refs.update(self._correlation_archetype_evidence_refs(state))
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
            evidence_refs_json=evidence_refs,
            started_at=started_at,
            ended_at=datetime.utcnow()
        )
        
        return state

    def node_generate_actions(self, state: PipelineState) -> PipelineState:
        """Action Generator LLM Agent"""
        from llm.prompts import ACTION_GENERATOR_SYSTEM_PROMPT

        started_at = datetime.utcnow()
        action_inputs = self._build_action_generator_agent_inputs(state)
        action_history_context = ""
        if action_inputs.get("recent_action_history"):
            action_history_context = (
                "\nRecent actions (last 7 days — do NOT repeat titles/anchors; vary levers):\n"
                f"{json.dumps(action_inputs['recent_action_history'], indent=2)}\n"
            )
        prev_brief_block = ""
        prev = action_inputs.get("previous_morning_brief") or {}
        if prev.get("present"):
            prev_brief_block = (
                "\nPrevious morning brief (yesterday — do not duplicate the same action themes):\n"
                f"{json.dumps(prev, indent=2)}\n"
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

Correlation archetype:
{json.dumps(action_inputs['correlation_archetype'], indent=2)}

Active patterns (code-detected multi-day facts — refer by day counts/values; never invent a streak):
{json.dumps(action_inputs.get('active_patterns') or [], indent=2)}
{prev_brief_block}{action_history_context}
"""
        regen_feedback = action_inputs.get("regen_feedback")
        if regen_feedback:
            user_prompt += (
                f"\nREGEN FEEDBACK (address these gaps this attempt):\n{regen_feedback}\n"
            )
        user_prompt += """Generate 5-6 **varied, realistic** actions (real focus/work blocks need enough time — no token 10–15 min work sessions unless energy is low).
Follow the rules: If selected and goal domains overlap, generate 4-5 actions for those domains.
 If different, generate at least 4 for selected domains and at least 1 (ideally 1-2) for the goal domain(s).
 State meal logging assumptions in `assumptions` when nutrition data is ambiguous.
 When high-severity active_patterns are present, include at least one action in the mapped pattern domain.
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
        evidence_refs = {}
        evidence_refs.update(self._behavior_profile_evidence_refs(state))
        evidence_refs.update(self._correlation_archetype_evidence_refs(state))
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
            evidence_refs_json=evidence_refs,
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
        from llm.prompts import FUSION_CRITIC_SYSTEM_PROMPT

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

Overall score this morning: {critic_inputs.get('overall_score')}

Recent action history (last 7 days — reject near-duplicates; reject token focus/work blocks under ~30 min when score >= 40):
{json.dumps(critic_inputs.get('recent_action_history') or [], indent=2)}

Active patterns (code-detected; high severity must be covered by ≥1 accepted action in the mapped domain):
{json.dumps(critic_inputs.get('active_patterns') or [], indent=2)}

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

        state['review_result'] = self._validate_and_normalize_review_result(
            review_result,
            state.get("action_proposals") or [],
            critic_inputs.get("selected_domains") or [],
            critic_inputs.get("goal_domains") or [],
            active_patterns=state.get("active_patterns") or [],
        )
        
        # Log agent run — persist the exact slimmed inputs sent to the LLM
        agent_run_id = self.logger.log_agent_run(
            ingestion_run_id=state['ingestion_run_id'],
            user_id=state['user_id'],
            for_date=date.fromisoformat(state['for_date']),
            agent_name='fusion_critic',
            attempt=state.get('attempt', 0),
            status='success',
            input_json=critic_inputs,
            output_json=state['review_result'],
            evidence_refs_json=state['review_result'].get('evidence_used', {}),
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
        from llm.prompts import MORNING_BRIEF_COMPOSER_SYSTEM_PROMPT

        started_at = datetime.utcnow()
        brief_inputs = self._build_morning_brief_agent_inputs(state)

        user_name = brief_inputs.get("user_name")
        user_name_line = (
            f"- User name: {user_name}" if user_name else "- User name: not available"
        )
        # Note: baseline language is no longer gated by this flat flag — the holistic report now
        # scales its own baseline claims per feature (see CONFIDENCE SCALING in its prompt), so it
        # may legitimately include full baseline language for some features even while this
        # aggregate signal is true. This line only covers the word-length exception below, which is
        # a genuinely separate, coarser judgment (is there enough shared history yet to trust a
        # "story unchanged vs previous_morning_brief" comparison).
        learning_line = ""
        if brief_inputs.get("learning_mode"):
            learning_line = (
                "- EARLY DAYS (aggregate signal, not a per-feature baseline gate): there isn't yet "
                "enough shared history to trust a 'story unchanged vs previous_morning_brief' "
                "judgment, so always use the full 260-340 word target regardless of similarity. "
                "This has no bearing on which baseline claims are safe to use — trust the holistic "
                "report's own hedging for that (see BASELINE LANGUAGE in the system prompt)."
            )
        safety = brief_inputs.get("safety_override") or {}
        safety_line = (
            f"- SAFETY OVERRIDE ACTIVE: {json.dumps(safety)}. "
            "Do NOT use harness-your-energy framing. Emphasize recovery/protection."
            if safety
            else ""
        )

        user_prompt = f"""Today's situation:
- Energy mode: {brief_inputs['energy_mode']}
- Overall score: {brief_inputs['overall_score']}
- Selected domains: {', '.join(brief_inputs['selected_domains'])}
- Coach readiness / signal coverage (goal fields removed): {json.dumps(brief_inputs['coach_readiness'], indent=2)}
{user_name_line}
{learning_line}
{safety_line}

Holistic status report:
{json.dumps(brief_inputs['holistic_status_report'], indent=2)}

Display actions (title/description/rationale/when only — UI renders details):
{json.dumps(brief_inputs['display_actions'], indent=2)}

Previous morning brief (yesterday — if today's story is largely the same, write a SHORTER brief; do not repeat the same connecting-the-dots analysis):
{json.dumps(brief_inputs.get('previous_morning_brief') or {}, indent=2)}

Recent user action feedback (ratings/comments/completions from the last 7 days — use lightly for continuity; do not invent feedback; do not list today's actions):
{json.dumps(brief_inputs.get('recent_action_history') or [], indent=2)}

Active patterns (code-detected multi-day facts — name real streaks by day count when present; never invent):
{json.dumps(brief_inputs.get('active_patterns') or [], indent=2)}

Write a personal morning note. Length: 180–240 words if yesterday's brief covers the same core pattern; 260–340 words if the story changed materially — use the room for real depth, not padding. {"Always use the full 260-340 word target — LEARNING MODE means there is not yet enough history to reliably judge 'story unchanged.' " if brief_inputs.get("learning_mode") else ""}Make it easy to read: short paragraphs with blank lines between them, bold on key numbers/takeaways, and (only if you have 3+ parallel numbers in one place) a short bullet list — see READABILITY / DESIGN in the system prompt. State your meal logging vs skipped assumption when nutrition was incomplete. Do not list today's actions (UI shows them separately).
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
        
        message = output.get("morning_message") if isinstance(output, dict) else ""
        if not isinstance(message, str) or not message.strip():
            raise ValueError("morning_brief_composer returned empty morning_message")
        state["morning_message"] = self._sanitize_morning_message(message, state)
        
        # Log agent run — persist the exact slimmed inputs sent to the LLM
        self.logger.log_agent_run(
            ingestion_run_id=state['ingestion_run_id'],
            user_id=state['user_id'],
            for_date=date.fromisoformat(state['for_date']),
            agent_name='morning_brief_composer',
            attempt=state.get('attempt', 0),
            status='success',
            input_json=brief_inputs,
            output_json={"morning_message": state["morning_message"]},
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

    def _apply_deterministic_constraint_overrides(
        self,
        state: PipelineState,
        constraints: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Force energy_mode + recovery risk flags from code, not the LLM."""
        out = dict(constraints or {})
        # Evaluate triggers against the LLM draft so low_recovery/burnout_risk apply immediately.
        energy_mode = self._effective_energy_mode(state, constraints=out)
        out["energy_mode"] = energy_mode

        # Multi-day patterns → risk_flags (facts from code detectors).
        risk_flags = out.get("risk_flags") if isinstance(out.get("risk_flags"), list) else []
        risk_flags = [str(f) for f in risk_flags]
        for pattern in state.get("active_patterns") or []:
            if not isinstance(pattern, dict):
                continue
            ptype = str(pattern.get("type") or "")
            feature = str(pattern.get("feature") or pattern.get("block") or "")
            flag = f"pattern:{ptype}:{feature}" if feature else f"pattern:{ptype}"
            if flag and flag not in risk_flags:
                risk_flags.append(flag)
            if str(pattern.get("severity") or "").lower() == "high" and "low_recovery" not in {
                str(f).lower() for f in risk_flags
            }:
                if ptype in ("low_streak", "cumulative_deficit", "no_recovery") and (
                    feature.startswith("sleep") or feature == "hrv_rmssd"
                ):
                    risk_flags.append("low_recovery")
        out["risk_flags"] = risk_flags

        triggers = self._safety_override_triggers(state, constraints=out)
        if triggers:
            risk_flags = out.get("risk_flags") if isinstance(out.get("risk_flags"), list) else []
            risk_flags = [str(f) for f in risk_flags]
            for flag in triggers:
                if flag not in risk_flags:
                    risk_flags.append(flag)
            out["risk_flags"] = risk_flags

            hard = out.get("hard_constraints") if isinstance(out.get("hard_constraints"), list) else []
            hard = [str(h) for h in hard]
            recovery_hard = "Prioritize recovery today; do not push high-intensity load"
            if recovery_hard not in hard:
                hard.append(recovery_hard)
            out["hard_constraints"] = hard

            soft = out.get("soft_constraints") if isinstance(out.get("soft_constraints"), list) else []
            soft = [str(s) for s in soft]
            banned = "Do not use high-energy / harness-your-energy framing"
            if banned not in soft:
                soft.append(banned)
            out["soft_constraints"] = soft

            evidence = out.get("evidence_used") if isinstance(out.get("evidence_used"), dict) else {}
            evidence = dict(evidence)
            evidence["safety_override"] = {
                "active": True,
                "triggers": triggers,
                "energy_mode_capped_to": energy_mode,
            }
            evidence["active_patterns"] = list(state.get("active_patterns") or [])
            out["evidence_used"] = evidence

        if not self._is_fast_ready(state):
            # Strip baseline-dependent volatility risk unless grounded elsewhere.
            risk_flags = out.get("risk_flags") if isinstance(out.get("risk_flags"), list) else []
            out["risk_flags"] = [
                f for f in risk_flags
                if str(f).lower() not in {"volatility", "mismatch_pattern"}
            ]
            assumptions = out.get("assumptions") if isinstance(out.get("assumptions"), list) else []
            assumptions = [str(a) for a in assumptions]
            note = "Learning mode: baselines not ready; avoid z-score/volatility claims"
            if note not in assumptions:
                assumptions.append(note)
            out["assumptions"] = assumptions

        return out

    def _validate_and_normalize_review_result(
        self,
        review_result: Dict[str, Any],
        proposals: List[Dict[str, Any]],
        selected_domains: List[str],
        goal_domains: List[str],
        *,
        active_patterns: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Schema-validate critic output; enforce disjoint accept/reject + coverage consistency."""
        out = dict(review_result or {})
        n = len(proposals)
        validation_issues: List[str] = []
        active_patterns = active_patterns or []

        def _to_index(value: Any) -> Optional[int]:
            if isinstance(value, int):
                return value if 0 <= value < n else None
            if isinstance(value, str):
                # Match by action_id or title
                for i, action in enumerate(proposals):
                    if not isinstance(action, dict):
                        continue
                    if value == action.get("action_id") or value == action.get("title"):
                        return i
                # Numeric string
                if value.isdigit():
                    idx = int(value)
                    return idx if 0 <= idx < n else None
            return None

        accepted_raw = out.get("accepted_actions")
        if accepted_raw is None and out.get("accepted_action_ids"):
            accepted_raw = out.get("accepted_action_ids")
        if not isinstance(accepted_raw, list):
            accepted_raw = []
            validation_issues.append("accepted_actions missing or not a list")

        accepted_indices: List[int] = []
        for item in accepted_raw:
            idx = _to_index(item)
            if idx is None:
                validation_issues.append(f"invalid accepted entry: {item!r}")
                continue
            if idx not in accepted_indices:
                accepted_indices.append(idx)

        rejected_raw = out.get("rejected_actions")
        if not isinstance(rejected_raw, list):
            rejected_raw = []
            validation_issues.append("rejected_actions missing or not a list")

        rejected_indices: List[int] = []
        normalized_rejected: List[Dict[str, Any]] = []
        for item in rejected_raw:
            if isinstance(item, dict):
                idx = _to_index(item.get("action_index"))
                if idx is None:
                    idx = _to_index(item.get("action_id") or item.get("title"))
                reason = item.get("reason") or "rejected"
            else:
                idx = _to_index(item)
                reason = "rejected"
            if idx is None:
                validation_issues.append(f"invalid rejected entry: {item!r}")
                continue
            if idx not in rejected_indices:
                rejected_indices.append(idx)
                normalized_rejected.append({"action_index": idx, "reason": str(reason)})

        overlap = set(accepted_indices) & set(rejected_indices)
        if overlap:
            validation_issues.append(
                f"accepted/rejected not disjoint (overlap indices={sorted(overlap)})"
            )
            # Reject wins for safety.
            accepted_indices = [i for i in accepted_indices if i not in overlap]

        accepted_ids = [
            proposals[i]["action_id"]
            for i in accepted_indices
            if isinstance(proposals[i], dict) and proposals[i].get("action_id")
        ]

        # Coverage consistency vs prompt rules (accepted set).
        selected = {str(d).lower() for d in (selected_domains or []) if d}
        goals = {str(d).lower() for d in (goal_domains or []) if d}
        accepted_domains = [
            str(proposals[i].get("domain") or "").lower()
            for i in accepted_indices
            if isinstance(proposals[i], dict)
        ]

        coverage_ok = True
        coverage_note = ""
        if selected or goals:
            overlap_domains = selected & goals if (selected and goals) else set()
            if overlap_domains:
                in_overlap = sum(1 for d in accepted_domains if d in (selected | goals))
                if in_overlap < 4:
                    coverage_ok = False
                    coverage_note = (
                        f"coverage unmet: need ≥4 accepted in selected/goal domains; got {in_overlap}"
                    )
            elif selected and goals and selected != goals:
                in_selected = sum(1 for d in accepted_domains if d in selected)
                in_goal = sum(1 for d in accepted_domains if d in goals)
                if in_selected < 4 or in_goal < 1:
                    coverage_ok = False
                    coverage_note = (
                        f"coverage unmet: need ≥4 selected-domain and ≥1 goal-domain actions; "
                        f"got selected={in_selected}, goal={in_goal}"
                    )
            elif selected:
                in_selected = sum(1 for d in accepted_domains if d in selected)
                if in_selected < 4 and len(accepted_ids) >= 4:
                    # Soft: only flag when enough accepts but wrong domains
                    coverage_ok = False
                    coverage_note = (
                        f"coverage unmet: need ≥4 selected-domain actions; got {in_selected}"
                    )

        regen_required = bool(out.get("regen_required"))
        if validation_issues:
            regen_required = True
        if not coverage_ok:
            regen_required = True
        if len(accepted_ids) < self.regen_controller.min_valid_actions:
            regen_required = True
            validation_issues.append(
                f"fewer than {self.regen_controller.min_valid_actions} accepted actions"
            )

        # High-severity multi-day patterns must be addressed by ≥1 accepted action domain.
        pattern_coverage_unmet = False
        pattern_coverage_note = ""
        required_domains = domains_for_high_patterns(active_patterns)
        if required_domains:
            accepted_domain_set = {d for d in accepted_domains if d}
            missing_domains = [d for d in required_domains if d not in accepted_domain_set]
            # recovery ↔ sleep are interchangeable for coverage
            if "recovery" in missing_domains and "sleep" in accepted_domain_set:
                missing_domains = [d for d in missing_domains if d != "recovery"]
            if "sleep" in missing_domains and "recovery" in accepted_domain_set:
                missing_domains = [d for d in missing_domains if d != "sleep"]
            if missing_domains:
                pattern_coverage_unmet = True
                regen_required = True
                unmet_patterns = [
                    p for p in high_severity_patterns(active_patterns)
                    if str(p.get("domain") or "").lower() in missing_domains
                    or (
                        str(p.get("domain") or "").lower() == "recovery"
                        and "recovery" in missing_domains
                    )
                ]
                names = []
                for p in unmet_patterns or high_severity_patterns(active_patterns):
                    names.append(
                        f"{p.get('type')}:{p.get('feature')}({p.get('days') or p.get('window_days') or '?'}d)"
                    )
                pattern_coverage_note = (
                    "high-severity pattern coverage unmet: need ≥1 accepted action in "
                    f"domains {missing_domains}; unaddressed={names}"
                )

        feedback_parts = []
        if out.get("regen_feedback"):
            feedback_parts.append(str(out.get("regen_feedback")))
        if validation_issues:
            feedback_parts.append("schema_validation: " + "; ".join(validation_issues))
        if coverage_note:
            feedback_parts.append(coverage_note)
        if pattern_coverage_note:
            feedback_parts.append(pattern_coverage_note)

        out["accepted_actions"] = accepted_indices
        out["rejected_actions"] = normalized_rejected
        out["accepted_action_ids"] = accepted_ids
        out["regen_required"] = regen_required
        out["pattern_coverage_unmet"] = pattern_coverage_unmet
        if regen_required:
            out["regen_feedback"] = " | ".join(p for p in feedback_parts if p) or "regen required"
        out["validation"] = {
            "ok": not validation_issues and coverage_ok and not pattern_coverage_unmet,
            "issues": validation_issues,
            "coverage_ok": coverage_ok,
            "coverage_note": coverage_note or None,
            "pattern_coverage_ok": not pattern_coverage_unmet,
            "pattern_coverage_note": pattern_coverage_note or None,
            "accepted_rejected_disjoint": not bool(overlap),
        }
        debug_log(
            f"[FUSION_CRITIC] validated accepted={accepted_ids} "
            f"regen_required={regen_required} issues={validation_issues}"
        )
        return out

    def _sanitize_morning_message(self, message: str, state: PipelineState) -> str:
        """Strip banned high-energy framing when safety override is active."""
        text = message or ""
        if not self._safety_override_triggers(state):
            return text
        lowered = text.lower()
        for phrase in self.BANNED_HIGH_ENERGY_PHRASES:
            idx = lowered.find(phrase)
            while idx != -1:
                end = idx + len(phrase)
                text = text[:idx] + "protect your energy" + text[end:]
                lowered = text.lower()
                idx = lowered.find(phrase)
        return text

    def _deterministic_pattern_coverage_repair(self, state: PipelineState) -> bool:
        """
        After max LLM regen, promote/accept a proposal in each unmet high-pattern domain.
        Returns True if coverage is satisfied after repair (safe to continue to budget).
        """
        review = dict(state.get("review_result") or {})
        if not review.get("pattern_coverage_unmet"):
            return not bool(review.get("regen_required"))

        proposals = state.get("action_proposals") or []
        accepted_ids = list(review.get("accepted_action_ids") or [])
        accepted_domains = {
            str(a.get("domain") or "").lower()
            for a in proposals
            if isinstance(a, dict) and a.get("action_id") in accepted_ids
        }
        required = domains_for_high_patterns(state.get("active_patterns") or [])
        changed = False
        for domain in required:
            if domain in accepted_domains:
                continue
            if domain == "recovery" and "sleep" in accepted_domains:
                continue
            if domain == "sleep" and "recovery" in accepted_domains:
                continue
            candidate = None
            for action in proposals:
                if not isinstance(action, dict):
                    continue
                ad = str(action.get("domain") or "").lower()
                if ad == domain or (domain == "recovery" and ad == "sleep"):
                    candidate = action
                    break
            if candidate and candidate.get("action_id") not in accepted_ids:
                accepted_ids.append(candidate["action_id"])
                accepted_domains.add(str(candidate.get("domain") or "").lower())
                changed = True

        if not changed and required:
            # Still unmet and no candidate — cannot repair.
            return False

        # Re-check coverage
        missing = []
        for domain in required:
            if domain in accepted_domains:
                continue
            if domain == "recovery" and "sleep" in accepted_domains:
                continue
            if domain == "sleep" and "recovery" in accepted_domains:
                continue
            missing.append(domain)
        if missing:
            return False

        review["accepted_action_ids"] = accepted_ids
        # Rebuild accepted indices best-effort
        id_to_idx = {
            a.get("action_id"): i
            for i, a in enumerate(proposals)
            if isinstance(a, dict) and a.get("action_id")
        }
        review["accepted_actions"] = [
            id_to_idx[aid] for aid in accepted_ids if aid in id_to_idx
        ]
        review["pattern_coverage_unmet"] = False
        # Clear regen only if pattern was the blocking reason or min_valid now met.
        if len(accepted_ids) >= self.regen_controller.min_valid_actions:
            review["regen_required"] = False
            review["regen_feedback"] = ""
        else:
            review["regen_required"] = True
        validation = dict(review.get("validation") or {})
        validation["pattern_coverage_ok"] = True
        validation["pattern_coverage_note"] = "repaired_deterministically"
        review["validation"] = validation
        state["review_result"] = review
        debug_log(f"[FUSION_CRITIC] pattern coverage repaired accepted={accepted_ids}")
        return not bool(review.get("regen_required"))

    def _should_regenerate(self, state: PipelineState) -> str:
        """Decide regenerate vs continue to budget/compose. Always continue after max regen."""
        review = state.get("review_result") or {}
        accepted_ids = review.get("accepted_action_ids") or []
        regen_required = bool(review.get("regen_required"))
        attempt = int(state.get("attempt") or 0)

        if regen_required and attempt < self.regen_controller.max_regen:
            return "regenerate"

        if regen_required:
            # Exhausted LLM retries — best-effort domain repair, then always compose a brief.
            self._deterministic_pattern_coverage_repair(state)
            return "continue"

        if self.regen_controller.should_regenerate(attempt, len(accepted_ids), regen_required):
            return "regenerate"
        return "continue"
    
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
            'correlation_archetype': {},
            'user_name': '',
            'recent_action_history': [],
            'previous_morning_brief': {'present': False},
            'active_patterns': [],
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
                'energy_mode': self._effective_energy_mode(final_state),
                'learning_mode': not self._is_fast_ready(final_state),
                'safety_override': self._safety_override_payload(final_state) or None,
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

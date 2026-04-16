"""
LangGraph Pipeline - Orchestrates morning coach workflow
Combines Python deterministic agents + LLM reasoning agents
"""
import os
import sys
import re
from datetime import datetime, date
from typing import Dict, List, Any, TypedDict, Annotated
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
import json

from data_fetcher import DataFetcher
from deterministic_agents import (
    IngestionAgent,
    FeatureAgent,
    BudgetEnforcerAgent,
    PersistenceAgent,
    RegenerationController
)
from action_utils import add_action_ids_to_candidates
from agent_logger import AgentLogger

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
    
    # Data snapshots
    raw_snapshot: Dict[str, Any]
    validation_result: Dict[str, Any]
    features: Dict[str, Any]

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
    
    def __init__(self, supabase_client, openrouter_api_key: str):
        self.client = supabase_client
        self.data_fetcher = DataFetcher(
            os.getenv('NEXT_PUBLIC_SUPABASE_URL'),
            os.getenv('SUPABASE_SERVICE_ROLE_KEY')
        )
        self.ingestion_agent = IngestionAgent(supabase_client)
        self.feature_agent = FeatureAgent(supabase_client)
        self.budget_enforcer = BudgetEnforcerAgent()
        self.persistence_agent = PersistenceAgent(supabase_client)
        self.regen_controller = RegenerationController()
        self.logger = AgentLogger(supabase_client)

        # LLM client via OpenRouter
        self.openrouter_api_key = openrouter_api_key
        self.model_name = "deepseek/deepseek-v3.2"
        self.llm = ChatOpenAI(
            model=self.model_name,
            api_key=openrouter_api_key,
            base_url="https://openrouter.ai/api/v1",
            temperature=0.7
        )
        
        # Build graph
        self.graph = self._build_graph()
    
    def _build_graph(self) -> StateGraph:
        """Build the LangGraph workflow"""
        workflow = StateGraph(PipelineState)
        
        # Add nodes (agents)
        workflow.add_node("fetch_data", self.node_fetch_data)
        workflow.add_node("ingest_validate", self.node_ingest_validate)
        workflow.add_node("compute_features", self.node_compute_features)
        workflow.add_node("generate_holistic_status_report", self.node_holistic_status_report)
        workflow.add_node("fetch_goal", self.node_fetch_goal)
        workflow.add_node("build_constraints", self.node_build_constraints)
        workflow.add_node("route_domains", self.node_route_domains)
        workflow.add_node("generate_actions", self.node_generate_actions)
        workflow.add_node("review_actions", self.node_review_actions)
        workflow.add_node("enforce_budget", self.node_enforce_budget)
        workflow.add_node("compose_brief", self.node_compose_brief)
        workflow.add_node("persist_plan", self.node_persist_plan)
        
        # Define edges (flow)
        workflow.set_entry_point("fetch_data")
        workflow.add_edge("fetch_data", "ingest_validate")
        workflow.add_edge("ingest_validate", "compute_features")
        workflow.add_edge("compute_features", "generate_holistic_status_report")
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
    
    def node_fetch_data(self, state: PipelineState) -> PipelineState:
        """Data Fetch Agent"""
        target_date = date.fromisoformat(state['for_date'])
        raw_snapshot = self.data_fetcher.fetch_all_daily_data(state['user_id'], target_date)
        #print (f"Fetched raw snapshot for user {state['user_id']} on {state['for_date']}. {raw_snapshot}")
        # Add overall_score to snapshot
        raw_snapshot['overall'] = {'overall_score': state['overall_score']}

        # Fetch user profile for personalization
        profile = self.data_fetcher.fetch_user_profile(state['user_id'])
        state['user_name'] = profile.get('first_name', '') if profile else ''

        # Fetch recent action history for variety
        state['recent_action_history'] = self.data_fetcher.fetch_recent_actions(
            state['user_id'], target_date
        )

        # Log snapshot to database
        history_window = raw_snapshot.get('history_7d', {})
        self.logger.log_snapshot(
            state['ingestion_run_id'],
            state['user_id'],
            target_date,
            raw_snapshot,
            history_window
        )

        state['raw_snapshot'] = raw_snapshot
        return state
    
    def node_ingest_validate(self, state: PipelineState) -> PipelineState:
        """Ingestion & Validation Agent"""
        target_date = date.fromisoformat(state['for_date'])
        validation_result = self.ingestion_agent.run(
            state['user_id'],
            target_date,
            state['raw_snapshot']
        )
        
        # Persist data quality report
        self.persistence_agent.persist_data_quality_report(
            state['ingestion_run_id'],
            state['user_id'],
            target_date,
            validation_result
        )
        
        state['validation_result'] = validation_result
        return state
    
    def node_compute_features(self, state: PipelineState) -> PipelineState:
        """Feature Computation Agent"""
        target_date = date.fromisoformat(state['for_date'])
        features = self.feature_agent.run(
            state['user_id'],
            target_date,
            state['validation_result']['normalized_data'],
            state['ingestion_run_id']
        )
        state['features'] = features
        return state
    
    def node_holistic_status_report(self, state: PipelineState) -> PipelineState:
        """Holistic Status Reporter — objective, pre-goal domain analysis."""
        from prompts import HOLISTIC_STATUS_REPORTER_SYSTEM_PROMPT
        from constants import DOMAIN_FEATURE_MAP
        
        started_at = datetime.utcnow()
        
        # Build compact feature table: domain -> {feature: value}
        domain_features: Dict[str, Dict] = {}
        for domain, keys in DOMAIN_FEATURE_MAP.items():
            values = {}
            for k in keys:
                if k in state['features'] and state['features'][k].get('value_num') is not None:
                    values[k] = state['features'][k]['value_num']
            if values:  # only include domains that have at least one value
                domain_features[domain] = values
        
        user_prompt = f"""Overall score today: {state['overall_score']}
Energy mode: {self._get_energy_mode(state['overall_score'])}
Data confidence by domain: {json.dumps(state['validation_result']['confidence_by_domain'], indent=2)}

Feature values by domain:
{json.dumps(domain_features, indent=2)}

Generate the holistic status report JSON."""
        
        # Use temperature=0 for maximum determinism
        response = self._call_llm(HOLISTIC_STATUS_REPORTER_SYSTEM_PROMPT, user_prompt, temperature=0)
        debug_log(f"[HOLISTIC_STATUS_REPORTER] Response: {response[:400]}...")
        
        report = self._parse_llm_json(response, 'holistic_status_reporter')
        
        state['holistic_status_report'] = report
        
        debug_log(f"[HOLISTIC_STATUS_REPORTER] Generated report for user {state['user_id']} on {state['for_date']}")
        
        # Log agent run
        self.logger.log_agent_run(
            ingestion_run_id=state['ingestion_run_id'],
            user_id=state['user_id'],
            for_date=date.fromisoformat(state['for_date']),
            agent_name='holistic_status_reporter',  # closest valid enum; report stored in output_json
            attempt=state.get('attempt', 0) + 100,
            status='success',
            input_json={
                'overall_score': state['overall_score'],
                'domain_features_summary': {d: len(v) for d, v in domain_features.items()}
            },
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
        energy_mode = self._get_energy_mode(state['overall_score'])
        user_prompt = f"""
Energy mode: {energy_mode}
Overall score: {state['overall_score']}
User goal: {json.dumps(state.get('user_goal', {}), indent=2)}
Data confidence by domain: {json.dumps(state['validation_result']['confidence_by_domain'], indent=2)}
Available features: {json.dumps({k: v['value_num'] for k, v in list(state['features'].items())[:20]}, indent=2)}

Generate day constraints JSON.
"""
        
        response = self._call_llm(CONSTRAINTS_BUILDER_SYSTEM_PROMPT, user_prompt)
        debug_log(f"[CONSTRAINTS_BUILDER] Response: {response[:200]}...")
        
        output = self._parse_llm_json(response, 'constraints_builder')
        
        state['day_constraints'] = output
        
        # Log agent run
        self.logger.log_agent_run(
            ingestion_run_id=state['ingestion_run_id'],
            user_id=state['user_id'],
            for_date=date.fromisoformat(state['for_date']),
            agent_name='constraints_builder',
            attempt=state.get('attempt', 0),
            status='success',
            input_json={
                'energy_mode': energy_mode,
                'overall_score': state['overall_score'],
                'user_goal': state.get('user_goal', {}),
                'confidence_by_domain': state['validation_result']['confidence_by_domain']
            },
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
        user_prompt = f"""Energy mode: {self._get_energy_mode(state['overall_score'])}
Day constraints: {json.dumps(state['day_constraints'], indent=2)}
User goal primary domains: {state['user_goal']['goal_spec_json'].get('primary_domains', []) if state['user_goal'] else []}
Data confidence: {json.dumps(state['validation_result']['confidence_by_domain'], indent=2)}

Holistic status report (objective, pre-goal analysis):
{json.dumps(state['holistic_status_report'], indent=2)}

Select 2-3 domains. 
"""
        #Priority: stability + recovery + main goal when low capacity.
        
        response = self._call_llm(DOMAIN_ROUTER_SYSTEM_PROMPT, user_prompt)
        debug_log(f"[DOMAIN_ROUTER] Response: {response[:300]}...")
        
        output = self._parse_llm_json(response, 'domain_router')
        
        # Extract domain names from selected_domains (which may be dicts with 'domain' key)
        selected = output['selected_domains']
        if selected and isinstance(selected[0], dict):
            state['selected_domains'] = [d['domain'] for d in selected]
        else:
            state['selected_domains'] = selected
        
        # Log agent run
        self.logger.log_agent_run(
            ingestion_run_id=state['ingestion_run_id'],
            user_id=state['user_id'],
            for_date=date.fromisoformat(state['for_date']),
            agent_name='domain_router',
            attempt=state.get('attempt', 0),
            status='success',
            input_json={
                'energy_mode': self._get_energy_mode(state['overall_score']),
                'day_constraints': state['day_constraints'],
                'user_goal_primary_domains': state['user_goal']['goal_spec_json'].get('primary_domains', []) if state['user_goal'] else [],
                'confidence_by_domain': state['validation_result']['confidence_by_domain'],
                'holistic_status_report': state['holistic_status_report']
            },
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
        from constants import DOMAIN_FEATURE_MAP

        # Get user goal domains
        goal_domains = []
        if state['user_goal'] and 'goal_spec_json' in state['user_goal']:
            goal_domains = state['user_goal']['goal_spec_json'].get('primary_domains', [])

        # Build domain-specific feature context for selected and goal domains
        all_domains = list(set(state['selected_domains'] + goal_domains))
        domain_contexts = []
        for domain in all_domains:
            feature_keys = DOMAIN_FEATURE_MAP.get(domain, [])
            available_features = {
                k: state['features'][k]['value_num']
                for k in feature_keys
                if k in state['features'] and state['features'][k].get('value_num') is not None
            }
            domain_contexts.append({
                'domain': domain,
                'available_features': available_features
            })

        # Build meal context from features
        meal_context = ""
        meal_desc = state['features'].get('meal_descriptions', {})
        if meal_desc and meal_desc.get('value_json'):
            meal_context = f"\nYesterday's meals:\n{json.dumps(meal_desc['value_json'], indent=2)}\n"

        # Build action history context
        action_history_context = ""
        if state.get('recent_action_history'):
            recent = state['recent_action_history'][:15]  # Cap at 15 most recent
            history_summary = [
                {'date': a.get('for_date'), 'domain': a.get('domain'), 'action': a.get('reason', '')[:80]}
                for a in recent
            ]
            action_history_context = f"\nRecent actions (last 7 days — avoid repeating the same suggestions):\n{json.dumps(history_summary, indent=2)}\n"

        user_prompt = f"""Selected domains: {json.dumps(state['selected_domains'])}
User goal domains: {json.dumps(goal_domains)}
Day constraints: {json.dumps(state['day_constraints'], indent=2)}

Holistic status report (overall picture of user today):
{json.dumps(state['holistic_status_report'], indent=2)}

Domain-specific features (for selected and goal domains):
{json.dumps(domain_contexts, indent=2)}
{meal_context}{action_history_context}
Generate 4-5 actions. Follow the rules: If selected and goal domains overlap, generate 3-4 actions for those domains.
 If different, generate at least 3 for selected domains and at least 1 (ideally 1-2) for the goal domain(s).
 **DO NOT include action_id - it will be generated automatically.**
"""

        started_at = datetime.utcnow()
        response = self._call_llm(ACTION_GENERATOR_SYSTEM_PROMPT, user_prompt)
        debug_log(f"[ACTION_GENERATOR] Response (first 800 chars): {response[:800]}")

        output = self._parse_llm_json(response, 'action_generator')

        # Add action IDs
        actions = add_action_ids_to_candidates(output['actions'])
        state['action_proposals'] = actions
        state['attempt'] = state.get('attempt', 0) + 1

        # Log agent run
        agent_run_id = self.logger.log_agent_run(
            ingestion_run_id=state['ingestion_run_id'],
            user_id=state['user_id'],
            for_date=date.fromisoformat(state['for_date']),
            agent_name='action_candidate_generator',
            attempt=state['attempt'],
            status='success',
            input_json={
                'selected_domains': state['selected_domains'],
                'goal_domains': goal_domains,
                'day_constraints': state['day_constraints'],
                'domain_contexts': domain_contexts,
                'holistic_status_report': state['holistic_status_report']
            },
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

        goal_domains = []
        if state['user_goal'] and 'goal_spec_json' in state['user_goal']:
            goal_domains = state['user_goal']['goal_spec_json'].get('primary_domains', [])
        
        user_prompt = f"""
Selected domains:
{json.dumps(state['selected_domains'], indent=2)}

User goal domains:
{json.dumps(goal_domains, indent=2)}

Proposed actions:
{json.dumps(state['action_proposals'], indent=2)}

Day constraints:
{json.dumps(state['day_constraints'], indent=2)}

Review for coherence, feasibility, safety, and domain/goal coverage rules. Accept at least 4 if possible.
"""
        
        started_at = datetime.utcnow()
        response = self._call_llm(FUSION_CRITIC_SYSTEM_PROMPT, user_prompt)
        debug_log(f"[FUSION_CRITIC] Response: {response[:400]}...")
        
        review_result = self._parse_llm_json(response, 'fusion_critic')
        
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
        
        # Log agent run
        agent_run_id = self.logger.log_agent_run(
            ingestion_run_id=state['ingestion_run_id'],
            user_id=state['user_id'],
            for_date=date.fromisoformat(state['for_date']),
            agent_name='fusion_critic',
            attempt=state.get('attempt', 0),
            status='success',
            input_json={
                'selected_domains': state['selected_domains'],
                'goal_domains': goal_domains,
                'action_proposals': state['action_proposals'],
                'day_constraints': state['day_constraints']
            },
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

        user_name_line = f"- User name: {state['user_name']}" if state.get('user_name') else "- User name: not available"

        user_prompt = f"""
Today's situation:
- Energy mode: {self._get_energy_mode(state['overall_score'])}
- Overall score: {state['overall_score']}
- Selected domains: {', '.join(state['selected_domains'])}
- Data confidence: {state['validation_result']['confidence_score']}
{user_name_line}

Holistic status report JSON:
{json.dumps(state.get('holistic_status_report', {}), indent=2)}

Display actions:
{json.dumps(state['budget_result']['display_actions'], indent=2)}

Write a personal morning note (300-400 words). Spend most of the words on the narrative — dig into the data, tell the story of yesterday and what it means for today. Keep actions concise. Use markdown for formatting.
"""
        
        started_at = datetime.utcnow()
        response = self._call_llm(MORNING_BRIEF_COMPOSER_SYSTEM_PROMPT, user_prompt)
        debug_log(f"[MORNING_BRIEF_COMPOSER] Response:\n{response}")
        
        output = self._parse_llm_json(response, 'morning_brief_composer')
        
        state['morning_message'] = output['morning_message']
        
        # Log agent run
        self.logger.log_agent_run(
            ingestion_run_id=state['ingestion_run_id'],
            user_id=state['user_id'],
            for_date=date.fromisoformat(state['for_date']),
            agent_name='morning_brief_composer',
            attempt=state.get('attempt', 0),
            status='success',
            input_json={
                'energy_mode': self._get_energy_mode(state['overall_score']),
                'overall_score': state['overall_score'],
                'selected_domains': state['selected_domains'],
                'holistic_status_report': state.get('holistic_status_report', {}),
                'display_actions': state['budget_result']['display_actions'],
                'confidence_score': state['validation_result']['confidence_score']
            },
            output_json=output,
            started_at=started_at,
            ended_at=datetime.utcnow()
        )
        
        return state
    
    # === Helper methods ===
    
    def _call_llm(self, system_prompt: str, user_prompt: str, temperature: float = 0.7) -> str:
        """Call LLM with system and user prompts"""
        if temperature != self.llm.temperature:
            llm = ChatOpenAI(
                model=self.model_name,
                api_key=self.openrouter_api_key,
                base_url="https://openrouter.ai/api/v1",
                temperature=temperature
            )
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
        
        debug_log(f"[LLM] Raw response length: {len(content)}")
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
            'raw_snapshot': {},
            'validation_result': {},
            'features': {},
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
                'confidence': final_state['validation_result']['confidence_score'],
                'attempts': final_state['attempt'],
                'holistic_status_report': final_state['holistic_status_report']
            }
        }

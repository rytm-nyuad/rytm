"""
Agent Logger - Handles logging agent runs, snapshots, and proposals to database
"""
import uuid
from datetime import datetime, date
from typing import Dict, List, Any, Optional
from supabase import Client


class AgentLogger:
    """Logs agent execution data to database tables for inspection"""
    
    def __init__(self, client: Client):
        self.client = client
    
    def log_snapshot(
        self,
        ingestion_run_id: str,
        user_id: str,
        for_date: date,
        raw_snapshot_json: Dict[str, Any],
        history_window_json: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Log raw snapshot to daily_snapshots1
        Returns snapshot_id
        """
        result = self.client.table('daily_snapshots1').insert({
            'ingestion_run_id': ingestion_run_id,
            'user_id': user_id,
            'for_date': for_date.isoformat(),
            'raw_snapshot_json': raw_snapshot_json,
            'history_window_json': history_window_json or {}
        }).execute()
        
        return result.data[0]['snapshot_id']
    
    def log_agent_run(
        self,
        ingestion_run_id: str,
        user_id: str,
        for_date: date,
        agent_name: str,
        attempt: int,
        status: str,
        input_json: Dict[str, Any],
        output_json: Dict[str, Any],
        rationale_json: Optional[Dict[str, Any]] = None,
        evidence_refs_json: Optional[Dict[str, Any]] = None,
        model_info_json: Optional[Dict[str, Any]] = None,
        usage_json: Optional[Dict[str, Any]] = None,
        error_json: Optional[Dict[str, Any]] = None,
        started_at: Optional[datetime] = None,
        ended_at: Optional[datetime] = None
    ) -> str:
        """
        Log agent run to agent_runs1
        Returns agent_run_id
        Status must be one of: 'started', 'success', 'partial', 'failed'
        """
        # Validate status enum
        valid_statuses = ['started', 'success', 'partial', 'failed']
        if status not in valid_statuses:
            status = 'success'  # Default to success if invalid
        
        result = self.client.table('agent_runs1').insert({
            'ingestion_run_id': ingestion_run_id,
            'user_id': user_id,
            'for_date': for_date.isoformat(),
            'agent_name': agent_name,
            'attempt': attempt,
            'status': status,
            'input_json': input_json,
            'output_json': output_json,
            'rationale_json': rationale_json or {},
            'evidence_refs_json': evidence_refs_json or {},
            'model_info_json': model_info_json or {'model': 'gpt-4o-mini'},
            'usage_json': usage_json or {},
            'started_at': (started_at or datetime.utcnow()).isoformat(),
            'ended_at': (ended_at or datetime.utcnow()).isoformat(),
            'error_json': error_json or {}
        }).execute()
        
        return result.data[0]['agent_run_id']
    
    def log_action_proposals(
        self,
        ingestion_run_id: str,
        user_id: str,
        for_date: date,
        stage: str,
        attempt: int,
        agent_run_id: str,
        proposals_json: List[Dict[str, Any]]
    ) -> str:
        """
        Log action proposals to action_proposals1
        Returns proposal_id
        """
        result = self.client.table('action_proposals1').insert({
            'ingestion_run_id': ingestion_run_id,
            'user_id': user_id,
            'for_date': for_date.isoformat(),
            'stage': stage,
            'attempt': attempt,
            'agent_run_id': agent_run_id,
            'proposals_json': proposals_json
        }).execute()
        
        return result.data[0]['proposal_id']
    
    def log_action_review(
        self,
        ingestion_run_id: str,
        user_id: str,
        for_date: date,
        agent_run_id: str,
        review_result: Dict[str, Any],
        attempt: int
    ):
        """
        Log action review results - can store in agent_runs1 with agent_name='fusion_critic'
        or create a separate table if needed
        """
        # Store as agent run for consistency
        return self.log_agent_run(
            ingestion_run_id=ingestion_run_id,
            user_id=user_id,
            for_date=for_date,
            agent_name='fusion_critic_review',
            attempt=attempt,
            status='success',
            input_json={'review_target': 'action_proposals'},
            output_json=review_result
        )

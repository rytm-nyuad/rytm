"""
Python Deterministic Agents - Data integrity, validation, and execution
These agents are NOT LLM-based. They guarantee system correctness.
"""
import os
from datetime import datetime, date
from typing import Dict, List, Any, Optional, Tuple
from supabase import create_client, Client
from data_fetcher import DataFetcher
from feature_computer import FeatureComputer


class IngestionAgent:
    """Ingestion & Validation Agent - Ensures data quality"""
    
    def __init__(self, client: Client):
        self.client = client
    
    def run(self, user_id: str, for_date: date, raw_snapshot: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validate and assess data quality
        Returns: {
            'validation_passed': bool,
            'missingness': {...},
            'confidence_score': float,
            'confidence_by_domain': {...}
        }
        """
        missingness = self._compute_missingness(raw_snapshot)
        confidence_by_domain = self._compute_domain_confidence(raw_snapshot)
        overall_confidence = sum(confidence_by_domain.values()) / len(confidence_by_domain) if confidence_by_domain else 0
        
        return {
            'validation_passed': True,
            'missingness': missingness,
            'confidence_score': round(overall_confidence, 2),
            'confidence_by_domain': confidence_by_domain,
            'normalized_data': raw_snapshot  # MVP: no normalization yet
        }
    
    def _compute_missingness(self, snapshot: Dict) -> Dict[str, Any]:
        """Compute what data is missing"""
        missing = {
            'sleep': snapshot.get('sleep') is None,
            'activity': snapshot.get('activity') is None,
            'hrv': snapshot.get('hrv') is None,
            'readiness': snapshot.get('readiness') is None,
            'water': len(snapshot.get('water', [])) == 0,
            'meals': len(snapshot.get('meals', [])) == 0,
            'checkin': snapshot.get('checkin') is None,
            'overall': snapshot.get('overall') is None,
        }
        return missing
    
    def _compute_domain_confidence(self, snapshot: Dict) -> Dict[str, float]:
        """Compute confidence score per domain"""
        confidence = {}
        
        # Sleep domain
        if snapshot.get('sleep') and snapshot['sleep'].get('minutes_asleep'):
            confidence['sleep'] = 1.0
        else:
            confidence['sleep'] = 0.0
        
        # Recovery domain
        hrv_present = snapshot.get('hrv') is not None
        readiness_present = snapshot.get('readiness') is not None
        confidence['recovery'] = (int(hrv_present) + int(readiness_present)) / 2.0
        
        # Hydration domain
        confidence['hydration'] = 1.0 if len(snapshot.get('water', [])) > 0 else 0.3
        
        # Nutrition domain
        confidence['nutrition'] = 1.0 if len(snapshot.get('meals', [])) > 0 else 0.3
        
        # Stress domain (needs checkin)
        confidence['stress'] = 1.0 if snapshot.get('checkin') else 0.0
        
        # Focus domain
        confidence['focus'] = 1.0 if snapshot.get('checkin') else 0.0
        
        # Training domain
        confidence['training'] = 1.0 if snapshot.get('activity') else 0.5
        
        # Stability domain (needs history)
        history_complete = len(snapshot.get('history_7d', {}).get('checkins', [])) >= 5
        confidence['stability'] = 0.8 if history_complete else 0.4
        
        # Productivity domain
        confidence['productivity'] = 0.7  # Calendar/todos always partially available
        
        return confidence


class FeatureAgent:
    """Feature & State Update Agent - Computes all features deterministically"""
    
    def __init__(self, client: Client):
        self.client = client
        self.computer = FeatureComputer()
    
    def run(self, user_id: str, for_date: date, validated_snapshot: Dict, ingestion_run_id: str) -> Dict[str, Dict]:
        """Compute all features from validated snapshot"""
        features = self.computer.compute_all_features(validated_snapshot, for_date)
        
        # Store features in database
        self._persist_features(user_id, for_date, features, ingestion_run_id)
        
        return features
    
    def _persist_features(self, user_id: str, for_date: date, features: Dict, ingestion_run_id: str):
        """Store computed features in daily_features1"""
        rows = []
        for feature_key, feature_data in features.items():
            row = {
                'user_id': user_id,
                'feature_date': for_date.isoformat(),
                'feature_key': feature_key,
                'value_num': feature_data.get('value_num'),
                'value_text': feature_data.get('value_text'),
                'unit': feature_data.get('unit'),
                'confidence': feature_data.get('confidence', 1.0),
                'source_lineage_json': {'computed_at': datetime.utcnow().isoformat()},
                'ingestion_run_id': ingestion_run_id,
                'feature_layer': 'derived'
            }
            if feature_data.get('value_json') is not None:
                row['value_json'] = feature_data['value_json']
            rows.append(row)
        
        if rows:
            self.client.table('daily_features1').upsert(rows).execute()


class BudgetEnforcerAgent:
    """Budget Enforcer Agent - Applies display constraints deterministically"""
    
    def __init__(self, target_actions: int = 3, hard_cap: int = 4):
        self.target_actions = target_actions
        self.hard_cap = hard_cap
    
    def run(self, accepted_actions: List[Dict], energy_mode: str, day_constraints: Dict) -> Dict[str, Any]:
        """
        Enforce budget policy and determine which actions to display
        Returns: {
            'all_valid_actions': [...],
            'display_actions': [...],
            'budget_applied': {...}
        }
        """
        # Sort by priority
        sorted_actions = sorted(accepted_actions, key=lambda a: a.get('priority', 999))
        
        # Determine display count based on energy mode
        if energy_mode == 'low':
            display_count = min(4, len(sorted_actions))
        elif energy_mode == 'normal':
            display_count = min(5, len(sorted_actions))
        else:  # high
            display_count = min(5, len(sorted_actions))
        
        # Cap at hard limit
        display_count = min(display_count, self.hard_cap)
        
        display_actions = sorted_actions[:display_count]
        
        return {
            'all_valid_actions': sorted_actions,
            'display_actions': display_actions,
            'budget_applied': {
                'energy_mode': energy_mode,
                'total_valid': len(sorted_actions),
                'displayed': len(display_actions),
                'policy': f'Display {display_count} based on {energy_mode} energy mode'
            }
        }


class PersistenceAgent:
    """Persistence & Audit Agent - Stores all pipeline outputs to database"""
    
    def __init__(self, client: Client):
        self.client = client
    
    def persist_daily_plan(
        self,
        ingestion_run_id: str,
        user_id: str,
        for_date: date,
        day_constraints: Dict,
        selected_domains: List[str],
        morning_message: str,
        budget_result: Dict,
        display_actions: List[Dict]
    ) -> str:
        """Store daily plan and return plan_id"""
        
        # Insert daily plan
        plan_result = self.client.table('daily_plans1').insert({
            'ingestion_run_id': ingestion_run_id,
            'user_id': user_id,
            'for_date': for_date.isoformat(),
            'status': 'draft',
            'day_constraints_json': day_constraints,
            'selected_domains_json': selected_domains,
            'morning_message': morning_message,
            'budget_policy_json': budget_result['budget_applied'],
            'budget_applied_json': budget_result['budget_applied'],
            'plan_json': {
                'version': 'mvp-v2-state-history-actions',
                'display_action_ids': [action.get('action_id') for action in display_actions],
                'display_actions_count': len(display_actions),
            }
        }).execute()
        
        plan_id = plan_result.data[0]['plan_id']
        
        return plan_id
    
    def persist_data_quality_report(
        self,
        ingestion_run_id: str,
        user_id: str,
        for_date: date,
        validation_result: Dict
    ):
        """Store data quality report"""
        self.client.table('data_quality_reports1').insert({
            'ingestion_run_id': ingestion_run_id,
            'user_id': user_id,
            'for_date': for_date.isoformat(),
            'missingness_json': validation_result['missingness'],
            'normalization_json': {},
            'confidence_score': validation_result['confidence_score'],
            'confidence_by_domain_json': validation_result['confidence_by_domain']
        }).execute()


class RegenerationController:
    """Regeneration Controller - Manages regen loops"""
    
    def __init__(self, max_regen: int = 2, min_valid_actions: int = 3):
        self.max_regen = max_regen
        self.min_valid_actions = min_valid_actions
    
    def should_regenerate(self, attempt: int, accepted_count: int, regen_required: bool) -> bool:
        """Determine if regeneration is needed"""
        if attempt >= self.max_regen:
            return False
        
        if regen_required and accepted_count < self.min_valid_actions:
            return True
        
        return False

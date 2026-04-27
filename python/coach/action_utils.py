"""
Action utilities - ID generation and validation
"""
import hashlib
import json
import re
from typing import Dict, Any

def normalize_text(text: str) -> str:
    """Normalize text for fingerprinting"""
    # Lowercase, remove extra whitespace, remove punctuation
    text = text.lower()
    text = re.sub(r'[^\w\s]', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def _evaluation_fingerprint(action: Dict[str, Any]) -> str:
    evaluation = action.get('evaluation', {})
    if isinstance(evaluation, dict) and evaluation:
        signal_refs = evaluation.get('signal_refs', [])
        normalized_refs = signal_refs if isinstance(signal_refs, list) else []
        fingerprint_payload = {
            'mode': evaluation.get('mode', ''),
            'signal_refs': normalized_refs,
            'success_definition': evaluation.get('success_definition', ''),
            'completion_prompt': evaluation.get('completion_prompt', ''),
        }
        return json.dumps(fingerprint_payload, sort_keys=True)

    success_criteria = action.get('success_criteria', {})
    if isinstance(success_criteria, dict):
        criteria_parts = [
            success_criteria.get('type', ''),
            success_criteria.get('feature_key', ''),
            success_criteria.get('operator', ''),
            str(success_criteria.get('threshold_num', '')),
            success_criteria.get('window', '')
        ]
        return '|'.join(criteria_parts)

    return ''


def generate_action_id(domain: str, title: str, action: Dict[str, Any]) -> str:
    """
    Generate deterministic action_id from canonical fingerprint
    Args:
        domain: Action domain
        title: Action title (will be normalized)
        action: Full action dict
    Returns:
        Hex string action_id (first 16 chars of SHA256)
    """
    # Normalize title
    normalized_title = normalize_text(title)
    
    criteria_str = _evaluation_fingerprint(action)
    
    # Create fingerprint
    fingerprint = f"{domain}::{normalized_title}::{criteria_str}"
    
    # Generate hash
    hash_obj = hashlib.sha256(fingerprint.encode('utf-8'))
    action_id = hash_obj.hexdigest()[:16]
    
    return action_id

def add_action_ids_to_candidates(actions: list) -> list:
    """Add action_id to each action candidate"""
    for action in actions:
        if 'action_id' not in action:
            action['action_id'] = generate_action_id(
                domain=action.get('domain', ''),
                title=action.get('title', ''),
                action=action
            )
    return actions

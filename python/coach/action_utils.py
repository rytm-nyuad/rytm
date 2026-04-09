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

def generate_action_id(domain: str, title: str, success_criteria: Dict[str, Any]) -> str:
    """
    Generate deterministic action_id from canonical fingerprint
    Args:
        domain: Action domain
        title: Action title (will be normalized)
        success_criteria: Success criteria dict
    Returns:
        Hex string action_id (first 16 chars of SHA256)
    """
    # Normalize title
    normalized_title = normalize_text(title)
    
    # Create deterministic success criteria string
    criteria_parts = [
        success_criteria.get('type', ''),
        success_criteria.get('feature_key', ''),
        success_criteria.get('operator', ''),
        str(success_criteria.get('threshold_num', '')),
        success_criteria.get('window', '')
    ]
    criteria_str = '|'.join(criteria_parts)
    
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
                success_criteria=action.get('success_criteria', {})
            )
    return actions

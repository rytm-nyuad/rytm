"""Day-validity filters applied before OS-only clustering and per-cluster stats.

Production morning multi-day rules live in data_prep.day_validity; this module
keeps the profiling API (require overall_score) and shared constants.
"""
from __future__ import annotations

from typing import List

import pandas as pd

from data_prep.day_validity import (
    CHECKIN_FEATURES as _DATA_PREP_CHECKIN,
    apply_day_validity as _apply_day_validity_core,
)
from profiling.behavior_clustering import (
    CATEGORY_A_FEATURES,
    CATEGORY_B_FEATURES,
    CATEGORY_D_FEATURES,
)

# Wearable-derived features (catalog retained for profiling consumers).
WEARABLE_FEATURES: List[str] = sorted(
    set(CATEGORY_A_FEATURES + CATEGORY_B_FEATURES)
)

CHECKIN_FEATURES: List[str] = sorted(set(CATEGORY_D_FEATURES) | set(_DATA_PREP_CHECKIN))

# Kept for backward-compatible imports / tests that reference these names.
SEDENTARY_UNWORN_THRESHOLD = 1300.0
SLEEP_BLOCK_FEATURES: List[str] = [
    "sleep_duration_hours",
    "sleep_efficiency",
    "deep_ratio",
    "rem_ratio",
    "wake_ratio",
    "sleep_score",
    "sleep_restfulness",
    "hrv_rmssd",
    "hrv_deep_rmssd",
]

__all__ = [
    "WEARABLE_FEATURES",
    "CHECKIN_FEATURES",
    "SLEEP_BLOCK_FEATURES",
    "SEDENTARY_UNWORN_THRESHOLD",
    "apply_day_validity",
]


def apply_day_validity(feature_matrix: pd.DataFrame) -> pd.DataFrame:
    """
    Prepare a day-level feature matrix for production OS-only profiling.

    Applies data_prep check-in zero-sentinel rules and drops days with missing
    overall_score. Does not null wearables for high sedentary or short sleep.
    """
    return _apply_day_validity_core(feature_matrix, require_overall_score=True)

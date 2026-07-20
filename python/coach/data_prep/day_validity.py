"""Day-validity filters for multi-day feature windows and pattern detection.

A day's check-in features are marked missing (NOT zero) when:
- any check-in field is exactly 0 while other check-in fields that day are
  non-zero → treat 0 as a missing sentinel (convert to null).

Must run before rolling windows and before pattern detection.
"""
from __future__ import annotations

from typing import List, Sequence

import pandas as pd

# Canonical check-in names used by morning multi-day prep (+ daily_features aliases).
CHECKIN_FEATURES: List[str] = [
    "mood_score",
    "stress_score",
    "energy_score",
    "focus_score",
    "social_score",
    "mood",
    "stress",
    "energy",
    "focus",
    "social_connectedness",
    "workload",
]


def apply_day_validity(
    feature_matrix: pd.DataFrame,
    *,
    require_overall_score: bool = False,
) -> pd.DataFrame:
    """
    Prepare a day-level feature matrix for rolling windows / pattern detection.

    Rules (applied in order):
    1. Optionally drop days with missing overall_score (profiling path).
    2. Check-in fields equal to exactly 0 alongside other non-zero check-in
       fields the same day → treat that 0 as a missing sentinel (NaN).
    """
    if feature_matrix.empty:
        return feature_matrix.copy()

    out = feature_matrix.copy()

    if require_overall_score:
        if "overall_score" not in out.columns:
            raise ValueError("overall_score column required for day validity")
        out = out.loc[out["overall_score"].notna()].copy()
        if out.empty:
            return out

    # Check-in 0 sentinel: 0 among otherwise non-zero check-ins → missing.
    checkin_cols = [c for c in CHECKIN_FEATURES if c in out.columns]
    if checkin_cols:
        out = _null_zero_checkin_sentinels(out, checkin_cols)

    return out


def _null_zero_checkin_sentinels(
    frame: pd.DataFrame, checkin_cols: Sequence[str]
) -> pd.DataFrame:
    """
    If a check-in field is exactly 0 while at least one other check-in field
    that day is non-zero and non-null, treat 0 as missing.
    """
    out = frame.copy()
    for idx in out.index:
        row = out.loc[idx, list(checkin_cols)]
        numeric = pd.to_numeric(row, errors="coerce")
        non_null = numeric.dropna()
        if non_null.empty:
            continue
        has_nonzero = (non_null != 0).any()
        if not has_nonzero:
            continue
        zero_mask = numeric == 0
        for col in checkin_cols:
            if bool(zero_mask.get(col, False)):
                out.at[idx, col] = pd.NA
    return out

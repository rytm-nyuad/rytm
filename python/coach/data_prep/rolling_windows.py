"""Rolling 3-day / 7-day aggregates for morning coach multi-day context.

Computes over valid (non-null) days only. Missing days are excluded from the
window, not treated as zeros. If n_valid_in_window < 2, aggregates are null.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence

import pandas as pd

# Canonical feature names for Layer A / Layer B.
KEY_FEATURES: List[str] = [
    "sleep_duration_hours",
    "sleep_efficiency",
    "hrv_rmssd",
    "resting_heart_rate",
    "steps",
    "sedentary_minutes",
    "mood_score",
    "stress_score",
    "energy_score",
    "focus_score",
    "social_score",
]

# Map daily_features1 / bundle aliases → canonical names.
FEATURE_ALIASES: Dict[str, Sequence[str]] = {
    "mood_score": ("mood_score", "mood"),
    "stress_score": ("stress_score", "stress"),
    "energy_score": ("energy_score", "energy"),
    "focus_score": ("focus_score", "focus"),
    "social_score": ("social_score", "social_connectedness", "social"),
    "hrv_rmssd": ("hrv_rmssd", "hrv_daily_rmssd"),
}

MIN_VALID_FOR_AGGREGATE = 2


@dataclass(frozen=True)
class RollingWindowConfig:
    short_window: int = 3
    long_window: int = 7
    min_valid: int = MIN_VALID_FOR_AGGREGATE


DEFAULT_ROLLING_CONFIG = RollingWindowConfig()


def canonicalize_feature_columns(frame: pd.DataFrame) -> pd.DataFrame:
    """Rename known aliases onto canonical KEY_FEATURES names (prefer canonical if both exist)."""
    if frame.empty:
        return frame.copy()
    out = frame.copy()
    for canonical, aliases in FEATURE_ALIASES.items():
        if canonical in out.columns:
            continue
        for alias in aliases:
            if alias in out.columns and alias != canonical:
                out[canonical] = out[alias]
                break
    return out


def _window_slice(series: pd.Series, n: int) -> pd.Series:
    """Last n rows of a date-sorted series (caller ensures sort)."""
    if series.empty or n <= 0:
        return series.iloc[0:0]
    return series.iloc[-n:]


def _valid_values(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce").dropna()


def compute_feature_rolling(
    series: pd.Series,
    *,
    config: RollingWindowConfig = DEFAULT_ROLLING_CONFIG,
) -> Dict[str, Any]:
    """
    Compute rolling aggregates for one feature series indexed by date (ascending).

    Returns keys:
      <feature> is not included — caller prefixes.
      3d_mean/min/max, 7d_mean, vs_7d_delta, n_valid_3d, n_valid_7d
    """
    numeric = pd.to_numeric(series, errors="coerce")
    short = _window_slice(numeric, config.short_window)
    long = _window_slice(numeric, config.long_window)
    short_valid = _valid_values(short)
    long_valid = _valid_values(long)

    n3 = int(len(short_valid))
    n7 = int(len(long_valid))

    out: Dict[str, Any] = {
        "n_valid_3d": n3,
        "n_valid_7d": n7,
        "3d_mean": None,
        "3d_min": None,
        "3d_max": None,
        "7d_mean": None,
        "vs_7d_delta": None,
        "latest": None,
    }

    if n3 >= config.min_valid:
        out["3d_mean"] = float(short_valid.mean())
        out["3d_min"] = float(short_valid.min())
        out["3d_max"] = float(short_valid.max())

    if n7 >= config.min_valid:
        mean7 = float(long_valid.mean())
        out["7d_mean"] = mean7
        latest = numeric.dropna()
        if not latest.empty:
            last = float(latest.iloc[-1])
            out["latest"] = last
            out["vs_7d_delta"] = last - mean7
    elif not numeric.dropna().empty:
        out["latest"] = float(numeric.dropna().iloc[-1])

    return out


def compute_rolling_aggregates(
    feature_matrix: pd.DataFrame,
    features: Optional[Iterable[str]] = None,
    *,
    config: RollingWindowConfig = DEFAULT_ROLLING_CONFIG,
) -> Dict[str, Dict[str, Any]]:
    """
    For each key feature, compute rolling aggregates over the matrix.

    Matrix must already be day-validity filtered. Index should be dates ascending.
    Missing days (NaN) are excluded from windows, not zero-filled.

    Returns:
      {
        "sleep_duration_hours": {
          "sleep_duration_hours_3d_mean": ...,
          "sleep_duration_hours_3d_min": ...,
          "sleep_duration_hours_3d_max": ...,
          "sleep_duration_hours_7d_mean": ...,
          "sleep_duration_hours_vs_7d_delta": ...,
          "n_valid_in_window_3d": ...,
          "n_valid_in_window_7d": ...,
          "latest": ...,
        },
        ...
      }
    """
    frame = canonicalize_feature_columns(feature_matrix)
    if not frame.empty:
        frame = frame.sort_index()

    feature_list = list(features) if features is not None else list(KEY_FEATURES)
    result: Dict[str, Dict[str, Any]] = {}

    for feature in feature_list:
        if feature not in frame.columns:
            result[feature] = {
                f"{feature}_3d_mean": None,
                f"{feature}_3d_min": None,
                f"{feature}_3d_max": None,
                f"{feature}_7d_mean": None,
                f"{feature}_vs_7d_delta": None,
                "n_valid_in_window_3d": 0,
                "n_valid_in_window_7d": 0,
                "latest": None,
            }
            continue

        raw = compute_feature_rolling(frame[feature], config=config)
        result[feature] = {
            f"{feature}_3d_mean": raw["3d_mean"],
            f"{feature}_3d_min": raw["3d_min"],
            f"{feature}_3d_max": raw["3d_max"],
            f"{feature}_7d_mean": raw["7d_mean"],
            f"{feature}_vs_7d_delta": raw["vs_7d_delta"],
            "n_valid_in_window_3d": raw["n_valid_3d"],
            "n_valid_in_window_7d": raw["n_valid_7d"],
            "latest": raw["latest"],
        }

    return result

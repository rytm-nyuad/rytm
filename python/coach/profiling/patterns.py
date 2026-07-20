"""Deterministic multi-day pattern detectors for the morning coach.

Input: validity-filtered day×feature matrix + rolling aggregates.
Output: active_patterns — typed dicts. Stateless; recomputed each morning.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Literal, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

from data_prep.rolling_windows import KEY_FEATURES, canonicalize_feature_columns

Trend = Literal["worsening", "stable", "improving"]
Severity = Literal["high", "medium", "low"]
PatternType = Literal[
    "low_streak",
    "high_streak",
    "cumulative_deficit",
    "no_recovery",
    "tracking_gap",
]


@dataclass(frozen=True)
class FeatureThreshold:
    """Per-feature detection config."""

    # Absolute cutoff (used when mode=absolute or as floor/ceiling alongside percentile).
    absolute: Optional[float] = None
    # "absolute" | "p25" | "p75" | "min_absolute_p25" | "max_absolute_p75"
    mode: str = "absolute"
    # Domain for action coverage / router injection.
    domain: str = "recovery"
    # low_streak vs high_streak eligibility
    direction: Literal["low", "high"] = "low"
    unit: str = ""


@dataclass(frozen=True)
class PatternConfig:
    lookback_days: int = 14
    baseline_days: int = 30
    low_streak_k: int = 3
    high_streak_k: int = 3
    deficit_window_days: int = 3
    tracking_gap_window: int = 7
    tracking_gap_missing_m: int = 4
    # Severity: high when streak/deficit days or magnitude exceed these AND trend not improving.
    high_streak_days: int = 3
    high_deficit_hours: float = 3.0
    slope_epsilon: float = 0.05

    features: Dict[str, FeatureThreshold] = field(default_factory=dict)
    # Feature → coaching domain for coverage / router.
    feature_domain_map: Dict[str, str] = field(default_factory=dict)
    # High-severity recovery features that cap energy_mode.
    recovery_cap_features: Tuple[str, ...] = (
        "sleep_duration_hours",
        "hrv_rmssd",
        "sleep_efficiency",
    )


def default_pattern_config() -> PatternConfig:
    features = {
        "sleep_duration_hours": FeatureThreshold(
            absolute=5.0, mode="absolute", domain="recovery", direction="low", unit="hours"
        ),
        "sleep_efficiency": FeatureThreshold(
            absolute=80.0, mode="min_absolute_p25", domain="recovery", direction="low", unit="%"
        ),
        "hrv_rmssd": FeatureThreshold(
            absolute=None, mode="p25", domain="recovery", direction="low", unit="ms"
        ),
        "resting_heart_rate": FeatureThreshold(
            absolute=None, mode="p75", domain="recovery", direction="high", unit="bpm"
        ),
        "steps": FeatureThreshold(
            absolute=4000.0, mode="min_absolute_p25", domain="training", direction="low", unit="steps"
        ),
        "sedentary_minutes": FeatureThreshold(
            absolute=600.0, mode="max_absolute_p75", domain="training", direction="high", unit="minutes"
        ),
        "mood_score": FeatureThreshold(
            absolute=40.0, mode="min_absolute_p25", domain="stress", direction="low", unit="score"
        ),
        "stress_score": FeatureThreshold(
            absolute=70.0, mode="max_absolute_p75", domain="stress", direction="high", unit="score"
        ),
        "energy_score": FeatureThreshold(
            absolute=40.0, mode="min_absolute_p25", domain="recovery", direction="low", unit="score"
        ),
        "focus_score": FeatureThreshold(
            absolute=40.0, mode="min_absolute_p25", domain="focus", direction="low", unit="score"
        ),
        "social_score": FeatureThreshold(
            absolute=40.0, mode="min_absolute_p25", domain="stress", direction="low", unit="score"
        ),
    }
    feature_domain_map = {
        "sleep_duration_hours": "recovery",
        "sleep_efficiency": "recovery",
        "hrv_rmssd": "recovery",
        "resting_heart_rate": "recovery",
        "steps": "training",
        "sedentary_minutes": "training",
        "mood_score": "stress",
        "stress_score": "stress",
        "energy_score": "recovery",
        "focus_score": "focus",
        "social_score": "stress",
    }
    return PatternConfig(features=features, feature_domain_map=feature_domain_map)


DEFAULT_PATTERN_CONFIG = default_pattern_config()


def _percentile(series: pd.Series, q: float) -> Optional[float]:
    valid = pd.to_numeric(series, errors="coerce").dropna()
    if len(valid) < 5:
        return None
    return float(np.nanpercentile(valid.to_numpy(dtype=float), q))


def _resolve_threshold(
    series: pd.Series,
    spec: FeatureThreshold,
) -> Optional[float]:
    p25 = _percentile(series, 25)
    p75 = _percentile(series, 75)
    abs_v = spec.absolute

    if spec.mode == "absolute":
        return abs_v
    if spec.mode == "p25":
        return p25 if p25 is not None else abs_v
    if spec.mode == "p75":
        return p75 if p75 is not None else abs_v
    if spec.mode == "min_absolute_p25":
        candidates = [v for v in (abs_v, p25) if v is not None]
        return min(candidates) if candidates else None
    if spec.mode == "max_absolute_p75":
        candidates = [v for v in (abs_v, p75) if v is not None]
        return max(candidates) if candidates else None
    return abs_v


def _trend_from_values(values: Sequence[float], epsilon: float) -> Trend:
    if len(values) < 2:
        return "stable"
    slope = (float(values[-1]) - float(values[0])) / max(len(values) - 1, 1)
    if slope > epsilon:
        return "improving"
    if slope < -epsilon:
        return "worsening"
    return "stable"


def _low_trend(values: Sequence[float], epsilon: float) -> Trend:
    """For low streaks: decreasing values = worsening."""
    if len(values) < 2:
        return "stable"
    slope = (float(values[-1]) - float(values[0])) / max(len(values) - 1, 1)
    if slope < -epsilon:
        return "worsening"
    if slope > epsilon:
        return "improving"
    return "stable"


def _high_trend(values: Sequence[float], epsilon: float) -> Trend:
    """For high streaks: increasing values = worsening."""
    if len(values) < 2:
        return "stable"
    slope = (float(values[-1]) - float(values[0])) / max(len(values) - 1, 1)
    if slope > epsilon:
        return "worsening"
    if slope < -epsilon:
        return "improving"
    return "stable"


def _severity_for_streak(
    *,
    days: int,
    trend: Trend,
    config: PatternConfig,
    high_days: Optional[int] = None,
) -> Severity:
    threshold_days = high_days if high_days is not None else config.high_streak_days
    if days >= threshold_days and trend != "improving":
        return "high"
    if trend == "improving":
        return "low"
    return "medium"


def _trailing_streak_mask(
    series: pd.Series,
    *,
    below: Optional[float] = None,
    above: Optional[float] = None,
) -> Tuple[List[float], List[Any]]:
    """
    Walk backward from the end. Missing days break the streak (no bridging).
    Returns (values oldest→newest in streak, index labels).
    """
    numeric = pd.to_numeric(series, errors="coerce")
    values: List[float] = []
    labels: List[Any] = []
    for idx in reversed(list(numeric.index)):
        val = numeric.loc[idx]
        if pd.isna(val):
            break
        v = float(val)
        if below is not None and not (v < below):
            break
        if above is not None and not (v > above):
            break
        values.append(v)
        labels.append(idx)
    values.reverse()
    labels.reverse()
    return values, labels


def detect_low_streaks(
    frame: pd.DataFrame,
    config: PatternConfig,
    rolling: Optional[Dict[str, Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    patterns: List[Dict[str, Any]] = []
    for feature, spec in config.features.items():
        if spec.direction != "low" or feature not in frame.columns:
            continue
        threshold = _resolve_threshold(frame[feature], spec)
        if threshold is None:
            continue
        values, _ = _trailing_streak_mask(frame[feature], below=threshold)
        if len(values) < config.low_streak_k:
            continue
        trend = _low_trend(values, config.slope_epsilon)
        roll = _rolling_for_feature(rolling, feature)
        vs7 = roll.get(f"{feature}_vs_7d_delta")
        if vs7 is not None and float(vs7) < -config.slope_epsilon and trend == "stable":
            trend = "worsening"
        patterns.append(_attach_rolling({
            "type": "low_streak",
            "feature": feature,
            "days": len(values),
            "values": [round(v, 2) for v in values],
            "trend": trend,
            "threshold_used": round(float(threshold), 2),
            "severity": _severity_for_streak(days=len(values), trend=trend, config=config),
            "domain": config.feature_domain_map.get(feature, spec.domain),
        }, rolling, feature))
    return patterns


def detect_high_streaks(
    frame: pd.DataFrame,
    config: PatternConfig,
    rolling: Optional[Dict[str, Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    patterns: List[Dict[str, Any]] = []
    for feature, spec in config.features.items():
        if spec.direction != "high" or feature not in frame.columns:
            continue
        threshold = _resolve_threshold(frame[feature], spec)
        if threshold is None:
            continue
        values, _ = _trailing_streak_mask(frame[feature], above=threshold)
        if len(values) < config.high_streak_k:
            continue
        trend = _high_trend(values, config.slope_epsilon)
        roll = _rolling_for_feature(rolling, feature)
        vs7 = roll.get(f"{feature}_vs_7d_delta")
        if vs7 is not None and float(vs7) > config.slope_epsilon and trend == "stable":
            trend = "worsening"
        patterns.append(_attach_rolling({
            "type": "high_streak",
            "feature": feature,
            "days": len(values),
            "values": [round(v, 2) for v in values],
            "trend": trend,
            "threshold_used": round(float(threshold), 2),
            "severity": _severity_for_streak(days=len(values), trend=trend, config=config),
            "domain": config.feature_domain_map.get(feature, spec.domain),
        }, rolling, feature))
    return patterns


def _baseline_mean(series: pd.Series, baseline_days: int) -> Optional[float]:
    numeric = pd.to_numeric(series, errors="coerce").dropna()
    if numeric.empty:
        return None
    window = numeric.iloc[-baseline_days:] if len(numeric) > baseline_days else numeric
    if len(window) < 5:
        return None
    return float(window.mean())


def _rolling_for_feature(
    rolling: Optional[Dict[str, Dict[str, Any]]],
    feature: str,
) -> Dict[str, Any]:
    """Slim rolling snapshot for one feature (only non-null aggregates)."""
    if not rolling or not isinstance(rolling, dict):
        return {}
    payload = rolling.get(feature)
    if not isinstance(payload, dict):
        return {}
    out: Dict[str, Any] = {}
    for key, val in payload.items():
        if val is None:
            continue
        if key in ("n_valid_in_window_3d", "n_valid_in_window_7d"):
            out[key] = int(val)
        elif isinstance(val, (int, float)):
            out[key] = round(float(val), 2)
        else:
            out[key] = val
    return out


def _attach_rolling(
    pattern: Dict[str, Any],
    rolling: Optional[Dict[str, Dict[str, Any]]],
    feature: str,
) -> Dict[str, Any]:
    snap = _rolling_for_feature(rolling, feature)
    if snap:
        pattern["rolling"] = snap
    return pattern


def detect_cumulative_deficit(
    frame: pd.DataFrame,
    config: PatternConfig,
    rolling: Optional[Dict[str, Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    patterns: List[Dict[str, Any]] = []
    # Primary: sleep duration shortfall vs recent typical level.
    feature = "sleep_duration_hours"
    if feature not in frame.columns:
        return patterns
    spec = config.features.get(feature)
    series = pd.to_numeric(frame[feature], errors="coerce")
    roll = _rolling_for_feature(rolling, feature)

    mean3 = roll.get(f"{feature}_3d_mean")
    mean7 = roll.get(f"{feature}_7d_mean")
    n3 = int(roll.get("n_valid_in_window_3d") or 0)

    baseline: Optional[float] = None
    deficit: Optional[float] = None
    baseline_source = "history"

    # Prefer Layer A rolling: 3d mean vs 7d mean × valid days in the short window.
    if mean3 is not None and mean7 is not None and n3 >= 2:
        baseline = float(mean7)
        deficit = (float(mean3) - float(mean7)) * n3
        baseline_source = "rolling_7d_mean"
    else:
        baseline = _baseline_mean(series, config.baseline_days)
        if baseline is None and mean7 is not None:
            baseline = float(mean7)
            baseline_source = "rolling_7d_mean_fallback"
        if baseline is None:
            return patterns
        window = series.iloc[-config.deficit_window_days :]
        valid = window.dropna()
        if len(valid) < 2:
            return patterns
        deficit = float((valid - baseline).sum())
        baseline_source = "history_baseline"

    if deficit is None or deficit >= -0.5:
        return patterns

    window = series.iloc[-config.deficit_window_days :]
    valid = window.dropna()
    trend_vals = [float(v) for v in valid.tolist()] if len(valid) >= 2 else (
        [float(mean3), float(mean7)] if mean3 is not None and mean7 is not None else []
    )
    trend = _low_trend(trend_vals, config.slope_epsilon) if trend_vals else "stable"
    # Corroborate with vs_7d_delta when present.
    vs7 = roll.get(f"{feature}_vs_7d_delta")
    if vs7 is not None and float(vs7) < -config.slope_epsilon and trend == "stable":
        trend = "worsening"

    severity: Severity = "medium"
    if abs(deficit) >= config.high_deficit_hours and trend != "improving":
        severity = "high"
    elif trend == "improving":
        severity = "low"

    patterns.append(_attach_rolling({
        "type": "cumulative_deficit",
        "feature": feature,
        "window_days": n3 if baseline_source.startswith("rolling") and n3 >= 2 else config.deficit_window_days,
        "deficit": round(deficit, 2),
        "unit": (spec.unit if spec else "hours") or "hours",
        "baseline": round(baseline, 2),
        "baseline_source": baseline_source,
        "severity": severity,
        "domain": config.feature_domain_map.get(feature, "recovery"),
        "trend": trend,
    }, rolling, feature))
    return patterns


def detect_no_recovery(
    frame: pd.DataFrame,
    active: List[Dict[str, Any]],
    config: PatternConfig,
    rolling: Optional[Dict[str, Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    patterns: List[Dict[str, Any]] = []
    deficit_or_streak_features = {
        p["feature"]
        for p in active
        if p.get("type") in ("low_streak", "cumulative_deficit") and p.get("feature")
    }
    for feature in deficit_or_streak_features:
        if feature not in frame.columns:
            continue
        series = pd.to_numeric(frame[feature], errors="coerce")
        roll = _rolling_for_feature(rolling, feature)
        baseline = _baseline_mean(series, config.baseline_days)
        if baseline is None:
            mean7 = roll.get(f"{feature}_7d_mean")
            if mean7 is not None:
                baseline = float(mean7)
        if baseline is None:
            continue
        # Walk backward: how many days since last day >= baseline?
        days_since = 0
        found_recovery = False
        for idx in reversed(list(series.index)):
            val = series.loc[idx]
            if pd.isna(val):
                # Missing breaks contiguous count but keep searching for recovery day.
                continue
            if float(val) >= baseline:
                found_recovery = True
                break
            days_since += 1
        if found_recovery or days_since == 0:
            continue
        if days_since < config.low_streak_k:
            continue
        patterns.append(_attach_rolling({
            "type": "no_recovery",
            "feature": feature,
            "days_since_baseline": days_since,
            "baseline": round(baseline, 2),
            "severity": "medium" if days_since < config.high_streak_days + 2 else "high",
            "domain": config.feature_domain_map.get(feature, "recovery"),
        }, rolling, feature))
    return patterns


def detect_tracking_gaps(
    frame: pd.DataFrame,
    config: PatternConfig,
) -> List[Dict[str, Any]]:
    patterns: List[Dict[str, Any]] = []
    if frame.empty:
        return patterns

    window = frame.iloc[-config.tracking_gap_window :]
    n = len(window)
    if n == 0:
        return patterns

    checkin_cols = [
        c for c in ("mood_score", "stress_score", "energy_score", "focus_score", "social_score")
        if c in window.columns
    ]
    wearable_cols = [
        c for c in ("sleep_duration_hours", "steps", "sedentary_minutes", "hrv_rmssd")
        if c in window.columns
    ]

    def _missing_days(cols: List[str]) -> int:
        if not cols:
            return 0
        # Day missing if ALL cols in the block are null.
        block = window[cols]
        return int(block.isna().all(axis=1).sum())

    checkin_missing = _missing_days(checkin_cols)
    if checkin_missing >= config.tracking_gap_missing_m:
        patterns.append({
            "type": "tracking_gap",
            "block": "checkin",
            "missing_days": checkin_missing,
            "window_days": config.tracking_gap_window,
            "severity": "low",
            "domain": "stability",
        })

    wearable_missing = _missing_days(wearable_cols)
    if wearable_missing >= config.tracking_gap_missing_m:
        patterns.append({
            "type": "tracking_gap",
            "block": "wearable",
            "missing_days": wearable_missing,
            "window_days": config.tracking_gap_window,
            "severity": "low",
            "domain": "recovery",
        })

    return patterns


def detect_active_patterns(
    feature_matrix: pd.DataFrame,
    *,
    config: PatternConfig = DEFAULT_PATTERN_CONFIG,
    rolling: Optional[Dict[str, Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """
    Run all five detectors. `feature_matrix` must already be day-validity filtered.
    Uses the last `lookback_days` rows. `rolling` (Layer A) feeds deficit/baseline
    fallbacks and is attached onto emitted patterns as a slim `rolling` snapshot.
    """
    if feature_matrix is None or feature_matrix.empty:
        return []

    frame = canonicalize_feature_columns(feature_matrix).sort_index()
    if config.lookback_days > 0 and len(frame) > config.lookback_days:
        frame = frame.iloc[-config.lookback_days :]

    # Ensure expected columns exist (as NaN) so gap detectors can run.
    for feature in KEY_FEATURES:
        if feature not in frame.columns:
            frame[feature] = np.nan

    # If caller didn't precompute rolling, derive it from the same valid matrix.
    rolling_local = rolling
    if rolling_local is None:
        from data_prep.rolling_windows import compute_rolling_aggregates
        rolling_local = compute_rolling_aggregates(frame, features=KEY_FEATURES)

    active: List[Dict[str, Any]] = []
    active.extend(detect_low_streaks(frame, config, rolling_local))
    active.extend(detect_high_streaks(frame, config, rolling_local))
    active.extend(detect_cumulative_deficit(frame, config, rolling_local))
    active.extend(detect_no_recovery(frame, active, config, rolling_local))
    active.extend(detect_tracking_gaps(frame, config))
    return active


def high_severity_patterns(patterns: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [p for p in patterns if str(p.get("severity") or "").lower() == "high"]


def recovery_energy_cap_required(
    patterns: Sequence[Dict[str, Any]],
    *,
    config: PatternConfig = DEFAULT_PATTERN_CONFIG,
) -> bool:
    """True when a high-severity recovery sleep/HRV pattern should cap energy_mode."""
    recovery_features = set(config.recovery_cap_features)
    for p in patterns:
        if str(p.get("severity") or "").lower() != "high":
            continue
        if p.get("type") not in ("low_streak", "cumulative_deficit", "no_recovery"):
            continue
        if p.get("feature") in recovery_features:
            return True
        if str(p.get("domain") or "").lower() in ("recovery", "sleep"):
            return True
    return False


def domains_for_high_patterns(
    patterns: Sequence[Dict[str, Any]],
    *,
    config: PatternConfig = DEFAULT_PATTERN_CONFIG,
) -> List[str]:
    domains: List[str] = []
    for p in high_severity_patterns(patterns):
        feature = str(p.get("feature") or "")
        domain = (
            p.get("domain")
            or config.feature_domain_map.get(feature)
            or "recovery"
        )
        d = str(domain).lower()
        if d and d not in domains:
            domains.append(d)
    return domains


def pattern_config_as_dict(config: PatternConfig = DEFAULT_PATTERN_CONFIG) -> Dict[str, Any]:
    payload = asdict(config)
    # dataclasses with nested FeatureThreshold already handled by asdict
    return payload

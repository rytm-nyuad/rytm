"""Deterministic post-clustering findings computer (no LLM)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd
from scipy.stats import norm

from profiling.behavior_clustering import (
    CATEGORY_A_FEATURES,
    CATEGORY_B_FEATURES,
    CATEGORY_D_FEATURES,
    KEY_FEATURES_FOR_INTERPRETATION,
)

CONCURRENT_SELFREPORT_FEATURES = {
    "mood",
    "stress",
    "energy",
    "focus",
    "social_connectedness",
    "workload",
    "emotions_count",
}

WEARABLE_BLOCK = sorted(set(CATEGORY_A_FEATURES + CATEGORY_B_FEATURES))
CHECKIN_BLOCK = list(CATEGORY_D_FEATURES)

MIN_N_OBSERVED = 3
MAX_MISSINGNESS = 0.5
SE_THRESHOLD = 2.0
LARGE_SE_THRESHOLD = 4.0
BH_Q = 0.10

FEATURE_SURFACE_FORMS: Dict[str, str] = {
    "overall_score": "overall score",
    "sleep_duration_hours": "sleep duration",
    "sleep_efficiency": "sleep efficiency",
    "deep_ratio": "deep sleep ratio",
    "rem_ratio": "REM sleep ratio",
    "hrv_rmssd": "HRV",
    "readiness_score": "readiness",
    "bedtime_consistency_score": "bedtime consistency",
    "sleep_start_time_variability_7d": "bedtime variability",
    "caffeine_cups": "caffeine intake",
    "steps": "steps",
    "total_active_minutes": "active minutes",
    "sedentary_minutes": "sedentary time",
    "sedentary_burden_score": "sedentary burden",
    "resting_heart_rate": "resting heart rate",
    "breathing_rate": "breathing rate",
    "blood_oxygen_avg": "blood oxygen",
    "calories_out": "calories out",
    "activity_calories": "activity calories",
    "bmr_calories": "BMR calories",
    "mood": "mood",
    "stress": "stress",
    "energy": "energy",
    "focus": "focus",
    "social_connectedness": "social connectedness",
    "workload": "workload",
    "emotions_count": "emotion count",
    "negative_emotion_ratio": "negative emotion ratio",
}


def feature_surface_form(feature: str) -> str:
    return FEATURE_SURFACE_FORMS.get(feature, feature.replace("_", " "))


def _signal_class(feature: str) -> str:
    if feature in CONCURRENT_SELFREPORT_FEATURES:
        return "concurrent_selfreport"
    return "independent_signal"


def _bh_reject(p_values: List[float], q: float = BH_Q) -> List[bool]:
    """Benjamini-Hochberg FDR control. Returns reject flags aligned to p_values."""
    m = len(p_values)
    if m == 0:
        return []
    order = np.argsort(p_values)
    ranked = np.asarray(p_values, dtype=float)[order]
    thresh = q * (np.arange(1, m + 1) / m)
    below = ranked <= thresh
    if not below.any():
        rejected = np.zeros(m, dtype=bool)
    else:
        max_k = int(np.max(np.where(below)[0]))
        rejected_sorted = np.zeros(m, dtype=bool)
        rejected_sorted[: max_k + 1] = True
        rejected = np.zeros(m, dtype=bool)
        rejected[order] = rejected_sorted
    return rejected.tolist()


def _candidate_features(feature_matrix: pd.DataFrame) -> List[str]:
    preferred = [
        f
        for f in KEY_FEATURES_FOR_INTERPRETATION
        if f != "overall_score" and f in feature_matrix.columns
    ]
    extras = [
        c
        for c in feature_matrix.columns
        if c not in preferred
        and c != "overall_score"
        and c != "cluster"
        and pd.api.types.is_numeric_dtype(feature_matrix[c])
    ]
    return preferred + extras


def compute_findings(
    feature_matrix: pd.DataFrame,
    semantic_labels: np.ndarray,
    *,
    features: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    """
    Compute reportable / not_reportable findings and tracking notes per cluster.

    semantic_labels: array of 'cluster_0'|'cluster_1'|'cluster_2' aligned to rows.
    """
    if len(feature_matrix) != len(semantic_labels):
        raise ValueError("feature_matrix and semantic_labels length mismatch")

    work = feature_matrix.copy()
    work["_semantic"] = list(semantic_labels)
    feature_list = list(features) if features is not None else _candidate_features(work)

    # User baselines
    user_stats: Dict[str, Dict[str, Optional[float]]] = {}
    for feat in feature_list:
        series = pd.to_numeric(work[feat], errors="coerce")
        observed = series.dropna()
        user_stats[feat] = {
            "mean": float(observed.mean()) if len(observed) else None,
            "sd": float(observed.std(ddof=1)) if len(observed) > 1 else (
                0.0 if len(observed) == 1 else None
            ),
            "n": int(len(observed)),
        }

    # Collect candidate tests for BH
    candidates: List[Dict[str, Any]] = []
    not_reportable_seed: Dict[str, List[Dict[str, Any]]] = {
        "cluster_0": [],
        "cluster_1": [],
        "cluster_2": [],
    }

    for cluster_key in ("cluster_0", "cluster_1", "cluster_2"):
        cluster_rows = work.loc[work["_semantic"] == cluster_key]
        n_days = int(cluster_rows.shape[0])
        for feat in feature_list:
            series = pd.to_numeric(cluster_rows[feat], errors="coerce")
            observed = series.dropna()
            n_obs = int(len(observed))
            miss_rate = 1.0 - (n_obs / n_days) if n_days else 1.0
            user_mean = user_stats[feat]["mean"]
            user_sd = user_stats[feat]["sd"]

            if n_obs < MIN_N_OBSERVED:
                not_reportable_seed[cluster_key].append(
                    {
                        "feature": feat,
                        "reason": "insufficient_data",
                        "n_observed": n_obs,
                        "missingness_rate": miss_rate,
                    }
                )
                continue
            if miss_rate > MAX_MISSINGNESS:
                not_reportable_seed[cluster_key].append(
                    {
                        "feature": feat,
                        "reason": "high_missingness",
                        "n_observed": n_obs,
                        "missingness_rate": miss_rate,
                    }
                )
                continue
            if user_mean is None or user_sd is None or user_sd == 0:
                not_reportable_seed[cluster_key].append(
                    {
                        "feature": feat,
                        "reason": "no_meaningful_deviation",
                        "n_observed": n_obs,
                        "missingness_rate": miss_rate,
                    }
                )
                continue

            cluster_mean = float(observed.mean())
            se = float(user_sd) / float(np.sqrt(n_obs))
            if se <= 0:
                not_reportable_seed[cluster_key].append(
                    {
                        "feature": feat,
                        "reason": "no_meaningful_deviation",
                        "n_observed": n_obs,
                        "missingness_rate": miss_rate,
                    }
                )
                continue
            z = (cluster_mean - float(user_mean)) / se
            abs_z = abs(z)
            if abs_z < SE_THRESHOLD:
                not_reportable_seed[cluster_key].append(
                    {
                        "feature": feat,
                        "reason": "no_meaningful_deviation",
                        "n_observed": n_obs,
                        "missingness_rate": miss_rate,
                        "abs_se_units": abs_z,
                    }
                )
                continue

            p_value = float(2.0 * (1.0 - norm.cdf(abs_z)))
            candidates.append(
                {
                    "cluster": cluster_key,
                    "feature": feat,
                    "cluster_mean": cluster_mean,
                    "user_mean": float(user_mean),
                    "n_observed": n_obs,
                    "missingness_rate": miss_rate,
                    "n_days": n_days,
                    "z": z,
                    "abs_se_units": abs_z,
                    "p_value": p_value,
                    "signal_class": _signal_class(feat),
                }
            )

    p_vals = [c["p_value"] for c in candidates]
    reject_flags = _bh_reject(p_vals, q=BH_Q)

    reportable: Dict[str, List[Dict[str, Any]]] = {
        "cluster_0": [],
        "cluster_1": [],
        "cluster_2": [],
    }
    not_reportable = {k: list(v) for k, v in not_reportable_seed.items()}

    for cand, ok in zip(candidates, reject_flags):
        cluster_key = cand["cluster"]
        if not ok:
            not_reportable[cluster_key].append(
                {
                    "feature": cand["feature"],
                    "reason": "no_meaningful_deviation",
                    "n_observed": cand["n_observed"],
                    "missingness_rate": cand["missingness_rate"],
                    "note": "failed_bh_correction",
                }
            )
            continue
        direction = (
            "above_user_mean" if cand["z"] > 0 else "below_user_mean"
        )
        magnitude = (
            "large" if cand["abs_se_units"] >= LARGE_SE_THRESHOLD else "moderate"
        )
        reportable[cluster_key].append(
            {
                "feature": cand["feature"],
                "direction": direction,
                "magnitude": magnitude,
                "cluster_mean": cand["cluster_mean"],
                "user_mean": cand["user_mean"],
                "n_observed": cand["n_observed"],
                "missingness_rate": cand["missingness_rate"],
                "signal_class": cand["signal_class"],
                "type": "deviation",
            }
        )

    # Monotone trends across tiers (attached once per cluster in gates)
    trends = _monotone_trends(work, feature_list, user_stats)

    tracking_notes = {
        cluster_key: _tracking_note(work.loc[work["_semantic"] == cluster_key])
        for cluster_key in ("cluster_0", "cluster_1", "cluster_2")
    }

    return {
        "user_baselines": user_stats,
        "reportable_findings": reportable,
        "not_reportable": not_reportable,
        "trends": trends,
        "tracking_notes": tracking_notes,
        "bh_q": BH_Q,
        "n_candidates_tested": len(candidates),
        "n_candidates_passed_bh": int(sum(1 for x in reject_flags if x)),
    }


def _monotone_trends(
    work: pd.DataFrame,
    feature_list: Sequence[str],
    user_stats: Dict[str, Dict[str, Optional[float]]],
) -> List[Dict[str, Any]]:
    trends: List[Dict[str, Any]] = []
    for feat in feature_list:
        means: List[Optional[float]] = []
        ns: List[int] = []
        for cluster_key in ("cluster_0", "cluster_1", "cluster_2"):
            rows = work.loc[work["_semantic"] == cluster_key]
            series = pd.to_numeric(rows[feat], errors="coerce").dropna()
            ns.append(int(len(series)))
            means.append(float(series.mean()) if len(series) else None)

        eligible = [
            (i, means[i], ns[i])
            for i in range(3)
            if means[i] is not None and ns[i] >= MIN_N_OBSERVED
        ]
        if len(eligible) < 2:
            continue
        # Need all three tiers for strict 0→1→2 monotone, or at least 0 and 2
        if means[0] is None or means[2] is None or ns[0] < MIN_N_OBSERVED or ns[2] < MIN_N_OBSERVED:
            continue
        if means[1] is None or ns[1] < MIN_N_OBSERVED:
            # still allow 0-vs-2 if middle missing? Plan: present in >= 2 clusters
            # and strictly monotone across tiers 0→1→2 — require all three.
            continue

        rising = means[0] < means[1] < means[2]
        falling = means[0] > means[1] > means[2]
        if not rising and not falling:
            continue

        user_mean = user_stats[feat]["mean"]
        user_sd = user_stats[feat]["sd"]
        if user_mean is None or user_sd is None or user_sd == 0:
            continue
        # 0-vs-2 contrast with SE based on n of the smaller group
        n_pair = min(ns[0], ns[2])
        se = float(user_sd) / float(np.sqrt(n_pair))
        if se <= 0:
            continue
        z = (float(means[2]) - float(means[0])) / se
        if abs(z) < SE_THRESHOLD:
            continue

        trends.append(
            {
                "feature": feat,
                "type": "trend",
                "direction": "rises_with_tier" if rising else "falls_with_tier",
                "magnitude": "large" if abs(z) >= LARGE_SE_THRESHOLD else "moderate",
                "cluster_mean": float(means[2]),
                "user_mean": float(user_mean),
                "tier_means": {
                    "cluster_0": means[0],
                    "cluster_1": means[1],
                    "cluster_2": means[2],
                },
                "n_observed": n_pair,
                "missingness_rate": None,
                "signal_class": _signal_class(feat),
            }
        )
    return trends


def _block_mean_missingness(rows: pd.DataFrame, cols: Sequence[str]) -> Optional[float]:
    present_cols = [c for c in cols if c in rows.columns]
    if not present_cols or rows.empty:
        return None
    rates = []
    for c in present_cols:
        series = pd.to_numeric(rows[c], errors="coerce")
        rates.append(float(series.isna().mean()))
    return float(np.mean(rates)) if rates else None


def _tracking_note(cluster_rows: pd.DataFrame) -> Optional[str]:
    if cluster_rows.empty:
        return None
    checkin_miss = _block_mean_missingness(cluster_rows, CHECKIN_BLOCK)
    wearable_miss = _block_mean_missingness(cluster_rows, WEARABLE_BLOCK)

    if checkin_miss is not None and wearable_miss is not None:
        if checkin_miss > 0.5 and wearable_miss <= 0.5:
            return "Check-ins were skipped on most of these days."
        if wearable_miss > 0.5 and checkin_miss <= 0.5:
            return "Wearable data was missing on most of these days."
    elif checkin_miss is not None and checkin_miss > 0.5:
        return "Check-ins were skipped on most of these days."
    elif wearable_miss is not None and wearable_miss > 0.5:
        return "Wearable data was missing on most of these days."
    return None

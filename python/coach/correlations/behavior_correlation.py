"""
Within-user Spearman correlation heatmaps for behavioral archetypes.

Filters junk days, trusts only cells with enough pair-days and |rho| >= threshold,
and computes distinctiveness vs a cached cohort baseline when available.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from supabase import Client

from profiling.behavior_clustering import (
    MIN_DAYS_FOR_CLUSTERING,
    InsufficientDataError,
    fetch_feature_matrix,
)

CORRELATION_FEATURE_KEYS = [
    "overall_score",
    "readiness_score",
    "sleep_duration_hours",
    "sleep_efficiency",
    "hrv_rmssd",
    "total_active_minutes",
    "sedentary_minutes",
    "social_connectedness",
    "mood",
    "stress",
    "energy",
    "focus",
    "caffeine_cups",
    "negative_emotion_ratio",
]

# Trust thresholds for Spearman cells (pair-complete days only).
# n≈15 + |ρ|≥0.4 is a product heuristic from the archetype design brief:
# below that, informal interpretation can't reliably separate signal from noise.
MIN_PAIR_DAYS = 15
MIN_ABS_RHO = 0.4
MIN_TRUSTED_EDGES = 2
TOP_DISTINCTIVE_EDGES = 12
MIN_COHORT_USERS_PER_CELL = 3


@dataclass
class CorrelationResult:
    days_used: int
    days_after_junk_filter: int
    junk_days_dropped: int
    data_window_start: str
    data_window_end: str
    feature_keys: List[str]
    heatmap: Dict[str, Any]
    trusted_edges: List[Dict[str, Any]]
    distinctive_edges: List[Dict[str, Any]]
    correlation_metadata: Dict[str, Any]
    quality_evaluation: Dict[str, Any] = field(default_factory=dict)


def _pair_key(a: str, b: str) -> str:
    return "|".join(sorted([a, b]))


def _feature_label(a: str, b: str) -> str:
    return f"{a}–{b}"


def is_junk_day(row: pd.Series) -> bool:
    """No day-level junk filters currently applied."""
    return False


def filter_junk_days(matrix: pd.DataFrame) -> Tuple[pd.DataFrame, int]:
    """Identity pass-through (junk filters disabled)."""
    if matrix.empty:
        return matrix, 0
    return matrix.copy(), 0


def fetch_correlation_feature_matrix(client: Client, user_id: str) -> pd.DataFrame:
    """Load correlation features and pivot."""
    keys = list(CORRELATION_FEATURE_KEYS)
    # Reuse clustering fetch then subset — clustering keys include all needed.
    full = fetch_feature_matrix(client, user_id)
    available = [k for k in keys if k in full.columns]
    if not available:
        raise InsufficientDataError("No correlation feature columns found for user")
    return full[available].copy()


def compute_spearman_heatmap(
    matrix: pd.DataFrame,
    feature_keys: Optional[List[str]] = None,
    *,
    min_pair_days: int = MIN_PAIR_DAYS,
    min_abs_rho: float = MIN_ABS_RHO,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    keys = feature_keys or [
        k for k in CORRELATION_FEATURE_KEYS if k in matrix.columns
    ]
    cells: List[Dict[str, Any]] = []
    trusted_edges: List[Dict[str, Any]] = []

    for i, a in enumerate(keys):
        for j, b in enumerate(keys):
            if i == j:
                cells.append(
                    {
                        "feature_a": a,
                        "feature_b": b,
                        "rho": 1.0,
                        "n_pairs": int(matrix[a].notna().sum()) if a in matrix.columns else 0,
                        "trusted": False,
                        "diagonal": True,
                    }
                )
                continue
            if i > j:
                # Store upper triangle only once; mirror later for UI if needed.
                continue

            if a not in matrix.columns or b not in matrix.columns:
                cells.append(
                    {
                        "feature_a": a,
                        "feature_b": b,
                        "rho": None,
                        "n_pairs": 0,
                        "trusted": False,
                        "diagonal": False,
                    }
                )
                continue

            pair = matrix[[a, b]].dropna()
            n_pairs = int(len(pair))
            rho: Optional[float] = None
            if n_pairs >= 3:
                try:
                    # Spearman via Pearson of ranks (no scipy dependency).
                    corr = float(pair[a].rank().corr(pair[b].rank()))
                    if not np.isnan(corr):
                        rho = corr
                except Exception:
                    rho = None

            trusted = (
                rho is not None
                and n_pairs >= min_pair_days
                and abs(rho) >= min_abs_rho
            )
            cell = {
                "feature_a": a,
                "feature_b": b,
                "rho": rho,
                "n_pairs": n_pairs,
                "trusted": trusted,
                "diagonal": False,
            }
            cells.append(cell)
            if trusted and rho is not None:
                trusted_edges.append(
                    {
                        "feature_a": a,
                        "feature_b": b,
                        "pair": _feature_label(a, b),
                        "pair_key": _pair_key(a, b),
                        "rho": round(rho, 4),
                        "n_pairs": n_pairs,
                    }
                )

    trusted_edges.sort(key=lambda e: abs(e["rho"]), reverse=True)
    heatmap = {
        "feature_keys": keys,
        "cells": cells,
        "min_pair_days": min_pair_days,
        "min_abs_rho": min_abs_rho,
    }
    return heatmap, trusted_edges


def compute_distinctive_edges(
    trusted_edges: List[Dict[str, Any]],
    cohort_baseline: Optional[Dict[str, Any]],
    *,
    top_n: int = TOP_DISTINCTIVE_EDGES,
    min_cohort_users: int = MIN_COHORT_USERS_PER_CELL,
) -> Tuple[List[Dict[str, Any]], bool]:
    if not cohort_baseline:
        return [], False

    mean_rho = cohort_baseline.get("mean_rho_json") or {}
    n_users = cohort_baseline.get("n_users_json") or {}
    if not isinstance(mean_rho, dict):
        return [], False

    distinctive: List[Dict[str, Any]] = []
    for edge in trusted_edges:
        key = edge.get("pair_key") or _pair_key(edge["feature_a"], edge["feature_b"])
        cohort_n = int(n_users.get(key) or 0)
        if cohort_n < min_cohort_users:
            continue
        cohort_rho = mean_rho.get(key)
        if cohort_rho is None:
            continue
        try:
            cohort_rho_f = float(cohort_rho)
        except (TypeError, ValueError):
            continue
        user_rho = float(edge["rho"])
        delta = user_rho - cohort_rho_f
        distinctive.append(
            {
                **edge,
                "cohort_rho": round(cohort_rho_f, 4),
                "delta": round(delta, 4),
                "cohort_n_users": cohort_n,
                "vs_typical": f"{delta:+.2f}",
            }
        )

    distinctive.sort(key=lambda e: abs(e["delta"]), reverse=True)
    return distinctive[:top_n], True


def evaluate_correlation_quality(
    *,
    days_used: int,
    days_after_junk: int,
    trusted_edges: List[Dict[str, Any]],
    feature_keys: List[str],
) -> Dict[str, Any]:
    n_trusted = len(trusted_edges)
    n_features = len(feature_keys)
    max_off_diag = max(n_features * (n_features - 1) // 2, 1)
    density = n_trusted / max_off_diag

    rejection_reasons: List[str] = []
    warnings: List[str] = []

    if days_used < MIN_DAYS_FOR_CLUSTERING:
        rejection_reasons.append(
            f"insufficient_feature_days:{days_used}<{MIN_DAYS_FOR_CLUSTERING}"
        )
    if days_after_junk < MIN_DAYS_FOR_CLUSTERING:
        rejection_reasons.append(
            f"insufficient_days_after_junk_filter:{days_after_junk}<{MIN_DAYS_FOR_CLUSTERING}"
        )
    if n_trusted < MIN_TRUSTED_EDGES:
        rejection_reasons.append(
            f"insufficient_trusted_edges:{n_trusted}<{MIN_TRUSTED_EDGES}"
        )
    if density < 0.05 and n_trusted >= MIN_TRUSTED_EDGES:
        warnings.append(f"low_trusted_density:{density:.3f}")

    return {
        "passed": len(rejection_reasons) == 0,
        "rejection_reasons": rejection_reasons,
        "warnings": warnings,
        "trusted_edge_count": n_trusted,
        "trusted_density": round(density, 4),
        "min_trusted_edges": MIN_TRUSTED_EDGES,
        "min_pair_days": MIN_PAIR_DAYS,
        "min_abs_rho": MIN_ABS_RHO,
        "days_used": days_used,
        "days_after_junk_filter": days_after_junk,
    }


def run_user_correlation(
    client: Client,
    user_id: str,
    *,
    cohort_baseline: Optional[Dict[str, Any]] = None,
) -> CorrelationResult:
    from correlations.correlation_archetype_store import get_latest_cohort_baseline

    matrix = fetch_correlation_feature_matrix(client, user_id)
    if matrix.shape[0] < MIN_DAYS_FOR_CLUSTERING:
        raise InsufficientDataError(
            f"Need at least {MIN_DAYS_FOR_CLUSTERING} feature days, got {matrix.shape[0]}"
        )

    days_used = int(matrix.shape[0])
    filtered, junk_dropped = filter_junk_days(matrix)
    if filtered.shape[0] < MIN_DAYS_FOR_CLUSTERING:
        # Still produce a result so quality gate can reject honestly.
        feature_keys = [k for k in CORRELATION_FEATURE_KEYS if k in filtered.columns]
        heatmap, trusted = compute_spearman_heatmap(filtered, feature_keys)
        quality = evaluate_correlation_quality(
            days_used=days_used,
            days_after_junk=int(filtered.shape[0]),
            trusted_edges=trusted,
            feature_keys=feature_keys,
        )
        window_start = str(matrix.index.min().date())
        window_end = str(matrix.index.max().date())
        return CorrelationResult(
            days_used=days_used,
            days_after_junk_filter=int(filtered.shape[0]),
            junk_days_dropped=junk_dropped,
            data_window_start=window_start,
            data_window_end=window_end,
            feature_keys=feature_keys,
            heatmap=heatmap,
            trusted_edges=trusted,
            distinctive_edges=[],
            correlation_metadata={
                "method": "spearman",
                "junk_filters": [],
                "distinctiveness_available": False,
            },
            quality_evaluation=quality,
        )

    feature_keys = [k for k in CORRELATION_FEATURE_KEYS if k in filtered.columns]
    heatmap, trusted = compute_spearman_heatmap(filtered, feature_keys)

    baseline = cohort_baseline
    if baseline is None:
        try:
            baseline = get_latest_cohort_baseline(client)
        except Exception:
            baseline = None

    distinctive, distinctiveness_available = compute_distinctive_edges(
        trusted, baseline
    )
    quality = evaluate_correlation_quality(
        days_used=days_used,
        days_after_junk=int(filtered.shape[0]),
        trusted_edges=trusted,
        feature_keys=feature_keys,
    )

    window_start = str(filtered.index.min().date())
    window_end = str(filtered.index.max().date())

    return CorrelationResult(
        days_used=days_used,
        days_after_junk_filter=int(filtered.shape[0]),
        junk_days_dropped=junk_dropped,
        data_window_start=window_start,
        data_window_end=window_end,
        feature_keys=feature_keys,
        heatmap=heatmap,
        trusted_edges=trusted,
        distinctive_edges=distinctive,
        correlation_metadata={
            "method": "spearman",
            "junk_filters": [],
            "junk_days_dropped": junk_dropped,
            "distinctiveness_available": distinctiveness_available,
            "cohort_baseline_id": (baseline or {}).get("baseline_id"),
            "cohort_baseline_version": (baseline or {}).get("baseline_version"),
            "feature_keys": feature_keys,
            "quality_thresholds": {
                "min_pair_days": MIN_PAIR_DAYS,
                "min_abs_rho": MIN_ABS_RHO,
                "min_trusted_edges": MIN_TRUSTED_EDGES,
            },
        },
        quality_evaluation=quality,
    )

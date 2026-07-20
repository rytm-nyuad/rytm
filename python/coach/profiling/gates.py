"""Status assigner, OS-tier permutation test, and interpreter package assembly."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

N_PERMUTATIONS = 1000
PERM_PERCENTILE = 95.0
PERM_RANDOM_STATE = 42
MIN_CLUSTER_DAYS = 5
MIN_REPORTABLE_FINDINGS = 2


def assign_cluster_status(
    *,
    n_days: int,
    reportable_findings: List[Dict[str, Any]],
) -> str:
    """
    insufficient_data iff n_days < 5 OR fewer than 2 reportable findings
    OR zero independent_signal findings. Otherwise interpreted.
    """
    if n_days < MIN_CLUSTER_DAYS:
        return "insufficient_data"
    if len(reportable_findings) < MIN_REPORTABLE_FINDINGS:
        return "insufficient_data"
    independent = [
        f
        for f in reportable_findings
        if f.get("signal_class") == "independent_signal"
    ]
    if not independent:
        return "insufficient_data"
    return "interpreted"


def os_spread(means: List[float]) -> float:
    return float(max(means) - min(means)) if means else 0.0


def permutation_os_tiers_meaningful(
    overall_scores: np.ndarray,
    semantic_labels: np.ndarray,
    *,
    n_permutations: int = N_PERMUTATIONS,
    percentile: float = PERM_PERCENTILE,
    random_state: int = PERM_RANDOM_STATE,
) -> Dict[str, Any]:
    """
    Hold cluster sizes fixed, shuffle day→cluster assignments, compare OS spread.
    True iff observed spread > percentile of null.
    """
    labels = np.asarray(semantic_labels)
    scores = np.asarray(overall_scores, dtype=float)
    if len(labels) != len(scores):
        raise ValueError("labels/scores length mismatch")

    cluster_keys = ("cluster_0", "cluster_1", "cluster_2")
    observed_means = []
    sizes = []
    for key in cluster_keys:
        mask = labels == key
        sizes.append(int(mask.sum()))
        vals = scores[mask]
        observed_means.append(float(np.nanmean(vals)) if mask.any() else float("nan"))

    if any(np.isnan(observed_means)) or sum(sizes) < 3:
        return {
            "os_tiers_meaningful": False,
            "observed_spread": None,
            "null_percentile": None,
            "null_quantile_value": None,
            "n_permutations": n_permutations,
            "reason": "degenerate_tiers",
        }

    observed = os_spread(observed_means)
    rng = np.random.RandomState(random_state)
    null_spreads: List[float] = []

    for _ in range(n_permutations):
        shuffled = rng.permutation(scores)
        # Reconstruct fixed-size tiers from shuffled scores in order of keys
        cursor = 0
        means = []
        for size in sizes:
            chunk = shuffled[cursor : cursor + size]
            cursor += size
            means.append(float(np.mean(chunk)) if size else float("nan"))
        null_spreads.append(os_spread(means))

    null_q = float(np.percentile(null_spreads, percentile))
    meaningful = bool(observed > null_q)
    return {
        "os_tiers_meaningful": meaningful,
        "observed_spread": observed,
        "null_percentile": percentile,
        "null_quantile_value": null_q,
        "n_permutations": n_permutations,
        "observed_tier_means": {
            cluster_keys[i]: observed_means[i] for i in range(3)
        },
        "cluster_sizes": {cluster_keys[i]: sizes[i] for i in range(3)},
    }


def build_interpreter_package(
    *,
    days_used: int,
    data_window_start: str,
    data_window_end: str,
    feature_matrix: pd.DataFrame,
    semantic_labels: np.ndarray,
    findings: Dict[str, Any],
    quality_warnings: Optional[List[str]] = None,
    monitoring: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Assemble the pre-digested package for the v2 interpreter."""
    scores = feature_matrix["overall_score"].astype(float).to_numpy()
    perm = permutation_os_tiers_meaningful(scores, semantic_labels)

    tier_summary = {
        key: {
            "n_days": int((semantic_labels == key).sum()),
            "mean_overall_score": (
                float(scores[semantic_labels == key].mean())
                if (semantic_labels == key).any()
                else None
            ),
        }
        for key in ("cluster_0", "cluster_1", "cluster_2")
    }

    clusters: Dict[str, Any] = {}
    trends = list(findings.get("trends") or [])
    for key in ("cluster_0", "cluster_1", "cluster_2"):
        reportable = list((findings.get("reportable_findings") or {}).get(key) or [])
        # Attach cross-tier trends to each cluster once for interpreter visibility.
        reportable.extend(dict(t) for t in trends)
        n_days = int(tier_summary[key]["n_days"])
        status = assign_cluster_status(n_days=n_days, reportable_findings=reportable)
        clusters[key] = {
            "status": status,
            "n_days": n_days,
            "reportable_findings": reportable,
            "not_reportable": list(
                (findings.get("not_reportable") or {}).get(key) or []
            ),
            "tracking_note": (findings.get("tracking_notes") or {}).get(key),
        }

    package = {
        "days_used": days_used,
        "data_window_start": data_window_start,
        "data_window_end": data_window_end,
        "os_tiers_meaningful": bool(perm.get("os_tiers_meaningful")),
        "tier_summary": tier_summary,
        "clusters": clusters,
        "quality_warnings": list(quality_warnings or []),
        "permutation_test": {
            "observed_spread": perm.get("observed_spread"),
            "null_percentile": perm.get("null_percentile"),
            "null_quantile_value": perm.get("null_quantile_value"),
            "n_permutations": perm.get("n_permutations"),
        },
        "monitoring": monitoring or {},
    }
    return package

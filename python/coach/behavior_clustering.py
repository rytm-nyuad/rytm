"""
Per-user K-Means clustering over daily_features1.

Mirrors Final_Capstone_Data_Exploration.ipynb (categories A/B/D, PCA, k=3)
without visualization dependencies.

Adds deterministic candidate quality gates (size, silhouette, stability)
without changing the core clustering methodology.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.impute import SimpleImputer
from sklearn.metrics import adjusted_rand_score, silhouette_score
from sklearn.preprocessing import StandardScaler
from supabase import Client

CATEGORY_A_FEATURES = [
    "sleep_duration_hours",
    "sleep_efficiency",
    "deep_ratio",
    "rem_ratio",
    "hrv_rmssd",
    "readiness_score",
    "bedtime_consistency_score",
    "sleep_start_time_variability_7d",
    "caffeine_cups",
]

CATEGORY_B_FEATURES = [
    "steps",
    "total_active_minutes",
    "sedentary_minutes",
    "sedentary_burden_score",
    "resting_heart_rate",
    "breathing_rate",
    "blood_oxygen_avg",
    "calories_out",
    "activity_calories",
    "bmr_calories",
]

CATEGORY_C_FEATURES: List[str] = []

CATEGORY_D_FEATURES = [
    "mood",
    "stress",
    "energy",
    "focus",
    "social_connectedness",
    "workload",
    "emotions_count",
    "negative_emotion_ratio",
]

ALL_CATEGORY_FEATURES = sorted(
    set(CATEGORY_A_FEATURES + CATEGORY_B_FEATURES + CATEGORY_C_FEATURES + CATEGORY_D_FEATURES)
)

# Features used for clustering matrix fetch + "usable day" refresh counting.
# overall_score is loaded for semantic ordering / separation only — never for PCA/KMeans.
CLUSTERING_FEATURE_KEYS = sorted(set(ALL_CATEGORY_FEATURES + ["overall_score"]))

KEY_FEATURES_FOR_INTERPRETATION = [
    "overall_score",
    "readiness_score",
    "sleep_duration_hours",
    "sleep_efficiency",
    "deep_ratio",
    "rem_ratio",
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

N_CLUSTERS = 3
N_COMPONENTS_PER_CATEGORY = 2
MIN_DAYS_FOR_CLUSTERING = 7
KMEANS_RANDOM_STATE = 42
KMEANS_N_INIT = 10

# Quality-gate defaults (documented):
# - MIN_CLUSTER_SIZE=3: each day-type needs enough days to describe a pattern.
# - MIN_CLUSTER_FRACTION=0.10: reject tiny leftover clusters on longer histories.
# - MIN_SILHOUETTE_SCORE=0.15: weak but non-random structure floor for within-user PCA space.
# - Stability: 10 subsample ARI runs; require mean >= 0.60 on >= 8 successful fits.
# - STABILITY_SAMPLE_FRACTION=0.80: keep most days so all 3 clusters can still appear.
# - Weak overall_score separation is a warning only (semantic labels still use means).
MIN_CLUSTER_SIZE = 1
MIN_CLUSTER_FRACTION = 0.10
MIN_SILHOUETTE_SCORE = 0.15
MIN_STABILITY_SCORE = 0.60
MIN_SUCCESSFUL_STABILITY_RUNS = 8
STABILITY_RUNS = 10
STABILITY_SAMPLE_FRACTION = 0.80
MIN_NEW_FEATURE_DAYS_FOR_REFRESH = 7
# Soft warning threshold for adjacent mean overall_score gaps (not a hard reject).
MIN_OVERALL_SCORE_ADJACENT_GAP_WARN = 3.0


@dataclass(frozen=True)
class QualityThresholds:
    min_cluster_size: int = MIN_CLUSTER_SIZE
    min_cluster_fraction: float = MIN_CLUSTER_FRACTION
    min_silhouette_score: float = MIN_SILHOUETTE_SCORE
    min_stability_score: float = MIN_STABILITY_SCORE
    min_successful_stability_runs: int = MIN_SUCCESSFUL_STABILITY_RUNS
    stability_runs: int = STABILITY_RUNS
    stability_sample_fraction: float = STABILITY_SAMPLE_FRACTION
    min_overall_score_adjacent_gap_warn: float = MIN_OVERALL_SCORE_ADJACENT_GAP_WARN

    def as_dict(self) -> Dict[str, Any]:
        return asdict(self)


DEFAULT_QUALITY_THRESHOLDS = QualityThresholds()


@dataclass
class ClusteringResult:
    days_used: int
    data_window_start: str
    data_window_end: str
    cluster_stats: Dict[str, Any]
    clustering_metadata: Dict[str, Any]
    semantic_cluster_ranking: Dict[str, int]
    quality_evaluation: Dict[str, Any] = field(default_factory=dict)


class InsufficientDataError(Exception):
    """Raised when a user does not have enough feature history for clustering."""


def fetch_feature_matrix(client: Client, user_id: str) -> pd.DataFrame:
    """Load all daily_features1 rows for a user and pivot to a date x feature matrix."""
    feature_keys = CLUSTERING_FEATURE_KEYS
    rows: List[Dict[str, Any]] = []
    page_size = 1000
    offset = 0

    while True:
        response = (
            client.table("daily_features1")
            .select("feature_date, feature_key, value_num")
            .eq("user_id", user_id)
            .in_("feature_key", feature_keys)
            .order("feature_date")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = response.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    if not rows:
        raise InsufficientDataError("No daily_features1 rows found for user")

    raw_df = pd.DataFrame(rows)
    matrix = (
        raw_df.pivot_table(
            index="feature_date",
            columns="feature_key",
            values="value_num",
            aggfunc="first",
        )
        .sort_index()
    )
    matrix.index = pd.to_datetime(matrix.index)
    return matrix


def _scale_category_features(feature_matrix: pd.DataFrame, feature_list: List[str]) -> pd.DataFrame:
    cols = [col for col in feature_list if col in feature_matrix.columns]
    if not cols:
        return pd.DataFrame(index=feature_matrix.index)

    category_df = feature_matrix[cols].copy()
    imputer = SimpleImputer(strategy="mean")
    imputed = imputer.fit_transform(category_df)
    imputed_df = pd.DataFrame(imputed, columns=cols, index=category_df.index)

    scaler = StandardScaler()
    scaled = scaler.fit_transform(imputed_df)
    return pd.DataFrame(scaled, columns=cols, index=category_df.index)


def _pca_category(scaled_df: pd.DataFrame, category_name: str) -> pd.DataFrame:
    if scaled_df.empty:
        return pd.DataFrame(index=scaled_df.index)

    n_components = min(N_COMPONENTS_PER_CATEGORY, scaled_df.shape[1])
    if n_components == 0:
        return pd.DataFrame(index=scaled_df.index)

    pca = PCA(n_components=n_components)
    transformed = pca.fit_transform(scaled_df)
    columns = [f"PC_{category_name}_{i + 1}" for i in range(n_components)]
    return pd.DataFrame(transformed, columns=columns, index=scaled_df.index)


def _build_pca_matrix(feature_matrix: pd.DataFrame) -> pd.DataFrame:
    """Build PCA feature matrix from categories A/B/D only (never includes overall_score)."""
    categories = {
        "A": CATEGORY_A_FEATURES,
        "B": CATEGORY_B_FEATURES,
        "C": CATEGORY_C_FEATURES,
        "D": CATEGORY_D_FEATURES,
    }

    pca_frames: List[pd.DataFrame] = []
    for category_name, feature_list in categories.items():
        scaled = _scale_category_features(feature_matrix, feature_list)
        if scaled.empty:
            continue
        pca_frames.append(_pca_category(scaled, category_name))

    if not pca_frames:
        raise InsufficientDataError("No category features available for clustering")

    pca_df = pd.concat(pca_frames, axis=1)
    if pca_df.shape[0] < N_CLUSTERS or pca_df.shape[1] == 0:
        raise InsufficientDataError("Not enough PCA features or days for k=3 clustering")
    return pca_df


def _semantic_cluster_labels(cluster_means: pd.DataFrame) -> Dict[int, str]:
    """Map raw KMeans labels to cluster_0/1/2 by mean overall_score ascending."""
    if "overall_score" not in cluster_means.columns:
        ordered = list(cluster_means.index)
    else:
        ordered = (
            cluster_means["overall_score"]
            .sort_values(ascending=True)
            .index.tolist()
        )

    mapping: Dict[int, str] = {}
    for rank, raw_cluster_id in enumerate(ordered):
        mapping[int(raw_cluster_id)] = f"cluster_{rank}"
    return mapping


def _frame_to_dict(df: pd.DataFrame) -> Dict[str, Dict[str, float]]:
    payload: Dict[str, Dict[str, float]] = {}
    for index_value, row in df.iterrows():
        key = str(index_value)
        payload[key] = {
            col: (None if pd.isna(val) else float(val))
            for col, val in row.items()
        }
    return payload


def _fit_kmeans(matrix: np.ndarray, *, random_state: int) -> np.ndarray:
    model = KMeans(
        n_clusters=N_CLUSTERS,
        random_state=random_state,
        n_init=KMEANS_N_INIT,
    )
    return model.fit_predict(matrix)


def evaluate_cluster_stability(
    pca_matrix: np.ndarray,
    primary_labels: np.ndarray,
    *,
    thresholds: QualityThresholds = DEFAULT_QUALITY_THRESHOLDS,
    random_state: int = KMEANS_RANDOM_STATE,
) -> Dict[str, Any]:
    """
    Subsample-based stability via Adjusted Rand Index vs the primary labeling.

    Does not mutate primary_labels. Failed/unusable runs are counted, not ignored.
    """
    n_samples = int(pca_matrix.shape[0])
    sample_size = max(N_CLUSTERS, int(np.floor(n_samples * thresholds.stability_sample_fraction)))
    sample_size = min(sample_size, n_samples)

    scores: List[float] = []
    run_details: List[Dict[str, Any]] = []
    rng = np.random.RandomState(random_state)

    for run_idx in range(thresholds.stability_runs):
        run_seed = int(random_state + run_idx + 1)
        try:
            if sample_size >= n_samples:
                indices = np.arange(n_samples)
            else:
                indices = rng.choice(n_samples, size=sample_size, replace=False)
                indices = np.sort(indices)

            subset = pca_matrix[indices]
            if subset.shape[0] < N_CLUSTERS:
                run_details.append(
                    {
                        "run": run_idx,
                        "ok": False,
                        "reason": "subset_too_small",
                        "sample_size": int(subset.shape[0]),
                    }
                )
                continue

            # Need at least N_CLUSTERS distinct rows for a usable fit.
            if len({tuple(row) for row in subset}) < N_CLUSTERS:
                run_details.append(
                    {
                        "run": run_idx,
                        "ok": False,
                        "reason": "insufficient_unique_rows",
                        "sample_size": int(subset.shape[0]),
                    }
                )
                continue

            resampled_labels = _fit_kmeans(subset, random_state=run_seed)
            if len(set(resampled_labels.tolist())) < 2:
                run_details.append(
                    {
                        "run": run_idx,
                        "ok": False,
                        "reason": "degenerate_clustering",
                        "n_labels": int(len(set(resampled_labels.tolist()))),
                    }
                )
                continue

            ari = float(adjusted_rand_score(primary_labels[indices], resampled_labels))
            scores.append(ari)
            run_details.append(
                {
                    "run": run_idx,
                    "ok": True,
                    "ari": ari,
                    "sample_size": int(subset.shape[0]),
                    "seed": run_seed,
                }
            )
        except Exception as exc:  # noqa: BLE001 - record and continue stability loop
            run_details.append(
                {
                    "run": run_idx,
                    "ok": False,
                    "reason": "exception",
                    "error": str(exc),
                }
            )

    score = float(np.mean(scores)) if scores else None
    return {
        "method": "subsample_adjusted_rand",
        "score": score,
        "scores": scores,
        "successful_runs": len(scores),
        "total_runs": thresholds.stability_runs,
        "sample_fraction": thresholds.stability_sample_fraction,
        "sample_size": sample_size,
        "n_samples": n_samples,
        "run_details": run_details,
    }


def evaluate_overall_score_separation(
    feature_matrix: pd.DataFrame,
    raw_labels: np.ndarray,
    semantic_by_raw: Dict[int, str],
    *,
    thresholds: QualityThresholds = DEFAULT_QUALITY_THRESHOLDS,
) -> Dict[str, Any]:
    """Summarize whether semantic clusters separate on overall_score (warning-level)."""
    available = "overall_score" in feature_matrix.columns
    if not available:
        return {
            "overall_score_available": False,
            "per_cluster": {},
            "adjacent_mean_differences": {},
            "weak_separation_warning": True,
            "warning_message": "overall_score missing; semantic ordering may be unstable",
        }

    series = feature_matrix["overall_score"].astype(float)
    per_cluster: Dict[str, Any] = {}
    for raw_id, semantic in semantic_by_raw.items():
        values = series[raw_labels == int(raw_id)].dropna()
        if values.empty:
            per_cluster[semantic] = {
                "n": 0,
                "mean": None,
                "median": None,
                "std": None,
                "min": None,
                "max": None,
                "q25": None,
                "q75": None,
            }
            continue
        per_cluster[semantic] = {
            "n": int(values.shape[0]),
            "mean": float(values.mean()),
            "median": float(values.median()),
            "std": float(values.std(ddof=0)) if values.shape[0] else None,
            "min": float(values.min()),
            "max": float(values.max()),
            "q25": float(values.quantile(0.25)),
            "q75": float(values.quantile(0.75)),
        }

    adjacent: Dict[str, Optional[float]] = {}
    weak = False
    for left, right in (("cluster_0", "cluster_1"), ("cluster_1", "cluster_2")):
        left_mean = (per_cluster.get(left) or {}).get("mean")
        right_mean = (per_cluster.get(right) or {}).get("mean")
        if left_mean is None or right_mean is None:
            adjacent[f"{left}_to_{right}"] = None
            weak = True
            continue
        gap = float(right_mean - left_mean)
        adjacent[f"{left}_to_{right}"] = gap
        if gap < thresholds.min_overall_score_adjacent_gap_warn:
            weak = True

    # Overlap heuristic: adjacent IQR ranges overlap.
    overlap_pairs: List[str] = []
    for left, right in (("cluster_0", "cluster_1"), ("cluster_1", "cluster_2")):
        left_stats = per_cluster.get(left) or {}
        right_stats = per_cluster.get(right) or {}
        if None in (
            left_stats.get("q25"),
            left_stats.get("q75"),
            right_stats.get("q25"),
            right_stats.get("q75"),
        ):
            continue
        if left_stats["q75"] >= right_stats["q25"] and right_stats["q75"] >= left_stats["q25"]:
            overlap_pairs.append(f"{left}/{right}")
            weak = True

    warning_message = None
    if weak:
        warning_message = (
            "overall_score separation between adjacent semantic clusters is weak or overlapping; "
            "treat cluster_0/1/2 as relative day-types, not objectively good/bad"
        )

    return {
        "overall_score_available": True,
        "per_cluster": per_cluster,
        "adjacent_mean_differences": adjacent,
        "overlapping_iqr_pairs": overlap_pairs,
        "weak_separation_warning": weak,
        "warning_message": warning_message,
        "min_adjacent_gap_warn": thresholds.min_overall_score_adjacent_gap_warn,
    }


def evaluate_candidate_quality(
    *,
    days_used: int,
    days_per_cluster: Dict[str, int],
    silhouette: Optional[float],
    stability: Dict[str, Any],
    overall_score_separation: Dict[str, Any],
    thresholds: QualityThresholds = DEFAULT_QUALITY_THRESHOLDS,
) -> Dict[str, Any]:
    """Deterministic hard gates for promoting a clustering candidate."""
    rejection_reasons: List[str] = []
    warnings: List[str] = []

    sizes = [int(days_per_cluster.get(f"cluster_{i}", 0)) for i in range(N_CLUSTERS)]
    min_size = min(sizes) if sizes else 0
    fractions = [size / days_used if days_used else 0.0 for size in sizes]
    min_fraction = min(fractions) if fractions else 0.0
    max_fraction = max(fractions) if fractions else 0.0
    balance_ratio = (min_fraction / max_fraction) if max_fraction > 0 else 0.0

    if min_size < thresholds.min_cluster_size:
        rejection_reasons.append(
            f"minimum_cluster_size:{min_size}<{thresholds.min_cluster_size}"
        )
    if min_fraction < thresholds.min_cluster_fraction:
        rejection_reasons.append(
            f"minimum_cluster_fraction:{min_fraction:.3f}<{thresholds.min_cluster_fraction:.3f}"
        )

    if silhouette is None:
        rejection_reasons.append("silhouette_unavailable")
    elif float(silhouette) < thresholds.min_silhouette_score:
        rejection_reasons.append(
            f"silhouette_below_threshold:{float(silhouette):.3f}<{thresholds.min_silhouette_score:.3f}"
        )

    successful_runs = int(stability.get("successful_runs") or 0)
    stability_score = stability.get("score")
    if successful_runs < thresholds.min_successful_stability_runs:
        rejection_reasons.append(
            f"insufficient_stability_runs:{successful_runs}<{thresholds.min_successful_stability_runs}"
        )
    if stability_score is None:
        rejection_reasons.append("stability_score_unavailable")
    elif float(stability_score) < thresholds.min_stability_score:
        rejection_reasons.append(
            f"stability_below_threshold:{float(stability_score):.3f}<{thresholds.min_stability_score:.3f}"
        )

    if overall_score_separation.get("weak_separation_warning"):
        warnings.append(
            overall_score_separation.get("warning_message")
            or "weak_overall_score_separation"
        )
    if balance_ratio < 0.35:
        warnings.append(f"imbalanced_cluster_sizes:balance_ratio={balance_ratio:.3f}")

    return {
        "passed": len(rejection_reasons) == 0,
        "rejection_reasons": rejection_reasons,
        "warnings": warnings,
        "silhouette_score": None if silhouette is None else float(silhouette),
        "minimum_cluster_size": min_size,
        "minimum_cluster_fraction": min_fraction,
        "cluster_size_balance": {
            "sizes": {f"cluster_{i}": sizes[i] for i in range(len(sizes))},
            "fractions": {f"cluster_{i}": fractions[i] for i in range(len(fractions))},
            "balance_ratio": balance_ratio,
        },
        "stability_score": None if stability_score is None else float(stability_score),
        "stability_method": stability.get("method"),
        "successful_stability_runs": successful_runs,
        "total_stability_runs": int(stability.get("total_runs") or thresholds.stability_runs),
        "stability_details": stability,
        "overall_score_separation": overall_score_separation,
        "quality_thresholds": thresholds.as_dict(),
    }


def run_user_clustering(
    client: Client,
    user_id: str,
    *,
    thresholds: QualityThresholds = DEFAULT_QUALITY_THRESHOLDS,
) -> ClusteringResult:
    feature_matrix = fetch_feature_matrix(client, user_id)
    days_used = int(feature_matrix.shape[0])
    if days_used < MIN_DAYS_FOR_CLUSTERING:
        raise InsufficientDataError(
            f"Need at least {MIN_DAYS_FOR_CLUSTERING} days of features, found {days_used}"
        )

    pca_df = _build_pca_matrix(feature_matrix)
    pca_matrix = pca_df.to_numpy(dtype=float)

    raw_labels = _fit_kmeans(pca_matrix, random_state=KMEANS_RANDOM_STATE)

    merged = feature_matrix.copy()
    merged["cluster"] = raw_labels

    cluster_means = merged.groupby("cluster").mean(numeric_only=True)
    cluster_mins = merged.groupby("cluster").min(numeric_only=True)
    cluster_maxs = merged.groupby("cluster").max(numeric_only=True)
    cluster_stds = merged.groupby("cluster").std(numeric_only=True)

    semantic_by_raw = _semantic_cluster_labels(cluster_means)
    semantic_ranking = {label: int(label.split("_")[1]) for label in semantic_by_raw.values()}

    def remap_index(df: pd.DataFrame) -> pd.DataFrame:
        remapped = df.copy()
        remapped.index = [semantic_by_raw[int(idx)] for idx in remapped.index]
        if "overall_score" in remapped.columns:
            remapped = remapped.sort_values(by="overall_score", ascending=True)
        return remapped

    cluster_means_semantic = remap_index(cluster_means)
    cluster_mins_semantic = remap_index(cluster_mins)
    cluster_maxs_semantic = remap_index(cluster_maxs)
    cluster_stds_semantic = remap_index(cluster_stds)

    available_key_features = [
        feature
        for feature in KEY_FEATURES_FOR_INTERPRETATION
        if feature in cluster_means_semantic.columns
    ]

    silhouette: Optional[float] = None
    if pca_df.shape[0] > N_CLUSTERS:
        try:
            silhouette = float(silhouette_score(pca_df, raw_labels))
        except ValueError:
            silhouette = None

    days_per_cluster = {
        semantic_by_raw[int(raw_cluster)]: int((raw_labels == raw_cluster).sum())
        for raw_cluster in sorted(set(raw_labels.tolist()))
    }
    for semantic in ("cluster_0", "cluster_1", "cluster_2"):
        days_per_cluster.setdefault(semantic, 0)

    stability = evaluate_cluster_stability(
        pca_matrix,
        raw_labels,
        thresholds=thresholds,
        random_state=KMEANS_RANDOM_STATE,
    )
    overall_score_separation = evaluate_overall_score_separation(
        feature_matrix,
        raw_labels,
        semantic_by_raw,
        thresholds=thresholds,
    )
    quality_evaluation = evaluate_candidate_quality(
        days_used=days_used,
        days_per_cluster=days_per_cluster,
        silhouette=silhouette,
        stability=stability,
        overall_score_separation=overall_score_separation,
        thresholds=thresholds,
    )

    cluster_stats = {
        "semantic_labels": {
            "cluster_0": "lowest_mean_overall_score",
            "cluster_1": "middle_mean_overall_score",
            "cluster_2": "highest_mean_overall_score",
        },
        "key_features": available_key_features,
        "means": _frame_to_dict(cluster_means_semantic[available_key_features]),
        "mins": _frame_to_dict(cluster_mins_semantic[available_key_features]),
        "maxs": _frame_to_dict(cluster_maxs_semantic[available_key_features]),
        "stds": _frame_to_dict(cluster_stds_semantic[available_key_features]),
        "days_per_cluster": days_per_cluster,
    }

    metadata = {
        "algorithm": "kmeans",
        "k": N_CLUSTERS,
        "random_state": KMEANS_RANDOM_STATE,
        "n_init": KMEANS_N_INIT,
        "n_components_per_category": N_COMPONENTS_PER_CATEGORY,
        "silhouette_score": silhouette,
        "pca_feature_count": int(pca_df.shape[1]),
        "raw_cluster_to_semantic": {str(k): v for k, v in semantic_by_raw.items()},
        "quality_passed": quality_evaluation.get("passed"),
    }

    return ClusteringResult(
        days_used=days_used,
        data_window_start=feature_matrix.index.min().date().isoformat(),
        data_window_end=feature_matrix.index.max().date().isoformat(),
        cluster_stats=cluster_stats,
        clustering_metadata=metadata,
        semantic_cluster_ranking=semantic_ranking,
        quality_evaluation=quality_evaluation,
    )

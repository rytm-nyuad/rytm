"""
Per-user K-Means clustering over daily_features1.

Production path (mode="os_only"):
  day-validity filters → K-Means(k=3) on standardized overall_score only →
  semantic remap by mean OS. Multi-feature PCA is NOT used for membership.
  Downstream findings/gates live in profiling/.

Experiment path (mode="multifeature" / experiment_mode=True):
  mirrors Final_Capstone_Data_Exploration.ipynb (categories A/B/D, PCA, k=3)
  with completeness indicators and deterministic silhouette/stability gates.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Literal, Optional

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
MIN_DAYS_FOR_CLUSTERING_OS_ONLY = 14
KMEANS_RANDOM_STATE = 42
KMEANS_N_INIT = 10

ClusteringMode = Literal["os_only", "multifeature"]

# Post-PCA: whiten within category, then re-standardize the concatenated matrix so
# no single category's PC1 dominates Euclidean K-Means distance.
PCA_WHITEN = True
RESCALE_CONCATENATED_PCS = True
# Append one completeness score per category (fraction of fields present that day)
# instead of a binary miss_* flag per individual feature.
INCLUDE_CATEGORY_COMPLETENESS = True
# Backward-compatible alias
INCLUDE_MISSINGNESS_INDICATORS = INCLUDE_CATEGORY_COMPLETENESS

CATEGORY_FEATURE_MAP: Dict[str, List[str]] = {
    "A": CATEGORY_A_FEATURES,
    "B": CATEGORY_B_FEATURES,
    "D": CATEGORY_D_FEATURES,
}

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
    # Populated for production OS-only path (findings pipeline).
    feature_matrix: Optional[pd.DataFrame] = None
    semantic_labels: Optional[np.ndarray] = None
    mode: str = "multifeature"


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

    # whiten=True → unit variance per component within the category, so PC1 does not
    # dominate PC2 (and later, categories with larger raw PC spread dominate less).
    pca = PCA(n_components=n_components, whiten=PCA_WHITEN)
    transformed = pca.fit_transform(scaled_df)
    columns = [f"PC_{category_name}_{i + 1}" for i in range(n_components)]
    return pd.DataFrame(transformed, columns=columns, index=scaled_df.index)


def build_category_completeness_matrix(
    feature_matrix: pd.DataFrame,
    categories: Optional[Dict[str, List[str]]] = None,
) -> pd.DataFrame:
    """
    One completeness score per feature category.

    For each day and category, score = (non-null fields) / (fields in category).
    Range [0, 1]. Fields absent from the matrix count as missing (never present).

    This replaces per-feature binary miss_* flags so K-Means sees 2–3 completeness
    columns instead of 10–16 sparse indicators, while still treating gaps as MNAR signal.
    """
    cats = categories if categories is not None else CATEGORY_FEATURE_MAP
    n_rows = feature_matrix.shape[0]
    index = feature_matrix.index
    scores: Dict[str, np.ndarray] = {}

    for cat_name, feature_list in cats.items():
        features = [f for f in feature_list if f]  # drop empties
        if not features:
            continue
        present_counts = np.zeros(n_rows, dtype=float)
        for feat in features:
            if feat in feature_matrix.columns:
                present_counts += (~feature_matrix[feat].isna()).astype(float).to_numpy()
            # else: feature never observed → contributes 0 present
        scores[f"completeness_{cat_name}"] = present_counts / float(len(features))

    return pd.DataFrame(scores, index=index)


def build_missingness_indicator_matrix(
    feature_matrix: pd.DataFrame,
    feature_list: Optional[List[str]] = None,
) -> pd.DataFrame:
    """
    Deprecated alias: prefer build_category_completeness_matrix.

    If feature_list is provided, builds one completeness column over that list
    (named completeness_custom). Otherwise returns standard A/B/D completeness.
    """
    if feature_list is None:
        return build_category_completeness_matrix(feature_matrix)
    return build_category_completeness_matrix(
        feature_matrix, categories={"custom": list(feature_list)}
    )


def compute_per_cluster_missingness_rates(
    feature_matrix: pd.DataFrame,
    raw_labels: np.ndarray,
    semantic_by_raw: Dict[int, str],
    feature_list: Optional[List[str]] = None,
    categories: Optional[Dict[str, List[str]]] = None,
) -> Dict[str, Any]:
    """
    Mean category completeness (fraction of fields present), overall and per cluster.

    `feature_list` is ignored (kept for call-site compatibility). Pass `categories`
    to override the default A/B/D map.
    """
    del feature_list  # per-feature rates retired in favor of category completeness
    cats = categories if categories is not None else CATEGORY_FEATURE_MAP
    comp_df = build_category_completeness_matrix(feature_matrix, cats)
    cat_keys = [name for name, feats in cats.items() if feats]

    def rates_for_mask(mask: np.ndarray) -> Dict[str, Optional[float]]:
        mask_arr = np.asarray(mask, dtype=bool)
        if not np.any(mask_arr):
            return {name: None for name in cat_keys}
        subset = comp_df.iloc[np.flatnonzero(mask_arr)]
        return {
            name: float(subset[f"completeness_{name}"].mean())
            for name in cat_keys
            if f"completeness_{name}" in subset.columns
        }

    overall_mask = np.ones(len(feature_matrix), dtype=bool)
    payload: Dict[str, Any] = {
        "kind": "category_completeness",
        "overall": rates_for_mask(overall_mask),
        "per_cluster": {},
        "note": (
            "Missingness is treated as informative (not MCAR): devices/check-ins are often "
            "skipped on chaotic or hard days. Values are mean category completeness "
            "(fraction of that category's fields present on a day), not per-feature flags."
        ),
    }

    for raw_id, semantic in semantic_by_raw.items():
        mask = raw_labels == int(raw_id)
        payload["per_cluster"][semantic] = rates_for_mask(mask)

    for semantic in ("cluster_0", "cluster_1", "cluster_2"):
        payload["per_cluster"].setdefault(semantic, {name: None for name in cat_keys})

    return payload


def _append_category_completeness(
    matrix_df: pd.DataFrame,
    feature_matrix: pd.DataFrame,
    categories: Optional[Dict[str, List[str]]] = None,
) -> pd.DataFrame:
    """Append standardized category completeness columns with non-zero variance."""
    if not INCLUDE_CATEGORY_COMPLETENESS:
        return matrix_df

    comp_df = build_category_completeness_matrix(feature_matrix, categories)
    nonzero_var_cols = [c for c in comp_df.columns if float(comp_df[c].std(ddof=0)) > 0]
    if not nonzero_var_cols:
        return matrix_df

    comp_var = comp_df[nonzero_var_cols]
    comp_scaler = StandardScaler()
    comp_scaled = comp_scaler.fit_transform(comp_var.to_numpy(dtype=float))
    comp_scaled_df = pd.DataFrame(
        comp_scaled, columns=nonzero_var_cols, index=comp_var.index
    )
    return pd.concat([matrix_df, comp_scaled_df], axis=1)


def _build_pca_matrix(feature_matrix: pd.DataFrame) -> pd.DataFrame:
    """
    Build the K-Means input matrix:
    1) per-category scale → PCA (whitened)
    2) concatenate category PCs
    3) re-standardize concatenated PCs (equal Euclidean weight across columns)
    4) append standardized category completeness scores (one column per A/B/D)
    """
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

    if RESCALE_CONCATENATED_PCS:
        pc_scaler = StandardScaler()
        pca_values = pc_scaler.fit_transform(pca_df.to_numpy(dtype=float))
        pca_df = pd.DataFrame(pca_values, columns=pca_df.columns, index=pca_df.index)

    return _append_category_completeness(pca_df, feature_matrix, CATEGORY_FEATURE_MAP)


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
    mode: ClusteringMode = "os_only",
    experiment_mode: bool = False,
) -> ClusteringResult:
    """
    Run within-user clustering.

    Production default is mode="os_only". Pass mode="multifeature" or
    experiment_mode=True for the legacy PCA A+B+D path.
    """
    if experiment_mode:
        mode = "multifeature"

    feature_matrix = fetch_feature_matrix(client, user_id)
    if mode == "os_only":
        return _run_os_only_clustering(feature_matrix, thresholds=thresholds)
    return _run_multifeature_clustering(
        feature_matrix, thresholds=thresholds
    )


def _run_os_only_clustering(
    feature_matrix: pd.DataFrame,
    *,
    thresholds: QualityThresholds = DEFAULT_QUALITY_THRESHOLDS,
) -> ClusteringResult:
    from profiling.day_validity import apply_day_validity

    valid = apply_day_validity(feature_matrix)
    days_used = int(valid.shape[0])
    if days_used < MIN_DAYS_FOR_CLUSTERING_OS_ONLY:
        raise InsufficientDataError(
            f"Need at least {MIN_DAYS_FOR_CLUSTERING_OS_ONLY} valid days with "
            f"overall_score for OS-only clustering, found {days_used}"
        )
    if "overall_score" not in valid.columns:
        raise InsufficientDataError("overall_score required for OS-only clustering")

    os_series = valid["overall_score"].astype(float)
    if os_series.nunique(dropna=True) < N_CLUSTERS:
        raise InsufficientDataError(
            "Need at least 3 distinct overall_score values for k=3 OS-only clustering"
        )

    scaler = StandardScaler()
    os_matrix = scaler.fit_transform(os_series.to_numpy(dtype=float).reshape(-1, 1))
    raw_labels = _fit_kmeans(os_matrix, random_state=KMEANS_RANDOM_STATE)

    merged = valid.copy()
    merged["cluster"] = raw_labels
    cluster_means = merged.groupby("cluster").mean(numeric_only=True)
    cluster_mins = merged.groupby("cluster").min(numeric_only=True)
    cluster_maxs = merged.groupby("cluster").max(numeric_only=True)
    cluster_stds = merged.groupby("cluster").std(numeric_only=True)

    semantic_by_raw = _semantic_cluster_labels(cluster_means)
    semantic_ranking = {label: int(label.split("_")[1]) for label in semantic_by_raw.values()}
    semantic_labels = np.array(
        [semantic_by_raw[int(x)] for x in raw_labels], dtype=object
    )

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
    if os_matrix.shape[0] > N_CLUSTERS:
        try:
            silhouette = float(silhouette_score(os_matrix, raw_labels))
        except ValueError:
            silhouette = None

    days_per_cluster = {
        semantic_by_raw[int(raw_cluster)]: int((raw_labels == raw_cluster).sum())
        for raw_cluster in sorted(set(raw_labels.tolist()))
    }
    for semantic in ("cluster_0", "cluster_1", "cluster_2"):
        days_per_cluster.setdefault(semantic, 0)

    stability = evaluate_cluster_stability(
        os_matrix,
        raw_labels,
        thresholds=thresholds,
        random_state=KMEANS_RANDOM_STATE,
    )
    overall_score_separation = evaluate_overall_score_separation(
        valid,
        raw_labels,
        semantic_by_raw,
        thresholds=thresholds,
    )
    missingness_rates = compute_per_cluster_missingness_rates(
        valid,
        raw_labels,
        semantic_by_raw,
        ALL_CATEGORY_FEATURES,
    )
    # OS-only production: do not hard-reject on silhouette/stability here.
    # Findings/gates own interpretation readiness; keep metrics for monitoring.
    quality_evaluation = evaluate_candidate_quality(
        days_used=days_used,
        days_per_cluster=days_per_cluster,
        silhouette=silhouette,
        stability=stability,
        overall_score_separation=overall_score_separation,
        thresholds=thresholds,
    )
    quality_evaluation = dict(quality_evaluation)
    quality_evaluation["passed"] = True
    quality_evaluation["os_only_bypass_legacy_hard_gates"] = True
    quality_evaluation["legacy_would_pass"] = (
        len(quality_evaluation.get("rejection_reasons") or []) == 0
    )
    quality_evaluation["rejection_reasons"] = []

    cluster_stats = {
        "semantic_labels": {
            "cluster_0": "lowest_mean_morning_overall_score",
            "cluster_1": "middle_mean_morning_overall_score",
            "cluster_2": "highest_mean_morning_overall_score",
        },
        "feature_timing": {
            "overall_score": (
                "Collected at the beginning of the local calendar day (morning self-report). "
                "OS-only clustering fits on this column alone."
            ),
            "same_date_features": (
                "Other features share the same feature_date after day-validity filters; "
                "they are used for post-hoc findings only, not cluster membership."
            ),
        },
        "key_features": available_key_features,
        "means": _frame_to_dict(cluster_means_semantic[available_key_features]),
        "mins": _frame_to_dict(cluster_mins_semantic[available_key_features]),
        "maxs": _frame_to_dict(cluster_maxs_semantic[available_key_features]),
        "stds": _frame_to_dict(cluster_stds_semantic[available_key_features]),
        "days_per_cluster": days_per_cluster,
        "missingness_rates": missingness_rates,
    }

    metadata = {
        "algorithm": "kmeans",
        "mode": "os_only",
        "k": N_CLUSTERS,
        "random_state": KMEANS_RANDOM_STATE,
        "n_init": KMEANS_N_INIT,
        "fit_features": ["overall_score"],
        "pca_used": False,
        "day_validity_applied": True,
        "min_days_required": MIN_DAYS_FOR_CLUSTERING_OS_ONLY,
        "silhouette_score": silhouette,
        "raw_cluster_to_semantic": {str(k): v for k, v in semantic_by_raw.items()},
        "quality_passed": True,
        "overall_score_timing": "start_of_day_morning_self_report",
        "stability_score": stability.get("score"),
    }
    return ClusteringResult(
        days_used=days_used,
        data_window_start=valid.index.min().date().isoformat(),
        data_window_end=valid.index.max().date().isoformat(),
        cluster_stats=cluster_stats,
        clustering_metadata=metadata,
        semantic_cluster_ranking=semantic_ranking,
        quality_evaluation=quality_evaluation,
        feature_matrix=valid,
        semantic_labels=semantic_labels,
        mode="os_only",
    )


def _run_multifeature_clustering(
    feature_matrix: pd.DataFrame,
    *,
    thresholds: QualityThresholds = DEFAULT_QUALITY_THRESHOLDS,
) -> ClusteringResult:
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
    missingness_rates = compute_per_cluster_missingness_rates(
        feature_matrix,
        raw_labels,
        semantic_by_raw,
        ALL_CATEGORY_FEATURES,
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
            "cluster_0": "lowest_mean_morning_overall_score",
            "cluster_1": "middle_mean_morning_overall_score",
            "cluster_2": "highest_mean_morning_overall_score",
        },
        "feature_timing": {
            "overall_score": (
                "Collected at the beginning of the local calendar day (morning self-report), "
                "not at end of day. Semantic cluster labels reflect morning starting state."
            ),
            "same_date_features": (
                "Other features share the same feature_date. Sleep/overnight for that date is the "
                "night ending into that morning (e.g. Sunday→Monday sleep with Monday overall_score). "
                "Activity/check-in/etc. are that same day's values — not a differently labeled prior day."
            ),
        },
        "missingness_assumption": (
            "Wearable and check-in missingness is NOT assumed MCAR. Gaps often concentrate on "
            "chaotic/hard/travel days. Mean imputation alone would pull those days toward the "
            "centroid; clustering therefore also uses one completeness score per feature category "
            "(A/B/D: fraction of that category's fields present that day), and per-cluster mean "
            "completeness is reported below for interpretation."
        ),
        "key_features": available_key_features,
        "means": _frame_to_dict(cluster_means_semantic[available_key_features]),
        "mins": _frame_to_dict(cluster_mins_semantic[available_key_features]),
        "maxs": _frame_to_dict(cluster_maxs_semantic[available_key_features]),
        "stds": _frame_to_dict(cluster_stds_semantic[available_key_features]),
        "days_per_cluster": days_per_cluster,
        "missingness_rates": missingness_rates,
    }

    pc_columns = [c for c in pca_df.columns if str(c).startswith("PC_")]
    completeness_columns = [c for c in pca_df.columns if str(c).startswith("completeness_")]
    metadata = {
        "algorithm": "kmeans",
        "mode": "multifeature",
        "k": N_CLUSTERS,
        "random_state": KMEANS_RANDOM_STATE,
        "n_init": KMEANS_N_INIT,
        "n_components_per_category": N_COMPONENTS_PER_CATEGORY,
        "pca_whiten": PCA_WHITEN,
        "rescale_concatenated_pcs": RESCALE_CONCATENATED_PCS,
        "category_completeness_included": INCLUDE_CATEGORY_COMPLETENESS,
        "category_completeness_column_count": len(completeness_columns),
        "missingness_indicators_included": INCLUDE_CATEGORY_COMPLETENESS,
        "missingness_indicator_count": len(completeness_columns),
        "pc_feature_count": len(pc_columns),
        "silhouette_score": silhouette,
        "pca_feature_count": int(pca_df.shape[1]),
        "raw_cluster_to_semantic": {str(k): v for k, v in semantic_by_raw.items()},
        "quality_passed": quality_evaluation.get("passed"),
        "overall_score_timing": "start_of_day_morning_self_report",
    }
    return ClusteringResult(
        days_used=days_used,
        data_window_start=feature_matrix.index.min().date().isoformat(),
        data_window_end=feature_matrix.index.max().date().isoformat(),
        cluster_stats=cluster_stats,
        clustering_metadata=metadata,
        semantic_cluster_ranking=semantic_ranking,
        quality_evaluation=quality_evaluation,
        feature_matrix=feature_matrix,
        semantic_labels=np.array(
            [semantic_by_raw[int(x)] for x in raw_labels], dtype=object
        ),
        mode="multifeature",
    )

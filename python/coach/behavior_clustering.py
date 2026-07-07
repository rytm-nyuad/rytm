"""
Per-user K-Means clustering over daily_features1.

Mirrors Final_Capstone_Data_Exploration.ipynb (categories A/B/D, PCA, k=3)
without visualization dependencies.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.impute import SimpleImputer
from sklearn.metrics import silhouette_score
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


@dataclass
class ClusteringResult:
    days_used: int
    data_window_start: str
    data_window_end: str
    cluster_stats: Dict[str, Any]
    clustering_metadata: Dict[str, Any]
    semantic_cluster_ranking: Dict[str, int]


class InsufficientDataError(Exception):
    """Raised when a user does not have enough feature history for clustering."""


def fetch_feature_matrix(client: Client, user_id: str) -> pd.DataFrame:
    """Load all daily_features1 rows for a user and pivot to a date x feature matrix."""
    feature_keys = sorted(set(ALL_CATEGORY_FEATURES + ["overall_score"]))
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


def run_user_clustering(client: Client, user_id: str) -> ClusteringResult:
    feature_matrix = fetch_feature_matrix(client, user_id)
    days_used = int(feature_matrix.shape[0])
    if days_used < MIN_DAYS_FOR_CLUSTERING:
        raise InsufficientDataError(
            f"Need at least {MIN_DAYS_FOR_CLUSTERING} days of features, found {days_used}"
        )

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

    kmeans = KMeans(n_clusters=N_CLUSTERS, random_state=42, n_init=10)
    raw_labels = kmeans.fit_predict(pca_df)

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
        "days_per_cluster": {
            semantic_by_raw[int(raw_cluster)]: int((raw_labels == raw_cluster).sum())
            for raw_cluster in sorted(set(raw_labels.tolist()))
        },
    }

    metadata = {
        "algorithm": "kmeans",
        "k": N_CLUSTERS,
        "random_state": 42,
        "n_components_per_category": N_COMPONENTS_PER_CATEGORY,
        "silhouette_score": silhouette,
        "pca_feature_count": int(pca_df.shape[1]),
        "raw_cluster_to_semantic": semantic_by_raw,
    }

    return ClusteringResult(
        days_used=days_used,
        data_window_start=feature_matrix.index.min().date().isoformat(),
        data_window_end=feature_matrix.index.max().date().isoformat(),
        cluster_stats=cluster_stats,
        clustering_metadata=metadata,
        semantic_cluster_ranking=semantic_ranking,
    )

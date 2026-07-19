"""
TEMPORARY exploration script (not part of the production coach pipeline).

Compares clustering feature setups for one user as of a cutoff date, prints
evaluation metrics, and asks the behavior-profile LLM to interpret each
scenario's clusters. Safe to delete later.

Usage (from repo root, with coach venv):
  python/coach/.venv/Scripts/python.exe experiments/explore_clustering_variants.py

  python experiments/explore_clustering_variants.py \\
    --user-id ba7806f0-d26f-4b9d-95d7-917d4159b638 \\
    --as-of 2026-02-28

  # metrics only (no LLM calls):
  python experiments/explore_clustering_variants.py --skip-llm
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.impute import SimpleImputer
from sklearn.metrics import adjusted_rand_score, silhouette_score
from sklearn.preprocessing import StandardScaler

REPO_ROOT = Path(__file__).resolve().parents[1]
COACH_DIR = REPO_ROOT / "python" / "coach"
sys.path.insert(0, str(COACH_DIR))

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:  # pragma: no cover
    def load_dotenv(*args, **kwargs):
        return False

from supabase import create_client

from behavior_clustering import (  # noqa: E402
    CATEGORY_A_FEATURES,
    CATEGORY_B_FEATURES,
    CATEGORY_D_FEATURES,
    DEFAULT_QUALITY_THRESHOLDS,
    KEY_FEATURES_FOR_INTERPRETATION,
    N_CLUSTERS,
    KMEANS_N_INIT,
    KMEANS_RANDOM_STATE,
    build_category_completeness_matrix,
    compute_per_cluster_missingness_rates,
    evaluate_cluster_stability,
    fetch_feature_matrix,
)
from behavior_profile_agent import BehaviorProfileInterpreter  # noqa: E402
from llm_config import resolve_behavior_profile_llm_config  # noqa: E402

# Sleep / overnight-oriented subset of category A (excludes caffeine).
SLEEP_FEATURES = [
    "sleep_duration_hours",
    "sleep_efficiency",
    "deep_ratio",
    "rem_ratio",
    "hrv_rmssd",
    "readiness_score",
    "bedtime_consistency_score",
    "sleep_start_time_variability_7d",
]

DEFAULT_USER_ID = "ba7806f0-d26f-4b9d-95d7-917d4159b638"
DEFAULT_AS_OF = "2026-02-28"


@dataclass
class ScenarioResult:
    name: str
    description: str
    feature_groups: List[str]
    days_used: int
    data_window_start: str
    data_window_end: str
    n_input_columns: int
    silhouette: Optional[float]
    stability_score: Optional[float]
    stability_successful_runs: int
    stability_total_runs: int
    cluster_sizes: Dict[str, int]
    overall_score_means: Dict[str, Optional[float]]
    overall_score_medians: Dict[str, Optional[float]]
    adjacent_mean_gaps: Dict[str, Optional[float]]
    raw_labels: np.ndarray
    metrics_notes: List[str]
    cluster_stats: Dict[str, Any] = field(default_factory=dict)
    clustering_metadata: Dict[str, Any] = field(default_factory=dict)
    quality_evaluation: Dict[str, Any] = field(default_factory=dict)
    llm_interpretation: Optional[Dict[str, Any]] = None
    llm_error: Optional[str] = None


def _load_env() -> None:
    load_dotenv(REPO_ROOT / ".env.local")
    load_dotenv(REPO_ROOT / ".env")


def _fit_kmeans(matrix: np.ndarray, *, random_state: int = KMEANS_RANDOM_STATE) -> np.ndarray:
    model = KMeans(n_clusters=N_CLUSTERS, random_state=random_state, n_init=KMEANS_N_INIT)
    return model.fit_predict(matrix)


def _scale_impute(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    imputer = SimpleImputer(strategy="mean")
    imputed = imputer.fit_transform(df)
    scaler = StandardScaler()
    scaled = scaler.fit_transform(imputed)
    return pd.DataFrame(scaled, columns=df.columns, index=df.index)


def _pca_block(scaled_df: pd.DataFrame, prefix: str, n_components: int = 2) -> pd.DataFrame:
    if scaled_df.empty:
        return pd.DataFrame(index=scaled_df.index)
    n_comp = min(n_components, scaled_df.shape[1], max(scaled_df.shape[0] - 1, 1))
    if n_comp < 1:
        return pd.DataFrame(index=scaled_df.index)
    pca = PCA(n_components=n_comp, whiten=True)
    transformed = pca.fit_transform(scaled_df)
    cols = [f"{prefix}_{i + 1}" for i in range(n_comp)]
    return pd.DataFrame(transformed, columns=cols, index=scaled_df.index)


def _present_cols(feature_matrix: pd.DataFrame, features: Sequence[str]) -> List[str]:
    return [f for f in features if f in feature_matrix.columns]


def build_matrix_from_feature_lists(
    feature_matrix: pd.DataFrame,
    feature_groups: Dict[str, Sequence[str]],
    *,
    include_missingness: bool = True,
    use_pca_per_group: bool = True,
) -> Tuple[pd.DataFrame, List[str]]:
    notes: List[str] = []
    blocks: List[pd.DataFrame] = []

    for group_name, features in feature_groups.items():
        cols = _present_cols(feature_matrix, features)
        if not cols:
            notes.append(f"{group_name}: no columns present — skipped")
            continue
        block = feature_matrix[cols]
        scaled = _scale_impute(block)
        if use_pca_per_group and scaled.shape[1] >= 2:
            reduced = _pca_block(scaled, prefix=f"PC_{group_name}")
            blocks.append(reduced)
            notes.append(f"{group_name}: PCA({reduced.shape[1]}) on {cols}")
        else:
            renamed = scaled.rename(columns={c: f"{group_name}__{c}" for c in scaled.columns})
            blocks.append(renamed)
            notes.append(f"{group_name}: scaled raw columns {cols}")

    if not blocks:
        raise ValueError("No usable feature columns for this scenario")

    matrix = pd.concat(blocks, axis=1)
    scaler = StandardScaler()
    matrix = pd.DataFrame(
        scaler.fit_transform(matrix.to_numpy(dtype=float)),
        columns=matrix.columns,
        index=matrix.index,
    )

    if include_missingness:
        # One completeness score per feature group used in this scenario (not per field).
        group_cats = {
            group_name: list(features)
            for group_name, features in feature_groups.items()
            if features
        }
        miss = build_category_completeness_matrix(feature_matrix, group_cats)
        variable = [c for c in miss.columns if float(miss[c].std(ddof=0)) > 0]
        if variable:
            miss_scaled = StandardScaler().fit_transform(miss[variable].to_numpy(dtype=float))
            miss_df = pd.DataFrame(miss_scaled, columns=variable, index=miss.index)
            matrix = pd.concat([matrix, miss_df], axis=1)
            notes.append(f"category completeness scores: {len(variable)}")

    return matrix, notes


def semantic_order_by_overall_score(
    feature_matrix: pd.DataFrame,
    raw_labels: np.ndarray,
) -> Dict[int, str]:
    tmp = feature_matrix.copy()
    tmp["__cluster"] = raw_labels
    if "overall_score" not in tmp.columns:
        return {int(i): f"cluster_{rank}" for rank, i in enumerate(sorted(set(raw_labels.tolist())))}
    means = tmp.groupby("__cluster")["overall_score"].mean(numeric_only=True).sort_values()
    return {int(raw_id): f"cluster_{rank}" for rank, raw_id in enumerate(means.index.tolist())}


def summarize_overall_scores(
    feature_matrix: pd.DataFrame,
    raw_labels: np.ndarray,
    semantic_by_raw: Dict[int, str],
) -> Tuple[Dict[str, Optional[float]], Dict[str, Optional[float]], Dict[str, Optional[float]], Dict[str, int]]:
    means: Dict[str, Optional[float]] = {}
    medians: Dict[str, Optional[float]] = {}
    sizes: Dict[str, int] = {}
    for raw_id, semantic in semantic_by_raw.items():
        mask = raw_labels == int(raw_id)
        sizes[semantic] = int(mask.sum())
        if "overall_score" not in feature_matrix.columns:
            means[semantic] = None
            medians[semantic] = None
            continue
        vals = feature_matrix.loc[mask, "overall_score"].dropna()
        means[semantic] = float(vals.mean()) if len(vals) else None
        medians[semantic] = float(vals.median()) if len(vals) else None

    for semantic in ("cluster_0", "cluster_1", "cluster_2"):
        means.setdefault(semantic, None)
        medians.setdefault(semantic, None)
        sizes.setdefault(semantic, 0)

    gaps: Dict[str, Optional[float]] = {}
    for left, right in (("cluster_0", "cluster_1"), ("cluster_1", "cluster_2")):
        if means[left] is None or means[right] is None:
            gaps[f"{left}_to_{right}"] = None
        else:
            gaps[f"{left}_to_{right}"] = float(means[right] - means[left])
    return means, medians, gaps, sizes


def _frame_to_dict(df: pd.DataFrame) -> Dict[str, Dict[str, Optional[float]]]:
    payload: Dict[str, Dict[str, Optional[float]]] = {}
    for index_value, row in df.iterrows():
        payload[str(index_value)] = {
            col: (None if pd.isna(val) else float(val)) for col, val in row.items()
        }
    return payload


def build_interpreter_cluster_stats(
    feature_matrix: pd.DataFrame,
    raw_labels: np.ndarray,
    semantic_by_raw: Dict[int, str],
    scenario_name: str,
    scenario_description: str,
) -> Dict[str, Any]:
    """Build a production-like cluster_stats blob for the LLM interpreter."""
    merged = feature_matrix.copy()
    merged["cluster"] = raw_labels

    means = merged.groupby("cluster").mean(numeric_only=True)
    mins = merged.groupby("cluster").min(numeric_only=True)
    maxs = merged.groupby("cluster").max(numeric_only=True)
    stds = merged.groupby("cluster").std(numeric_only=True)

    def remap(df: pd.DataFrame) -> pd.DataFrame:
        out = df.copy()
        out.index = [semantic_by_raw[int(idx)] for idx in out.index]
        if "overall_score" in out.columns:
            out = out.sort_values(by="overall_score", ascending=True)
        return out

    means_s = remap(means)
    mins_s = remap(mins)
    maxs_s = remap(maxs)
    stds_s = remap(stds)

    key_features = [f for f in KEY_FEATURES_FOR_INTERPRETATION if f in means_s.columns]
    days_per_cluster = {
        semantic_by_raw[int(raw_id)]: int((raw_labels == raw_id).sum())
        for raw_id in sorted(set(raw_labels.tolist()))
    }
    for semantic in ("cluster_0", "cluster_1", "cluster_2"):
        days_per_cluster.setdefault(semantic, 0)

    missingness_rates = compute_per_cluster_missingness_rates(
        feature_matrix,
        raw_labels,
        semantic_by_raw,
    )

    return {
        "scenario_name": scenario_name,
        "scenario_description": scenario_description,
        "semantic_labels": {
            "cluster_0": "lowest_mean_morning_overall_score",
            "cluster_1": "middle_mean_morning_overall_score",
            "cluster_2": "highest_mean_morning_overall_score",
        },
        "feature_timing": {
            "overall_score": (
                "Collected at the beginning of the local calendar day (morning self-report), "
                "not at end of day."
            ),
            "same_date_features": (
                "Other features share the same feature_date. Sleep for that date is the night "
                "ending into that morning."
            ),
        },
        "key_features": key_features,
        "means": _frame_to_dict(means_s[key_features]) if key_features else {},
        "mins": _frame_to_dict(mins_s[key_features]) if key_features else {},
        "maxs": _frame_to_dict(maxs_s[key_features]) if key_features else {},
        "stds": _frame_to_dict(stds_s[key_features]) if key_features else {},
        "days_per_cluster": days_per_cluster,
        "missingness_rates": missingness_rates,
    }


def build_exploration_quality_evaluation(result_fields: Dict[str, Any]) -> Dict[str, Any]:
    """
    Exploration-only quality blob for the interpreter evidence package.
    Does not enforce production gates; marks passed=True so the LLM can interpret.
    """
    warnings: List[str] = [
        "Exploration run: quality gates were not used to block interpretation.",
    ]
    gaps = result_fields.get("adjacent_mean_gaps") or {}
    gap01 = gaps.get("cluster_0_to_cluster_1")
    gap12 = gaps.get("cluster_1_to_cluster_2")
    if gap01 is not None and gap01 < 3.0:
        warnings.append(f"weak overall_score gap cluster_0→1 ({gap01:.1f})")
    if gap12 is not None and gap12 < 3.0:
        warnings.append(f"weak overall_score gap cluster_1→2 ({gap12:.1f})")

    return {
        "passed": True,
        "rejection_reasons": [],
        "warnings": warnings,
        "silhouette_score": result_fields.get("silhouette"),
        "stability_score": result_fields.get("stability_score"),
        "stability_method": "subsample_adjusted_rand",
        "successful_stability_runs": result_fields.get("stability_successful_runs"),
        "total_stability_runs": result_fields.get("stability_total_runs"),
        "cluster_size_balance": {"sizes": result_fields.get("cluster_sizes")},
        "overall_score_separation": {
            "adjacent_mean_differences": gaps,
            "per_cluster_means": result_fields.get("overall_score_means"),
            "weak_separation_warning": any(
                (g is not None and g < 3.0) for g in (gap01, gap12)
            ),
        },
        "quality_thresholds": DEFAULT_QUALITY_THRESHOLDS.as_dict(),
    }


def run_scenario(
    name: str,
    description: str,
    feature_matrix: pd.DataFrame,
    feature_groups: Dict[str, Sequence[str]],
    *,
    include_missingness: bool = True,
    use_pca_per_group: bool = True,
) -> ScenarioResult:
    matrix, notes = build_matrix_from_feature_lists(
        feature_matrix,
        feature_groups,
        include_missingness=include_missingness,
        use_pca_per_group=use_pca_per_group,
    )
    X = matrix.to_numpy(dtype=float)
    labels = _fit_kmeans(X)

    silhouette: Optional[float] = None
    if X.shape[0] > N_CLUSTERS and len(set(labels.tolist())) > 1:
        try:
            silhouette = float(silhouette_score(X, labels))
        except ValueError:
            silhouette = None

    stability = evaluate_cluster_stability(
        X,
        labels,
        thresholds=DEFAULT_QUALITY_THRESHOLDS,
        random_state=KMEANS_RANDOM_STATE,
    )
    semantic = semantic_order_by_overall_score(feature_matrix, labels)
    means, medians, gaps, sizes = summarize_overall_scores(feature_matrix, labels, semantic)

    cluster_stats = build_interpreter_cluster_stats(
        feature_matrix,
        labels,
        semantic,
        name,
        description,
    )
    meta = {
        "experiment": True,
        "scenario_name": name,
        "algorithm": "kmeans",
        "k": N_CLUSTERS,
        "feature_groups": list(feature_groups.keys()),
        "n_input_columns": int(matrix.shape[1]),
        "silhouette_score": silhouette,
        "stability": {
            "score": stability.get("score"),
            "successful_runs": stability.get("successful_runs"),
            "total_runs": stability.get("total_runs"),
        },
    }
    quality = build_exploration_quality_evaluation(
        {
            "silhouette": silhouette,
            "stability_score": stability.get("score"),
            "stability_successful_runs": stability.get("successful_runs"),
            "stability_total_runs": stability.get("total_runs"),
            "cluster_sizes": sizes,
            "overall_score_means": means,
            "adjacent_mean_gaps": gaps,
        }
    )

    return ScenarioResult(
        name=name,
        description=description,
        feature_groups=list(feature_groups.keys()),
        days_used=int(feature_matrix.shape[0]),
        data_window_start=feature_matrix.index.min().date().isoformat(),
        data_window_end=feature_matrix.index.max().date().isoformat(),
        n_input_columns=int(matrix.shape[1]),
        silhouette=silhouette,
        stability_score=(
            None if stability.get("score") is None else float(stability["score"])
        ),
        stability_successful_runs=int(stability.get("successful_runs") or 0),
        stability_total_runs=int(stability.get("total_runs") or 0),
        cluster_sizes=sizes,
        overall_score_means=means,
        overall_score_medians=medians,
        adjacent_mean_gaps=gaps,
        raw_labels=labels,
        metrics_notes=notes,
        cluster_stats=cluster_stats,
        clustering_metadata=meta,
        quality_evaluation=quality,
    )


def interpret_scenario(
    interpreter: BehaviorProfileInterpreter,
    result: ScenarioResult,
) -> ScenarioResult:
    try:
        profile = interpreter.interpret(
            cluster_stats=result.cluster_stats,
            clustering_metadata=result.clustering_metadata,
            quality_evaluation=result.quality_evaluation,
            days_used=result.days_used,
            data_window_start=result.data_window_start,
            data_window_end=result.data_window_end,
        )
        result.llm_interpretation = profile
        result.llm_error = None
    except Exception as exc:  # noqa: BLE001
        result.llm_interpretation = None
        result.llm_error = str(exc)
    return result


def pairwise_label_agreement(results: List[ScenarioResult]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for i, a in enumerate(results):
        for b in results[i + 1 :]:
            if len(a.raw_labels) != len(b.raw_labels):
                continue
            key = f"{a.name}__vs__{b.name}"
            out[key] = float(adjusted_rand_score(a.raw_labels, b.raw_labels))
    return out


def result_to_dict(result: ScenarioResult) -> Dict[str, Any]:
    return {
        "name": result.name,
        "description": result.description,
        "feature_groups": result.feature_groups,
        "days_used": result.days_used,
        "data_window_start": result.data_window_start,
        "data_window_end": result.data_window_end,
        "n_input_columns": result.n_input_columns,
        "silhouette": result.silhouette,
        "stability_score": result.stability_score,
        "stability_successful_runs": result.stability_successful_runs,
        "stability_total_runs": result.stability_total_runs,
        "cluster_sizes": result.cluster_sizes,
        "overall_score_means": result.overall_score_means,
        "overall_score_medians": result.overall_score_medians,
        "adjacent_mean_gaps": result.adjacent_mean_gaps,
        "notes": result.metrics_notes,
        "cluster_stats": result.cluster_stats,
        "clustering_metadata": result.clustering_metadata,
        "quality_evaluation": result.quality_evaluation,
        "llm_interpretation": result.llm_interpretation,
        "llm_error": result.llm_error,
    }


def print_comparison_table(results: List[ScenarioResult]) -> None:
    headers = [
        "scenario",
        "days",
        "cols",
        "silhouette",
        "stability",
        "stab_runs",
        "sizes(c0/c1/c2)",
        "mean_OS(c0/c1/c2)",
        "gap01",
        "gap12",
        "llm",
    ]
    rows: List[List[str]] = []
    for r in results:
        sizes = "/".join(str(r.cluster_sizes.get(f"cluster_{i}", 0)) for i in range(3))
        means = "/".join(
            (
                "na"
                if r.overall_score_means.get(f"cluster_{i}") is None
                else f"{r.overall_score_means[f'cluster_{i}']:.1f}"
            )
            for i in range(3)
        )
        llm_flag = "ok" if r.llm_interpretation else ("err" if r.llm_error else "skip")
        rows.append(
            [
                r.name,
                str(r.days_used),
                str(r.n_input_columns),
                "na" if r.silhouette is None else f"{r.silhouette:.3f}",
                "na" if r.stability_score is None else f"{r.stability_score:.3f}",
                f"{r.stability_successful_runs}/{r.stability_total_runs}",
                sizes,
                means,
                "na"
                if r.adjacent_mean_gaps.get("cluster_0_to_cluster_1") is None
                else f"{r.adjacent_mean_gaps['cluster_0_to_cluster_1']:.1f}",
                "na"
                if r.adjacent_mean_gaps.get("cluster_1_to_cluster_2") is None
                else f"{r.adjacent_mean_gaps['cluster_1_to_cluster_2']:.1f}",
                llm_flag,
            ]
        )

    widths = [max(len(h), *(len(row[i]) for row in rows)) for i, h in enumerate(headers)]
    fmt = "  ".join(f"{{:{w}}}" for w in widths)
    print(fmt.format(*headers))
    print(fmt.format(*("-" * w for w in widths)))
    for row in rows:
        print(fmt.format(*row))


def print_llm_summaries(results: List[ScenarioResult]) -> None:
    print("\n" + "=" * 88)
    print("LLM cluster interpretations")
    print("=" * 88)
    for r in results:
        print(f"\n### {r.name}")
        if r.llm_error:
            print(f"  LLM error: {r.llm_error}")
            continue
        if not r.llm_interpretation:
            print("  (no interpretation)")
            continue
        interp = r.llm_interpretation
        print(f"  summary: {interp.get('summary', '')}")
        print(f"  primary_coaching_rule: {interp.get('primary_coaching_rule', '')}")
        clusters = interp.get("cluster_interpretations") or {}
        for key in ("cluster_0", "cluster_1", "cluster_2"):
            print(f"  {key}: {clusters.get(key, '')}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Temporary clustering exploration (not production).")
    parser.add_argument("--user-id", default=DEFAULT_USER_ID)
    parser.add_argument("--as-of", default=DEFAULT_AS_OF, help="Inclusive cutoff date YYYY-MM-DD")
    parser.add_argument(
        "--json-out",
        default=str(REPO_ROOT / "experiments" / "clustering_variants_result.json"),
        help="Where to write full JSON results",
    )
    parser.add_argument(
        "--skip-llm",
        action="store_true",
        help="Skip behavior-profile LLM interpretation calls",
    )
    args = parser.parse_args()

    as_of = date.fromisoformat(args.as_of)
    _load_env()

    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not supabase_key:
        print(json.dumps({"error": "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"}))
        sys.exit(1)

    client = create_client(supabase_url, supabase_key)
    full = fetch_feature_matrix(client, args.user_id)
    matrix = full.loc[full.index.normalize() <= pd.Timestamp(as_of)].copy()
    if matrix.shape[0] < N_CLUSTERS:
        print(
            json.dumps(
                {
                    "error": "Not enough days on/before as-of date",
                    "days": int(matrix.shape[0]),
                    "as_of": as_of.isoformat(),
                }
            )
        )
        sys.exit(1)

    scenarios = [
        (
            "B_plus_D_then_order_by_OS",
            "Sharpened test: cluster on activity(B)+check-in(D) only; order clusters by overall_score",
            {"B": CATEGORY_B_FEATURES, "D": CATEGORY_D_FEATURES},
            True,
            True,
        ),
        (
            "overall_score_only",
            "Cluster using only overall_score as the algorithm input; still report semantic order by OS",
            {"overall_score": ["overall_score"]},
            False,
            False,
        ),
        (
            "overall_score_plus_sleep",
            "Cluster using overall_score + sleep/overnight features",
            {"overall_score": ["overall_score"], "sleep": SLEEP_FEATURES},
            True,
            True,
        ),
        (
            "baseline_A_B_D_no_OS_in_fit",
            "Reference: production-like A+B+D (overall_score not in fit; used only to order)",
            {"A": CATEGORY_A_FEATURES, "B": CATEGORY_B_FEATURES, "D": CATEGORY_D_FEATURES},
            True,
            True,
        ),
    ]

    interpreter: Optional[BehaviorProfileInterpreter] = None
    llm_meta: Dict[str, Any] = {"skipped": True}
    if not args.skip_llm:
        try:
            llm_config = resolve_behavior_profile_llm_config()
            interpreter = BehaviorProfileInterpreter(config=llm_config)
            llm_meta = {
                "skipped": False,
                "provider": llm_config.provider,
                "model": llm_config.model,
            }
        except Exception as exc:  # noqa: BLE001
            print(f"LLM setup failed; continuing without interpretations: {exc}")
            llm_meta = {"skipped": True, "error": str(exc)}

    results: List[ScenarioResult] = []
    print("=" * 88)
    print("Clustering variant exploration (TEMPORARY)")
    print(f"user_id: {args.user_id}")
    print(f"as_of (inclusive): {as_of.isoformat()}")
    print(f"feature keys available: {sorted(matrix.columns.tolist())}")
    print(f"days used: {matrix.shape[0]}  ({matrix.index.min().date()} -> {matrix.index.max().date()})")
    print(f"LLM interpretations: {'on' if interpreter else 'off'}")
    print("=" * 88)

    for name, desc, groups, include_miss, use_pca in scenarios:
        print(f"\n--- Running: {name} ---")
        print(desc)
        try:
            result = run_scenario(
                name,
                desc,
                matrix,
                groups,
                include_missingness=include_miss,
                use_pca_per_group=use_pca,
            )
            for note in result.metrics_notes:
                print(f"  note: {note}")
            if interpreter is not None:
                print("  interpreting with LLM...")
                result = interpret_scenario(interpreter, result)
                if result.llm_error:
                    print(f"  LLM error: {result.llm_error}")
                else:
                    print("  LLM interpretation ok")
            results.append(result)
        except Exception as exc:  # noqa: BLE001
            print(f"  FAILED: {exc}")

    print("\n" + "=" * 88)
    print("Comparison metrics")
    print("=" * 88)
    if results:
        print_comparison_table(results)
        agreement = pairwise_label_agreement(results)
        print("\nPairwise label agreement (Adjusted Rand Index):")
        for key, value in agreement.items():
            print(f"  {key}: {value:.3f}")
        if interpreter is not None:
            print_llm_summaries(results)
    else:
        print("No successful scenarios.")

    payload = {
        "temporary": True,
        "user_id": args.user_id,
        "as_of": as_of.isoformat(),
        "days_used": int(matrix.shape[0]),
        "data_window_start": matrix.index.min().date().isoformat(),
        "data_window_end": matrix.index.max().date().isoformat(),
        "llm": llm_meta,
        "scenarios": [result_to_dict(r) for r in results],
        "pairwise_ari": pairwise_label_agreement(results) if results else {},
        "metric_definitions": {
            "silhouette": "sklearn silhouette_score on the scenario's clustering matrix/labels",
            "stability": "mean subsample Adjusted Rand Index vs primary labels (same helper as production)",
            "cluster_sizes": "counts after semantic remapping by ascending mean overall_score",
            "overall_score_means": "mean morning overall_score per semantic cluster",
            "adjacent_mean_gaps": "mean_OS(cluster_i+1) - mean_OS(cluster_i)",
            "pairwise_ari": "agreement between scenario labelings on the same days",
            "llm_interpretation": (
                "BehaviorProfileInterpreter output (summary, cluster_0/1/2, primary_coaching_rule) "
                "for that scenario's cluster_stats; exploration does not block on quality gates"
            ),
        },
    }

    out_path = Path(args.json_out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"\nWrote JSON: {out_path}")


if __name__ == "__main__":
    main()

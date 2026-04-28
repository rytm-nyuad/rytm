#!/usr/bin/env python3
import argparse
import os
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns
from dotenv import load_dotenv
from supabase import create_client


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a feature-correlation heatmap from daily_features1 with minimal DB queries."
    )
    parser.add_argument("--user-id", required=True, help="User UUID")
    parser.add_argument("--start-date", required=True, help="Start date YYYY-MM-DD")
    parser.add_argument("--end-date", required=True, help="End date YYYY-MM-DD")
    parser.add_argument(
        "--feature-keys",
        default="",
        help="Comma-separated feature keys to include (optional).",
    )
    parser.add_argument(
        "--corr-method",
        choices=["pearson", "spearman", "kendall"],
        default="spearman",
        help="Correlation method.",
    )
    parser.add_argument(
        "--min-non-null-ratio",
        type=float,
        default=0.4,
        help="Drop features with non-null ratio below this threshold.",
    )
    parser.add_argument(
        "--min-periods",
        type=int,
        default=7,
        help="Minimum overlapping days required per pairwise correlation.",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=20,
        help="How many strongest pairs to print/save.",
    )
    parser.add_argument(
        "--output-dir",
        default="./analysis_outputs",
        help="Directory for heatmap and CSV outputs.",
    )
    return parser.parse_args()


def get_supabase_client():
    project_root = Path(__file__).resolve().parents[2]
    load_dotenv(project_root / ".env.local")

    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "Missing env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY"
        )

    return create_client(url, key)


def fetch_features_one_query(
    supabase,
    user_id: str,
    start_date: str,
    end_date: str,
    feature_keys: list[str] | None,
) -> pd.DataFrame:
    query = (
        supabase.table("daily_features1")
        .select("feature_date,feature_key,value_num")
        .eq("user_id", user_id)
        .gte("feature_date", start_date)
        .lte("feature_date", end_date)
        .not_.is_("value_num", "null")
    )

    if feature_keys:
        query = query.in_("feature_key", feature_keys)

    # Single query path (min DB round-trips).
    rows = query.execute().data or []
    return pd.DataFrame(rows)


def build_feature_matrix(raw: pd.DataFrame, min_non_null_ratio: float) -> pd.DataFrame:
    if raw.empty:
        raise ValueError("No feature rows returned for this user/date range.")

    raw["feature_date"] = pd.to_datetime(raw["feature_date"]).dt.date

    matrix = raw.pivot_table(
        index="feature_date",
        columns="feature_key",
        values="value_num",
        aggfunc="mean",
    ).sort_index()

    min_non_null = max(1, int(len(matrix) * min_non_null_ratio))
    matrix = matrix.dropna(axis=1, thresh=min_non_null)

    if matrix.shape[1] < 2:
        raise ValueError(
            "Not enough dense numeric features after filtering. Try a wider date range or lower --min-non-null-ratio."
        )

    return matrix


def top_pairs(corr: pd.DataFrame, top_k: int) -> pd.DataFrame:
    pairs = (
        corr.where(~pd.isna(corr))
        .where(~pd.DataFrame(
            [[i == j for j in corr.columns] for i in corr.index],
            index=corr.index,
            columns=corr.columns,
        ))
        .stack()
        .reset_index()
    )
    pairs.columns = ["feature_a", "feature_b", "corr"]
    pairs["abs_corr"] = pairs["corr"].abs()

    pairs = pairs[pairs["feature_a"] < pairs["feature_b"]]
    return pairs.sort_values("abs_corr", ascending=False).head(top_k)


def save_outputs(
    corr: pd.DataFrame,
    matrix: pd.DataFrame,
    strongest: pd.DataFrame,
    output_dir: Path,
    corr_method: str,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    corr_path = output_dir / f"feature_corr_{corr_method}.csv"
    heatmap_path = output_dir / f"feature_corr_heatmap_{corr_method}.png"
    matrix_path = output_dir / "feature_matrix.csv"
    strongest_path = output_dir / "top_feature_pairs.csv"

    corr.to_csv(corr_path)
    matrix.to_csv(matrix_path)
    strongest.to_csv(strongest_path, index=False)

    plt.figure(figsize=(max(10, corr.shape[1] * 0.45), max(8, corr.shape[1] * 0.4)))
    sns.heatmap(
        corr,
        cmap="vlag",
        center=0,
        square=True,
        linewidths=0.2,
        cbar_kws={"shrink": 0.75},
    )
    plt.title(f"Feature Correlation Heatmap ({corr_method.capitalize()})")
    plt.tight_layout()
    plt.savefig(heatmap_path, dpi=220)
    plt.close()

    print(f"Saved: {heatmap_path}")
    print(f"Saved: {corr_path}")
    print(f"Saved: {matrix_path}")
    print(f"Saved: {strongest_path}")


def main() -> None:
    args = parse_args()
    feature_keys = [k.strip() for k in args.feature_keys.split(",") if k.strip()] or None

    supabase = get_supabase_client()
    raw = fetch_features_one_query(
        supabase=supabase,
        user_id=args.user_id,
        start_date=args.start_date,
        end_date=args.end_date,
        feature_keys=feature_keys,
    )

    matrix = build_feature_matrix(raw, min_non_null_ratio=args.min_non_null_ratio)
    corr = matrix.corr(method=args.corr_method, min_periods=args.min_periods)
    corr = corr.dropna(axis=0, how="all").dropna(axis=1, how="all")

    strongest = top_pairs(corr, args.top_k)
    print("\nTop correlated feature pairs:")
    print(strongest.to_string(index=False))

    save_outputs(
        corr=corr,
        matrix=matrix,
        strongest=strongest,
        output_dir=Path(args.output_dir),
        corr_method=args.corr_method,
    )


if __name__ == "__main__":
    main()

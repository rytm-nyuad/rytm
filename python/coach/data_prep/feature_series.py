"""Build a day×feature matrix for morning multi-day context from daily_features1."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Sequence

import pandas as pd
from supabase import Client

from data_prep.rolling_windows import FEATURE_ALIASES, KEY_FEATURES


def _feature_keys_to_fetch(features: Sequence[str]) -> List[str]:
    keys = set(features)
    for canonical in features:
        for alias in FEATURE_ALIASES.get(canonical, ()):
            keys.add(alias)
    # Needed for day-validity filters.
    keys.update({"sedentary_minutes", "sleep_duration_hours", "overall_score"})
    return sorted(keys)


def fetch_recent_feature_matrix(
    client: Client,
    user_id: str,
    *,
    as_of_date: date,
    lookback_days: int = 30,
    features: Optional[Sequence[str]] = None,
) -> pd.DataFrame:
    """
    Load daily_features1 for [as_of_date - lookback_days, as_of_date) and pivot.

    Returns a DataFrame indexed by feature_date (datetime64), columns = feature keys.
    Empty DataFrame if no rows (never raises).
    """
    feature_list = list(features) if features is not None else list(KEY_FEATURES)
    keys = _feature_keys_to_fetch(feature_list)
    start = (as_of_date - timedelta(days=lookback_days)).isoformat()
    end = as_of_date.isoformat()

    rows: List[Dict[str, Any]] = []
    page_size = 1000
    offset = 0
    try:
        while True:
            response = (
                client.table("daily_features1")
                .select("feature_date, feature_key, value_num")
                .eq("user_id", user_id)
                .in_("feature_key", keys)
                .gte("feature_date", start)
                .lt("feature_date", end)
                .order("feature_date")
                .range(offset, offset + page_size - 1)
                .execute()
            )
            batch = response.data or []
            rows.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size
    except Exception:
        return pd.DataFrame()

    if not rows:
        return pd.DataFrame()

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

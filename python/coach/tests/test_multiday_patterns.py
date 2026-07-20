"""Unit tests for multi-day day validity, rolling windows, and pattern detectors."""
from __future__ import annotations

import pandas as pd

from data_prep.day_validity import apply_day_validity
from data_prep.rolling_windows import compute_rolling_aggregates
from profiling.patterns import detect_active_patterns, domains_for_high_patterns, recovery_energy_cap_required


def _frame(rows):
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    return df.set_index("date").sort_index()


def test_day_validity_nulls_checkin_zero_sentinel_only():
    df = _frame([
        {
            "date": "2026-02-01",
            "sedentary_minutes": 1400,
            "steps": 8000,
            "sleep_duration_hours": 7.0,
            "sleep_efficiency": 90,
            "hrv_rmssd": 40,
            "mood_score": 60,
            "stress_score": 40,
        },
        {
            "date": "2026-02-02",
            "sedentary_minutes": 400,
            "steps": 5000,
            "sleep_duration_hours": 2.0,
            "sleep_efficiency": 50,
            "hrv_rmssd": 20,
            "mood_score": 55,
            "stress_score": 0,  # sentinel among non-zero checkins
            "energy_score": 50,
        },
    ])
    out = apply_day_validity(df)
    # High sedentary / short sleep are kept (no longer nulled).
    assert out.loc[pd.Timestamp("2026-02-01"), "steps"] == 8000
    assert out.loc[pd.Timestamp("2026-02-02"), "sleep_duration_hours"] == 2.0
    assert out.loc[pd.Timestamp("2026-02-02"), "hrv_rmssd"] == 20
    # Check-in zero sentinel still nulled.
    assert pd.isna(out.loc[pd.Timestamp("2026-02-02"), "stress_score"])
    assert out.loc[pd.Timestamp("2026-02-01"), "mood_score"] == 60


def test_rolling_requires_two_valid_days():
    df = _frame([
        {"date": "2026-02-01", "sleep_duration_hours": 7.0},
        {"date": "2026-02-02", "sleep_duration_hours": None},
        {"date": "2026-02-03", "sleep_duration_hours": None},
    ])
    rolling = compute_rolling_aggregates(df, features=["sleep_duration_hours"])
    sleep = rolling["sleep_duration_hours"]
    assert sleep["n_valid_in_window_3d"] == 1
    assert sleep["sleep_duration_hours_3d_mean"] is None


def test_low_streak_sleep_and_energy_cap():
    rows = []
    # Enough normal nights so p25 stays near/above absolute 5.0 threshold.
    for i, hours in enumerate([7.2, 7.0, 6.8, 7.1, 6.9, 7.0, 4.1, 3.9, 3.6]):
        rows.append({
            "date": f"2026-02-{i+1:02d}",
            "sleep_duration_hours": hours,
            "sedentary_minutes": 400,
            "mood_score": 50,
            "stress_score": 40,
            "energy_score": 50,
            "focus_score": 50,
            "social_score": 50,
            "steps": 6000,
            "hrv_rmssd": 45,
            "resting_heart_rate": 60,
            "sleep_efficiency": 88,
        })
    df = apply_day_validity(_frame(rows))
    rolling = compute_rolling_aggregates(df, features=["sleep_duration_hours"])
    patterns = detect_active_patterns(df, rolling=rolling)
    low = [p for p in patterns if p["type"] == "low_streak" and p["feature"] == "sleep_duration_hours"]
    assert low, patterns
    assert low[0]["days"] == 3
    assert low[0]["values"] == [4.1, 3.9, 3.6]
    assert "rolling" in low[0]
    assert "sleep_duration_hours_3d_mean" in low[0]["rolling"]
    assert recovery_energy_cap_required(patterns)
    assert "recovery" in domains_for_high_patterns(patterns) or low[0]["severity"] in ("medium", "high")

    deficit = [p for p in patterns if p["type"] == "cumulative_deficit"]
    assert deficit, patterns
    assert deficit[0].get("baseline_source", "").startswith("rolling")


def test_missing_day_breaks_streak():
    rows = [
        {"date": "2026-02-01", "sleep_duration_hours": 4.0, "sedentary_minutes": 400},
        {"date": "2026-02-02", "sleep_duration_hours": None, "sedentary_minutes": 400},
        {"date": "2026-02-03", "sleep_duration_hours": 3.5, "sedentary_minutes": 400},
        {"date": "2026-02-04", "sleep_duration_hours": 3.2, "sedentary_minutes": 400},
    ]
    df = apply_day_validity(_frame(rows))
    patterns = detect_active_patterns(df)
    low = [p for p in patterns if p["type"] == "low_streak" and p["feature"] == "sleep_duration_hours"]
    # Streak is only the trailing contiguous days (2), below K=3 → no low_streak
    assert not low, low

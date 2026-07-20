"""Unit tests for OS-only profiling pipeline (stdlib unittest)."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

COACH_DIR = Path(__file__).resolve().parents[1]
if str(COACH_DIR) not in sys.path:
    sys.path.insert(0, str(COACH_DIR))

from profiling.day_validity import apply_day_validity
from profiling.findings import compute_findings
from profiling.gates import (
    assign_cluster_status,
    build_interpreter_package,
    permutation_os_tiers_meaningful,
)
from profiling.template_profile import render_template_profile
from profiling.validate_profile import (
    INSUFFICIENT_DATA_SENTENCE,
    OS_TIERS_DISCLOSURE,
    validate_profile_v2,
)
from profiling.behavior_profile_store import PROFILE_VERSION_V2, profile_payload_from_row


def _sample_matrix(n: int = 21) -> pd.DataFrame:
    rng = np.random.RandomState(0)
    idx = pd.date_range("2026-01-01", periods=n, freq="D")
    os_vals = np.concatenate(
        [rng.normal(30, 5, 7), rng.normal(55, 5, 7), rng.normal(80, 5, 7)]
    )[:n]
    data = {
        "overall_score": os_vals,
        "sleep_duration_hours": rng.normal(6.5, 1.0, n),
        "sleep_efficiency": rng.normal(88, 3, n),
        "deep_ratio": rng.normal(20, 3, n),
        "rem_ratio": rng.normal(18, 3, n),
        "hrv_rmssd": rng.normal(40, 5, n),
        "sedentary_minutes": rng.normal(700, 50, n),
        "steps": rng.normal(8000, 1000, n),
        "mood": rng.normal(50, 10, n),
        "stress": rng.normal(45, 10, n),
        "energy": rng.normal(50, 10, n),
        "focus": rng.normal(50, 10, n),
        "social_connectedness": rng.normal(50, 10, n),
        "workload": rng.normal(50, 10, n),
        "emotions_count": rng.normal(3, 1, n),
    }
    return pd.DataFrame(data, index=idx)


class DayValidityTests(unittest.TestCase):
    def test_drops_missing_os(self):
        df = _sample_matrix(5)
        df.iloc[0, df.columns.get_loc("overall_score")] = np.nan
        out = apply_day_validity(df)
        self.assertEqual(len(out), 4)

    def test_high_sedentary_keeps_wearables(self):
        df = _sample_matrix(3)
        df.iloc[0, df.columns.get_loc("sedentary_minutes")] = 1400
        out = apply_day_validity(df)
        self.assertFalse(pd.isna(out.iloc[0]["steps"]))
        self.assertFalse(pd.isna(out.iloc[0]["mood"]))

    def test_zero_checkin_sentinel(self):
        df = _sample_matrix(3)
        df.loc[df.index[0], "mood"] = 0
        df.loc[df.index[0], "stress"] = 40
        out = apply_day_validity(df)
        self.assertTrue(pd.isna(out.loc[out.index[0], "mood"]))
        self.assertEqual(out.loc[out.index[0], "stress"], 40)


class GatesFindingsTests(unittest.TestCase):
    def test_assign_cluster_status_rules(self):
        self.assertEqual(
            assign_cluster_status(n_days=3, reportable_findings=[{}] * 5),
            "insufficient_data",
        )
        # >=5 days but the "interpreted" bar isn't cleared (findings present, none
        # independent_signal) -> "observational": real but explicitly hedged signal,
        # not silently collapsed to insufficient_data.
        self.assertEqual(
            assign_cluster_status(
                n_days=6,
                reportable_findings=[
                    {"signal_class": "concurrent_selfreport"},
                    {"signal_class": "concurrent_selfreport"},
                ],
            ),
            "observational",
        )
        # >=5 days but zero reportable findings at all -> still insufficient_data.
        self.assertEqual(
            assign_cluster_status(n_days=6, reportable_findings=[]),
            "insufficient_data",
        )
        self.assertEqual(
            assign_cluster_status(
                n_days=6,
                reportable_findings=[
                    {"signal_class": "independent_signal"},
                    {"signal_class": "concurrent_selfreport"},
                ],
            ),
            "interpreted",
        )

    def test_findings_and_package_smoke(self):
        df = _sample_matrix(21)
        labels = np.array(
            ["cluster_0"] * 7 + ["cluster_1"] * 7 + ["cluster_2"] * 7, dtype=object
        )
        df["sleep_duration_hours"] = np.concatenate(
            [np.full(7, 4.0), np.full(7, 6.5), np.full(7, 8.5)]
        )
        findings = compute_findings(df, labels)
        self.assertIn("reportable_findings", findings)
        package = build_interpreter_package(
            days_used=21,
            data_window_start="2026-01-01",
            data_window_end="2026-01-21",
            feature_matrix=df,
            semantic_labels=labels,
            findings=findings,
        )
        self.assertIn("os_tiers_meaningful", package)
        self.assertEqual(
            set(package["clusters"]), {"cluster_0", "cluster_1", "cluster_2"}
        )

    def test_permutation_separates_clear_tiers(self):
        scores = np.concatenate(
            [np.full(10, 20.0), np.full(10, 50.0), np.full(10, 80.0)]
        )
        labels = np.array(
            ["cluster_0"] * 10 + ["cluster_1"] * 10 + ["cluster_2"] * 10, dtype=object
        )
        result = permutation_os_tiers_meaningful(scores, labels, n_permutations=200)
        self.assertTrue(result["os_tiers_meaningful"])
        self.assertIsNotNone(result["null_quantile_value"])


class TemplateValidatorStoreTests(unittest.TestCase):
    def test_template_and_validator(self):
        df = _sample_matrix(21)
        labels = np.array(
            ["cluster_0"] * 7 + ["cluster_1"] * 7 + ["cluster_2"] * 7, dtype=object
        )
        findings = compute_findings(df, labels)
        package = build_interpreter_package(
            days_used=21,
            data_window_start="2026-01-01",
            data_window_end="2026-01-21",
            feature_matrix=df,
            semantic_labels=labels,
            findings=findings,
        )
        package["os_tiers_meaningful"] = False
        for key in package["clusters"]:
            package["clusters"][key]["status"] = "insufficient_data"
            package["clusters"][key]["reportable_findings"] = []

        profile = render_template_profile(package)
        self.assertEqual(profile["profile_version"], "cluster_profile_v2")
        self.assertTrue(profile["summary"].startswith(OS_TIERS_DISCLOSURE))
        self.assertIsNone(profile["primary_coaching_rule"])
        for key in ("cluster_0", "cluster_1", "cluster_2"):
            self.assertEqual(
                profile["cluster_interpretations"][key]["text"],
                INSUFFICIENT_DATA_SENTENCE,
            )

        ok, reasons = validate_profile_v2(profile, package)
        self.assertTrue(ok, reasons)

    def test_profile_payload_ignores_v1(self):
        empty = profile_payload_from_row(None)
        self.assertEqual(empty["profile_version"], "none")

        v1_row = {
            "profile_version": "cluster_profile_v1",
            "summary": "old",
            "cluster_interpretations_json": {"cluster_0": "x"},
            "primary_coaching_rule": "rule",
        }
        self.assertEqual(profile_payload_from_row(v1_row)["profile_version"], "none")

        v2_row = {
            "profile_json": {
                "profile_version": PROFILE_VERSION_V2,
                "summary": "ok",
                "cluster_interpretations": {},
                "primary_coaching_rule": None,
            }
        }
        payload = profile_payload_from_row(v2_row)
        self.assertEqual(payload["profile_version"], PROFILE_VERSION_V2)
        self.assertEqual(payload["summary"], "ok")


if __name__ == "__main__":
    unittest.main()

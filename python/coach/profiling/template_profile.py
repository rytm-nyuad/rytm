"""Deterministic template renderer for cluster_profile_v2 (validator fallback / A/B)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from profiling.findings import feature_surface_form
from profiling.validate_profile import (
    INSUFFICIENT_DATA_SENTENCE,
    OBSERVATIONAL_PREFIX,
    OS_TIERS_DISCLOSURE,
    PROFILE_VERSION_V2,
)


def _direction_phrase(direction: str) -> str:
    if direction == "above_user_mean":
        return "above"
    if direction == "below_user_mean":
        return "below"
    if direction == "rises_with_tier":
        return "higher on stronger overall-score tiers"
    if direction == "falls_with_tier":
        return "lower on stronger overall-score tiers"
    return direction.replace("_", " ")


def _format_finding(finding: Dict[str, Any]) -> str:
    feat = feature_surface_form(str(finding.get("feature") or "feature"))
    ftype = finding.get("type") or "deviation"
    if ftype == "trend":
        direction = _direction_phrase(str(finding.get("direction") or ""))
        return (
            f"Across overall-score tiers, {feat} tends to be {direction}."
        )
    direction = _direction_phrase(str(finding.get("direction") or ""))
    cluster_mean = finding.get("cluster_mean")
    user_mean = finding.get("user_mean")
    mag = finding.get("magnitude") or "moderate"
    return (
        f"On these mornings, {feat} tends to be {direction} this user's usual level "
        f"({_fmt(cluster_mean)} vs {_fmt(user_mean)}; {mag} deviation)."
    )


def _fmt(value: Any) -> str:
    if value is None:
        return "n/a"
    try:
        return f"{float(value):.1f}"
    except (TypeError, ValueError):
        return str(value)


def render_template_profile(package: Dict[str, Any]) -> Dict[str, Any]:
    """Produce a valid cluster_profile_v2 from the interpreter input package."""
    os_meaningful = bool(package.get("os_tiers_meaningful"))
    clusters_in = package.get("clusters") or {}

    interpretations: Dict[str, Any] = {}
    summary_bits: List[str] = []

    for key in ("cluster_0", "cluster_1", "cluster_2"):
        c = clusters_in.get(key) or {}
        status = c.get("status") or "insufficient_data"
        n_days = int(c.get("n_days") or 0)
        if status == "insufficient_data":
            text: Optional[str] = INSUFFICIENT_DATA_SENTENCE
        elif status == "observational":
            sentences = [
                _format_finding(finding) for finding in c.get("reportable_findings") or []
            ]
            note = c.get("tracking_note")
            if note:
                sentences.append(str(note))
            if not sentences:
                text = INSUFFICIENT_DATA_SENTENCE
                status = "insufficient_data"
            else:
                # Lower-confidence status: keep it short, no summary contribution.
                text = OBSERVATIONAL_PREFIX + " ".join(sentences[:2])
        else:
            sentences: List[str] = []
            for finding in c.get("reportable_findings") or []:
                # Prefer independent signals in template; include concurrent after
                sentences.append(_format_finding(finding))
            note = c.get("tracking_note")
            if note:
                sentences.append(str(note))
            if not sentences:
                text = INSUFFICIENT_DATA_SENTENCE
                status = "insufficient_data"
            else:
                # Cap length
                text = " ".join(sentences[:6])
                summary_bits.append(f"{key}: {sentences[0]}")
        interpretations[key] = {
            "status": status,
            "n_days": n_days,
            "text": text,
        }

    if not os_meaningful:
        summary = OS_TIERS_DISCLOSURE
        if summary_bits:
            summary = OS_TIERS_DISCLOSURE + " " + " ".join(summary_bits[:2])
        primary = None
    else:
        if summary_bits:
            summary = (
                "This user shows distinct morning overall-score tiers with "
                "co-occurring behavior patterns. " + " ".join(summary_bits[:3])
            )
        else:
            summary = (
                "This user has morning overall-score tiers; "
                "limited independent signals were available for interpretation."
            )
        # Prefer a rule from independent findings on cluster_0 if any
        c0 = clusters_in.get("cluster_0") or {}
        independent = [
            f
            for f in (c0.get("reportable_findings") or [])
            if f.get("signal_class") == "independent_signal"
            and f.get("type") != "trend"
        ]
        if independent and c0.get("status") == "interpreted":
            feat = feature_surface_form(str(independent[0].get("feature")))
            primary = (
                f"On lower overall-score mornings, pay attention to {feat} "
                f"relative to this user's usual level."
            )
        else:
            primary = (
                "Match coaching intensity to this morning's overall-score tier "
                "and reinforce patterns seen on stronger mornings."
            )

    return {
        "profile_version": PROFILE_VERSION_V2,
        "summary": summary,
        "cluster_interpretations": interpretations,
        "primary_coaching_rule": primary,
        "renderer": "template_profile",
    }

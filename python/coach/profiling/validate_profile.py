"""Mechanical validation of cluster_profile_v2 interpreter output."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Set, Tuple

from profiling.findings import FEATURE_SURFACE_FORMS, feature_surface_form

PROFILE_VERSION_V2 = "cluster_profile_v2"

INSUFFICIENT_DATA_SENTENCE = "Too few days of this type to characterize reliably."

# Required literal prefix for "observational" cluster text — a lower-confidence status
# (>=5 days, at least one finding, but not enough for "interpreted"). The prefix is the
# mechanical guardrail that keeps this content honestly hedged instead of read as a
# confirmed pattern.
OBSERVATIONAL_PREFIX = "Early signal, not yet a confirmed pattern: "

OS_TIERS_DISCLOSURE = (
    "This user's morning scores do not separate into distinct tiers; "
    "clusters below describe co-occurring behavior patterns only."
)

BANNED_TIER_WORDS = re.compile(
    r"\b(hardest|easiest|strongest|weakest|best|worst|toughest)\b",
    re.IGNORECASE,
)

CAUSAL_LANGUAGE = re.compile(
    r"\b(because|leads to|results in|causes|caused|drives|improves)\b",
    re.IGNORECASE,
)


def _build_alias_patterns(features: Set[str]) -> List[Tuple[str, re.Pattern[str]]]:
    """Map feature keys to regexes that catch snake_case and surface forms."""
    patterns: List[Tuple[str, re.Pattern[str]]] = []
    for feat in features:
        surface = feature_surface_form(feat)
        # Match feature key or surface form (word-ish)
        alts = [re.escape(feat), re.escape(surface)]
        # Also allow FEATURE_SURFACE_FORMS reverse extras
        if feat in FEATURE_SURFACE_FORMS:
            alts.append(re.escape(FEATURE_SURFACE_FORMS[feat]))
        pat = re.compile(r"(?:" + "|".join(alts) + r")", re.IGNORECASE)
        patterns.append((feat, pat))
    return patterns


def validate_profile_v2(
    profile: Dict[str, Any],
    package: Dict[str, Any],
) -> Tuple[bool, List[str]]:
    """Return (ok, list_of_rejection_reasons)."""
    reasons: List[str] = []

    if not isinstance(profile, dict):
        return False, ["profile_not_object"]

    if profile.get("profile_version") != PROFILE_VERSION_V2:
        reasons.append("bad_profile_version")

    summary = profile.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        reasons.append("summary_missing")

    primary = profile.get("primary_coaching_rule")
    if primary is not None and not isinstance(primary, str):
        reasons.append("primary_coaching_rule_bad_type")

    interpretations = profile.get("cluster_interpretations")
    if not isinstance(interpretations, dict):
        reasons.append("cluster_interpretations_missing")
        return False, reasons

    os_meaningful = bool(package.get("os_tiers_meaningful"))
    if not os_meaningful:
        if not (isinstance(summary, str) and summary.startswith(OS_TIERS_DISCLOSURE)):
            reasons.append("missing_os_tiers_disclosure")
        if primary is not None:
            reasons.append("primary_coaching_rule_must_be_null_when_tiers_not_meaningful")
        blob = " ".join(
            [
                summary or "",
                primary or "",
                *[
                    str((interpretations.get(k) or {}).get("text") or "")
                    for k in ("cluster_0", "cluster_1", "cluster_2")
                ],
            ]
        )
        if BANNED_TIER_WORDS.search(blob):
            reasons.append("banned_tier_words_when_tiers_not_meaningful")

    clusters_in = package.get("clusters") or {}
    for key in ("cluster_0", "cluster_1", "cluster_2"):
        out = interpretations.get(key)
        expected = clusters_in.get(key) or {}
        if not isinstance(out, dict):
            reasons.append(f"{key}_not_object")
            continue
        if out.get("status") != expected.get("status"):
            reasons.append(f"{key}_status_mismatch")
        if int(out.get("n_days") or -1) != int(expected.get("n_days") or -2):
            reasons.append(f"{key}_n_days_mismatch")

        text = out.get("text")
        status = expected.get("status")
        if status == "insufficient_data":
            if text != INSUFFICIENT_DATA_SENTENCE:
                reasons.append(f"{key}_insufficient_data_text_mismatch")
        else:
            if text is not None and (
                not isinstance(text, str) or not text.strip()
            ):
                reasons.append(f"{key}_interpreted_text_empty")
            if isinstance(text, str) and text.strip():
                if status == "observational" and not text.startswith(OBSERVATIONAL_PREFIX):
                    reasons.append(f"{key}_observational_prefix_missing")
                if CAUSAL_LANGUAGE.search(text):
                    reasons.append(f"{key}_causal_language")
                allowed_features = {
                    f.get("feature")
                    for f in (expected.get("reportable_findings") or [])
                    if f.get("feature")
                }
                # Tracking note is allowed content channel for missingness phrasing;
                # do not require feature names from it, but whitelist reportable only.
                _check_feature_whitelist(key, text, allowed_features, reasons)

    if isinstance(summary, str) and CAUSAL_LANGUAGE.search(summary):
        reasons.append("summary_causal_language")

    return len(reasons) == 0, reasons


def _check_feature_whitelist(
    cluster_key: str,
    text: str,
    allowed_features: Set[str],
    reasons: List[str],
) -> None:
    """
    Every feature *name* appearing in text must be in reportable_findings.

    Heuristic: scan for known feature keys / surface forms from the global map;
    if a known feature form appears and is not allowed for this cluster, reject.
    """
    # Only flag mentions of features that appear in the global catalog
    catalog = set(FEATURE_SURFACE_FORMS.keys())
    patterns = _build_alias_patterns(catalog)
    mentioned: Set[str] = set()
    for feat, pat in patterns:
        if pat.search(text):
            mentioned.add(feat)
    illegal = mentioned - allowed_features
    # overall_score often used narratively for tiers; allow it
    illegal.discard("overall_score")
    if illegal:
        reasons.append(
            f"{cluster_key}_feature_not_in_whitelist:{','.join(sorted(illegal))}"
        )


def format_validation_errors_for_retry(reasons: List[str]) -> str:
    return (
        "Previous output failed mechanical validation. Fix these issues and "
        "return JSON only:\n- " + "\n- ".join(reasons)
    )

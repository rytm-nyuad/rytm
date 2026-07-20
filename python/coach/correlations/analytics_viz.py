"""Deterministic analytics chart payload stored on archetype_json."""

from __future__ import annotations

import math
from typing import Any, Dict, List, Sequence

FEATURE_LABELS = {
    "overall_score": "Overall Score",
    "readiness_score": "Readiness",
    "sleep_duration_hours": "Sleep Duration",
    "sleep_efficiency": "Sleep Efficiency",
    "hrv_rmssd": "HRV",
    "total_active_minutes": "Active Minutes",
    "sedentary_minutes": "Sedentary Time",
    "social_connectedness": "Social Connectedness",
    "mood": "Mood",
    "stress": "Stress",
    "energy": "Energy",
    "focus": "Focus",
    "caffeine_cups": "Caffeine",
    "negative_emotion_ratio": "Negative Emotions",
}


def _label(raw: str) -> str:
    key = (raw or "").strip()
    if key in FEATURE_LABELS:
        return FEATURE_LABELS[key]
    spaced = key.replace("_", " ").replace("-", " ").strip()
    return " ".join(w[:1].upper() + w[1:] for w in spaced.split() if w)


def _split_pair(item: Dict[str, Any]) -> tuple[str, str]:
    a = item.get("feature_a")
    b = item.get("feature_b")
    if isinstance(a, str) and a.strip() and isinstance(b, str) and b.strip():
        return a.strip(), b.strip()
    pair = str(item.get("pair") or "")
    for sep in ("–", "—", "-", "|"):
        if sep in pair:
            parts = [p.strip() for p in pair.split(sep) if p.strip()]
            if len(parts) >= 2:
                return parts[0], parts[1]
    return pair or "signal", pair or "signal"


def build_analytics_viz(
    correlations: Sequence[Dict[str, Any]], *, limit: int = 6
) -> Dict[str, Any]:
    top: List[Dict[str, Any]] = []
    for item in correlations:
        if not isinstance(item, dict):
            continue
        rho = item.get("rho")
        try:
            rho_f = float(rho)
        except (TypeError, ValueError):
            continue
        a, b = _split_pair(item)
        top.append(
            {
                "id": f"{a}|{b}",
                "label": f"{_label(a)} → {_label(b)}",
                "feature_a": a,
                "feature_b": b,
                "rho": rho_f,
                "abs_rho": abs(rho_f),
            }
        )
    top.sort(key=lambda x: x["abs_rho"], reverse=True)
    top = top[:limit]

    node_ids: List[str] = []
    seen = set()
    for edge in top:
        for nid in (edge["feature_a"], edge["feature_b"]):
            if nid not in seen:
                seen.add(nid)
                node_ids.append(nid)

    cx, cy = 160.0, 120.0
    radius = min(95.0, 40.0 + len(node_ids) * 8.0)
    n = max(len(node_ids), 1)
    nodes = []
    for i, nid in enumerate(node_ids):
        angle = (-math.pi / 2) + (i * (2 * math.pi)) / n
        nodes.append(
            {
                "id": nid,
                "label": _label(nid),
                "x": cx + radius * math.cos(angle),
                "y": cy + radius * math.sin(angle),
            }
        )

    return {
        "bars": top,
        "network": {
            "nodes": nodes,
            "edges": [
                {
                    "id": e["id"],
                    "source": e["feature_a"],
                    "target": e["feature_b"],
                    "rho": e["rho"],
                    "abs_rho": e["abs_rho"],
                }
                for e in top
            ],
        },
    }

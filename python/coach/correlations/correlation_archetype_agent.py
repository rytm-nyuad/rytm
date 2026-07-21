"""
LLM agent that turns trusted Spearman edges into a free-form correlation archetype.
"""
from __future__ import annotations

import json
import os
import re
import sys
from typing import Any, Dict, List, Optional

import requests

from llm.llm_config import LlmClientConfig, resolve_behavior_profile_llm_config
from correlations.analytics_viz import build_analytics_viz
from llm.prompts import CORRELATION_ARCHETYPE_INTERPRETER_SYSTEM_PROMPT


def debug_log(msg: str) -> None:
    print(msg, file=sys.stderr)


# Soft ban-list for clinical / stigmatizing language (case-insensitive substring).
BANNED_SUBSTRINGS = [
    "diagnos",
    "disorder",
    "depression",
    "anxiety disorder",
    "bipolar",
    "ptsd",
    "adhd",
    "patholog",
    "mental illness",
    "psychiatr",
    "prescription",
    "medication",
    "suicid",
    "self-harm",
    "addiction",
    "abuse",
    "trauma survivor",
    "borderline",
]


class CorrelationArchetypeValidationError(ValueError):
    """Raised when the LLM returns a malformed or unsafe archetype payload."""


class CorrelationArchetypeInterpreter:
    def __init__(
        self,
        config: Optional[LlmClientConfig] = None,
        *,
        api_key: Optional[str] = None,
        model_name: Optional[str] = None,
        base_url: Optional[str] = None,
        provider: Optional[str] = None,
    ):
        if config is not None:
            self.config = config
        elif api_key and base_url and model_name:
            api_base = base_url
            if api_base.rstrip("/").endswith("/chat/completions"):
                api_base = api_base.rstrip("/")[: -len("/chat/completions")]
            self.config = LlmClientConfig(
                provider=provider or "openai",  # type: ignore[arg-type]
                api_key=api_key,
                api_base=api_base,
                model=model_name,
                env_key_name="explicit",
            )
        else:
            self.config = resolve_behavior_profile_llm_config()

    def build_evidence_payload(
        self,
        *,
        trusted_edges: List[Dict[str, Any]],
        distinctive_edges: List[Dict[str, Any]],
        correlation_metadata: Dict[str, Any],
        quality_evaluation: Dict[str, Any],
        days_used: int,
        days_after_junk_filter: int,
        data_window_start: str,
        data_window_end: str,
    ) -> Dict[str, Any]:
        return {
            "days_used": days_used,
            "days_after_junk_filter": days_after_junk_filter,
            "data_window_start": data_window_start,
            "data_window_end": data_window_end,
            "trusted_edges": trusted_edges,
            "distinctive_edges": distinctive_edges,
            "distinctiveness_available": bool(
                (correlation_metadata or {}).get("distinctiveness_available")
            ),
            "correlation_metadata": {
                "method": (correlation_metadata or {}).get("method"),
                "junk_filters": (correlation_metadata or {}).get("junk_filters"),
                "junk_days_dropped": (correlation_metadata or {}).get("junk_days_dropped"),
                "quality_thresholds": (correlation_metadata or {}).get(
                    "quality_thresholds"
                ),
            },
            "quality_evaluation": {
                "passed": quality_evaluation.get("passed"),
                "warnings": quality_evaluation.get("warnings") or [],
                "trusted_edge_count": quality_evaluation.get("trusted_edge_count"),
                "trusted_density": quality_evaluation.get("trusted_density"),
            },
        }

    def interpret(
        self,
        *,
        trusted_edges: List[Dict[str, Any]],
        distinctive_edges: List[Dict[str, Any]],
        correlation_metadata: Dict[str, Any],
        quality_evaluation: Dict[str, Any],
        days_used: int,
        days_after_junk_filter: int,
        data_window_start: str,
        data_window_end: str,
        system_prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        evidence = self.build_evidence_payload(
            trusted_edges=trusted_edges,
            distinctive_edges=distinctive_edges,
            correlation_metadata=correlation_metadata,
            quality_evaluation=quality_evaluation,
            days_used=days_used,
            days_after_junk_filter=days_after_junk_filter,
            data_window_start=data_window_start,
            data_window_end=data_window_end,
        )
        user_prompt = f"""Evidence package for this user's correlation-archetype interpretation:
{json.dumps(evidence, indent=2)}

Return the correlation archetype JSON only."""

        prompt = system_prompt or CORRELATION_ARCHETYPE_INTERPRETER_SYSTEM_PROMPT
        response = self._call_llm(prompt, user_prompt)
        parsed = self._parse_json(response)
        allowed_pairs = {
            (e.get("pair") or f"{e.get('feature_a')}–{e.get('feature_b')}")
            for e in (trusted_edges + distinctive_edges)
        }
        allowed_pair_keys = {
            e.get("pair_key")
            for e in (trusted_edges + distinctive_edges)
            if e.get("pair_key")
        }
        return self._validate_and_normalize(
            parsed,
            allowed_pairs=allowed_pairs,
            allowed_pair_keys=allowed_pair_keys,
            trusted_edges=trusted_edges,
            distinctive_edges=distinctive_edges,
        )

    def _call_llm(self, system_prompt: str, user_prompt: str) -> str:
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }
        if self.config.provider == "openrouter":
            referer = os.getenv("NEXT_PUBLIC_APP_URL") or os.getenv(
                "NEXT_PUBLIC_SUPABASE_URL"
            )
            if referer:
                headers["HTTP-Referer"] = referer
            headers["X-OpenRouter-Title"] = "RYTM Coach"

        payload: Dict[str, Any] = {
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0,
            "response_format": {"type": "json_object"},
        }

        response = requests.post(
            self.config.chat_completions_url,
            headers=headers,
            json=payload,
            timeout=120,
        )
        if not response.ok:
            if response.status_code == 400 and "response_format" in (response.text or ""):
                payload.pop("response_format", None)
                response = requests.post(
                    self.config.chat_completions_url,
                    headers=headers,
                    json=payload,
                    timeout=120,
                )
            if not response.ok:
                raise ValueError(
                    f"{self.config.provider} request failed: "
                    f"{response.status_code} {response.text}"
                )

        content = response.json()["choices"][0]["message"]["content"]
        if not content or not str(content).strip():
            raise ValueError("Correlation archetype interpreter returned empty response")
        return str(content)

    def _parse_json(self, response: str) -> Dict[str, Any]:
        text = response.strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
        parsed = json.loads(text)
        if not isinstance(parsed, dict):
            raise CorrelationArchetypeValidationError(
                f"LLM output must be a JSON object, got {type(parsed).__name__}"
            )
        return parsed

    def _assert_safe_text(self, field: str, value: str) -> None:
        lowered = value.lower()
        for banned in BANNED_SUBSTRINGS:
            if banned in lowered:
                raise CorrelationArchetypeValidationError(
                    f"`{field}` contains disallowed language ({banned!r})"
                )

    def _validate_and_normalize(
        self,
        payload: Dict[str, Any],
        *,
        allowed_pairs: set,
        allowed_pair_keys: set,
        trusted_edges: List[Dict[str, Any]],
        distinctive_edges: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        required_strings = [
            "archetype_title",
            "summary",
            "what_heatmap_shows",
            "what_it_reflects",
            "core_insight_basis",
            "core_insight",
            "strength_basis",
            "strength",
            "primary_coaching_rule",
        ]
        normalized: Dict[str, Any] = {}
        for key in required_strings:
            value = payload.get(key)
            if not isinstance(value, str) or not value.strip():
                raise CorrelationArchetypeValidationError(
                    f"`{key}` must be a non-empty string"
                )
            text = value.strip()
            if key == "archetype_title" and len(text) > 60:
                text = text[:60].rstrip()
            if key == "summary" and len(text) > 400:
                text = text[:400].rstrip()
            self._assert_safe_text(key, text)
            normalized[key] = text

        key_correlations = payload.get("key_correlations")
        if not isinstance(key_correlations, list) or not key_correlations:
            raise CorrelationArchetypeValidationError(
                "`key_correlations` must be a non-empty list"
            )

        edge_by_pair = {
            (e.get("pair") or f"{e.get('feature_a')}–{e.get('feature_b')}"): e
            for e in (trusted_edges + distinctive_edges)
        }

        normalized_keys: List[Dict[str, Any]] = []
        for item in key_correlations[:6]:
            if not isinstance(item, dict):
                continue
            pair = item.get("pair")
            if not isinstance(pair, str) or not pair.strip():
                continue
            pair = pair.strip()
            # Allow flexible dash characters.
            pair_norm = pair.replace("—", "–").replace("-", "–")
            matched = None
            for candidate in list(allowed_pairs) + list(edge_by_pair.keys()):
                if not candidate:
                    continue
                cand_norm = str(candidate).replace("—", "–").replace("-", "–")
                if cand_norm == pair_norm or candidate == pair:
                    matched = edge_by_pair.get(candidate) or edge_by_pair.get(pair)
                    pair = str(candidate)
                    break
            if matched is None and pair not in allowed_pairs and pair_norm not in {
                str(p).replace("—", "–").replace("-", "–") for p in allowed_pairs if p
            }:
                # Drop invented pairs rather than failing the whole profile when possible.
                continue

            source = matched or edge_by_pair.get(pair) or {}
            note = item.get("note")
            if not isinstance(note, str) or not note.strip():
                note = ""
            else:
                note = note.strip()
                self._assert_safe_text("key_correlations.note", note)

            rho = source.get("rho", item.get("rho"))
            try:
                rho_f = float(rho) if rho is not None else None
            except (TypeError, ValueError):
                rho_f = None

            vs_typical = source.get("vs_typical")
            if vs_typical is None and item.get("vs_typical") is not None:
                vs_typical = item.get("vs_typical")

            feature_a = source.get("feature_a") or item.get("feature_a")
            feature_b = source.get("feature_b") or item.get("feature_b")
            if (not feature_a or not feature_b) and "–" in pair.replace("—", "–").replace("-", "–"):
                parts = [
                    p.strip()
                    for p in pair.replace("—", "–").replace("-", "–").split("–")
                    if p.strip()
                ]
                if len(parts) >= 2:
                    feature_a = feature_a or parts[0]
                    feature_b = feature_b or parts[1]

            normalized_keys.append(
                {
                    "pair": pair,
                    "feature_a": feature_a,
                    "feature_b": feature_b,
                    "rho": rho_f,
                    "n_pairs": source.get("n_pairs") or item.get("n_pairs"),
                    "vs_typical": vs_typical,
                    "note": note,
                }
            )

        if len(normalized_keys) < 1:
            raise CorrelationArchetypeValidationError(
                "`key_correlations` must cite at least one trusted edge"
            )

        profile_version = payload.get("profile_version", "correlation_archetype_v1")
        if not isinstance(profile_version, str) or not profile_version.strip():
            raise CorrelationArchetypeValidationError(
                "`profile_version` must be a non-empty string when provided"
            )

        return {
            "profile_version": profile_version.strip(),
            **normalized,
            "key_correlations": normalized_keys,
            # Precomputed chart geometry for Analytics UI (avoids rebuild on read).
            "analytics_viz": build_analytics_viz(normalized_keys),
        }

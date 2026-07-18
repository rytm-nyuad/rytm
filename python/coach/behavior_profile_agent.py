"""
LLM agent that turns per-user cluster statistics into a coaching behavior profile.
"""
from __future__ import annotations

import json
import os
import re
import sys
from typing import Any, Dict, Optional

import requests

from llm_config import LlmClientConfig, resolve_behavior_profile_llm_config
from prompts import BEHAVIOR_PROFILE_INTERPRETER_SYSTEM_PROMPT


def debug_log(msg: str) -> None:
    print(msg, file=sys.stderr)


class BehaviorProfileValidationError(ValueError):
    """Raised when the LLM returns a malformed behavior profile payload."""


class BehaviorProfileInterpreter:
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
            # Explicit construction (tests or callers passing values directly).
            # base_url may be either an API base or a full chat/completions URL.
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

    @classmethod
    def from_env(cls) -> "BehaviorProfileInterpreter":
        return cls(config=resolve_behavior_profile_llm_config())

    def build_evidence_payload(
        self,
        *,
        cluster_stats: Dict[str, Any],
        clustering_metadata: Dict[str, Any],
        quality_evaluation: Dict[str, Any],
        days_used: int,
        data_window_start: str,
        data_window_end: str,
    ) -> Dict[str, Any]:
        return {
            "days_used": days_used,
            "data_window_start": data_window_start,
            "data_window_end": data_window_end,
            "cluster_stats": cluster_stats,
            "clustering_metadata": clustering_metadata,
            "quality_evaluation": {
                "passed": quality_evaluation.get("passed"),
                "warnings": quality_evaluation.get("warnings") or [],
                "silhouette_score": quality_evaluation.get("silhouette_score"),
                "stability_score": quality_evaluation.get("stability_score"),
                "stability_method": quality_evaluation.get("stability_method"),
                "successful_stability_runs": quality_evaluation.get(
                    "successful_stability_runs"
                ),
                "total_stability_runs": quality_evaluation.get("total_stability_runs"),
                "cluster_size_balance": quality_evaluation.get("cluster_size_balance"),
                "overall_score_separation": quality_evaluation.get(
                    "overall_score_separation"
                ),
                "quality_thresholds": quality_evaluation.get("quality_thresholds"),
                # Rejection reasons are omitted intentionally: LLM is only called after pass.
                "limitations": quality_evaluation.get("warnings") or [],
            },
            "days_per_cluster": (cluster_stats or {}).get("days_per_cluster") or {},
        }

    def interpret(
        self,
        *,
        cluster_stats: Dict[str, Any],
        clustering_metadata: Dict[str, Any],
        quality_evaluation: Dict[str, Any],
        days_used: int,
        data_window_start: str,
        data_window_end: str,
    ) -> Dict[str, Any]:
        evidence = self.build_evidence_payload(
            cluster_stats=cluster_stats,
            clustering_metadata=clustering_metadata,
            quality_evaluation=quality_evaluation,
            days_used=days_used,
            data_window_start=data_window_start,
            data_window_end=data_window_end,
        )
        user_prompt = f"""Evidence package for this user's behavior-profile interpretation:
{json.dumps(evidence, indent=2)}

Return the behavior profile JSON only."""

        response = self._call_llm(BEHAVIOR_PROFILE_INTERPRETER_SYSTEM_PROMPT, user_prompt)
        parsed = self._parse_json(response)
        return self._validate_and_normalize_profile(parsed)

    def _call_llm(self, system_prompt: str, user_prompt: str) -> str:
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }
        if self.config.provider == "openrouter":
            referer = os.getenv("NEXT_PUBLIC_APP_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
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
            # Some OpenRouter models reject response_format; retry once without it.
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
            raise ValueError("Behavior profile interpreter returned empty response")
        return str(content)

    def _parse_json(self, response: str) -> Dict[str, Any]:
        text = response.strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
        parsed = json.loads(text)
        if not isinstance(parsed, dict):
            raise BehaviorProfileValidationError(
                f"LLM output must be a JSON object, got {type(parsed).__name__}"
            )
        return parsed

    def _validate_and_normalize_profile(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise BehaviorProfileValidationError("Top-level LLM result must be a dictionary")

        summary = payload.get("summary")
        if not isinstance(summary, str) or not summary.strip():
            raise BehaviorProfileValidationError("`summary` must be a non-empty string")

        primary = payload.get("primary_coaching_rule")
        if not isinstance(primary, str) or not primary.strip():
            raise BehaviorProfileValidationError(
                "`primary_coaching_rule` must be a non-empty string"
            )

        interpretations = payload.get("cluster_interpretations")
        if not isinstance(interpretations, dict):
            raise BehaviorProfileValidationError(
                "`cluster_interpretations` must be a dictionary"
            )

        normalized_interpretations: Dict[str, str] = {}
        for key, value in interpretations.items():
            semantic_key = key if str(key).startswith("cluster_") else f"cluster_{key}"
            if not isinstance(value, str) or not value.strip():
                raise BehaviorProfileValidationError(
                    f"`cluster_interpretations.{semantic_key}` must be a non-empty string"
                )
            normalized_interpretations[semantic_key] = value.strip()

        for required in ("cluster_0", "cluster_1", "cluster_2"):
            if required not in normalized_interpretations:
                raise BehaviorProfileValidationError(
                    f"Missing required cluster interpretation: {required}"
                )

        profile_version = payload.get("profile_version", "cluster_profile_v1")
        if not isinstance(profile_version, str) or not profile_version.strip():
            raise BehaviorProfileValidationError(
                "`profile_version` must be a non-empty string when provided"
            )

        return {
            "profile_version": profile_version.strip(),
            "summary": summary.strip(),
            "cluster_interpretations": {
                "cluster_0": normalized_interpretations["cluster_0"],
                "cluster_1": normalized_interpretations["cluster_1"],
                "cluster_2": normalized_interpretations["cluster_2"],
            },
            "primary_coaching_rule": primary.strip(),
        }

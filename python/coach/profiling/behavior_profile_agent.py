"""
LLM agent that turns clustering evidence into a coaching behavior profile.

Production (v2): interpret_findings_package() — pre-digested findings only.
Experiments (v1): interpret() — raw cluster_stats tables (legacy).
"""
from __future__ import annotations

import json
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

import requests

from llm.llm_config import LlmClientConfig, resolve_behavior_profile_llm_config
from llm.prompts import (
    BEHAVIOR_PROFILE_INTERPRETER_SYSTEM_PROMPT_V1,
    BEHAVIOR_PROFILE_INTERPRETER_SYSTEM_PROMPT_V2,
)


def debug_log(msg: str) -> None:
    print(msg, file=sys.stderr)


FEATURE_TIMING_NOTES: Dict[str, str] = {
    "overall_score": (
        "Self-reported at the BEGINNING of the local calendar day (morning), before most waking "
        "behavior that day. Used to order semantic clusters (cluster_0/1/2). Not an end-of-day summary."
    ),
    "same_feature_date_alignment": (
        "Other daily_features1 values share the SAME feature_date as overall_score. "
        "Example: Monday overall_score = Monday morning; Monday sleep = Sunday night→Monday morning; "
        "Monday activity/check-in/etc. = Monday's stored day values."
    ),
    "interpretation_framing": (
        "Clusters are morning starting-state day-types with same-date co-occurring features. "
        "Do not describe features as caused by overall_score, and do not treat sleep as a prior "
        "calendar day's leftover under a different date label."
    ),
}


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
        feature_timing: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        return {
            "days_used": days_used,
            "data_window_start": data_window_start,
            "data_window_end": data_window_end,
            "feature_timing": feature_timing or FEATURE_TIMING_NOTES,
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
        system_prompt: Optional[str] = None,
        feature_timing: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Legacy v1 path: raw cluster_stats tables (experiments)."""
        evidence = self.build_evidence_payload(
            cluster_stats=cluster_stats,
            clustering_metadata=clustering_metadata,
            quality_evaluation=quality_evaluation,
            days_used=days_used,
            data_window_start=data_window_start,
            data_window_end=data_window_end,
            feature_timing=feature_timing,
        )
        user_prompt = f"""Evidence package for this user's behavior-profile interpretation:
{json.dumps(evidence, indent=2)}

Return the behavior profile JSON only."""

        prompt = system_prompt or BEHAVIOR_PROFILE_INTERPRETER_SYSTEM_PROMPT_V1
        response = self._call_llm(prompt, user_prompt)
        parsed = self._parse_json(response)
        return self._validate_and_normalize_profile_v1(parsed)

    def interpret_findings_package(
        self,
        package: Dict[str, Any],
        *,
        system_prompt: Optional[str] = None,
        validation_errors: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Production v2 path: pre-digested findings package only."""
        user_prompt = f"""Pre-digested findings package for this user's behavior-profile interpretation:
{json.dumps(package, indent=2)}

Return the behavior profile JSON only (cluster_profile_v2 schema)."""
        if validation_errors:
            from profiling.validate_profile import format_validation_errors_for_retry

            user_prompt += "\n\n" + format_validation_errors_for_retry(validation_errors)

        prompt = system_prompt or BEHAVIOR_PROFILE_INTERPRETER_SYSTEM_PROMPT_V2
        response = self._call_llm(prompt, user_prompt)
        parsed = self._parse_json(response)
        return self._validate_and_normalize_profile_v2(parsed)

    def interpret_findings_package_with_validation(
        self,
        package: Dict[str, Any],
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """
        Call interpreter, mechanically validate, retry once, then template fallback.

        Returns (profile_payload, validator_meta).
        """
        from profiling.template_profile import render_template_profile
        from profiling.validate_profile import validate_profile_v2

        meta: Dict[str, Any] = {
            "attempts": [],
            "source": None,
            "final_ok": False,
        }

        try:
            profile = self.interpret_findings_package(package)
            ok, reasons = validate_profile_v2(profile, package)
            meta["attempts"].append({"ok": ok, "reasons": reasons, "source": "llm"})
            if ok:
                meta["source"] = "llm"
                meta["final_ok"] = True
                return profile, meta

            profile = self.interpret_findings_package(
                package, validation_errors=reasons
            )
            ok2, reasons2 = validate_profile_v2(profile, package)
            meta["attempts"].append({"ok": ok2, "reasons": reasons2, "source": "llm_retry"})
            if ok2:
                meta["source"] = "llm_retry"
                meta["final_ok"] = True
                return profile, meta

            debug_log(
                f"behavior_profile_v2 validator rejected LLM twice: {reasons2}"
            )
        except Exception as exc:  # noqa: BLE001
            meta["attempts"].append(
                {"ok": False, "reasons": [f"llm_error:{exc}"], "source": "llm"}
            )
            debug_log(f"behavior_profile_v2 LLM failed: {exc}")

        template = render_template_profile(package)
        ok_t, reasons_t = validate_profile_v2(template, package)
        meta["attempts"].append(
            {"ok": ok_t, "reasons": reasons_t, "source": "template"}
        )
        meta["source"] = "template"
        meta["final_ok"] = bool(ok_t)
        if not ok_t:
            debug_log(f"template_profile failed validation unexpectedly: {reasons_t}")
        return template, meta

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

    def _validate_and_normalize_profile_v1(self, payload: Dict[str, Any]) -> Dict[str, Any]:
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

    # Back-compat alias
    _validate_and_normalize_profile = _validate_and_normalize_profile_v1

    def _validate_and_normalize_profile_v2(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise BehaviorProfileValidationError("Top-level LLM result must be a dictionary")

        summary = payload.get("summary")
        if not isinstance(summary, str) or not summary.strip():
            raise BehaviorProfileValidationError("`summary` must be a non-empty string")

        primary = payload.get("primary_coaching_rule")
        if primary is not None and not isinstance(primary, str):
            raise BehaviorProfileValidationError(
                "`primary_coaching_rule` must be a string or null"
            )
        if isinstance(primary, str) and not primary.strip():
            primary = None

        interpretations = payload.get("cluster_interpretations")
        if not isinstance(interpretations, dict):
            raise BehaviorProfileValidationError(
                "`cluster_interpretations` must be a dictionary"
            )

        normalized: Dict[str, Any] = {}
        for required in ("cluster_0", "cluster_1", "cluster_2"):
            raw = interpretations.get(required)
            if not isinstance(raw, dict):
                raise BehaviorProfileValidationError(
                    f"`cluster_interpretations.{required}` must be an object"
                )
            status = raw.get("status")
            if status not in ("interpreted", "insufficient_data"):
                raise BehaviorProfileValidationError(
                    f"`cluster_interpretations.{required}.status` invalid"
                )
            n_days = raw.get("n_days")
            try:
                n_days_int = int(n_days)
            except (TypeError, ValueError) as exc:
                raise BehaviorProfileValidationError(
                    f"`cluster_interpretations.{required}.n_days` must be int"
                ) from exc
            text = raw.get("text")
            if text is not None and not isinstance(text, str):
                raise BehaviorProfileValidationError(
                    f"`cluster_interpretations.{required}.text` must be string or null"
                )
            normalized[required] = {
                "status": status,
                "n_days": n_days_int,
                "text": text.strip() if isinstance(text, str) else None,
            }

        profile_version = payload.get("profile_version", "cluster_profile_v2")
        if not isinstance(profile_version, str) or not profile_version.strip():
            raise BehaviorProfileValidationError("`profile_version` must be a string")

        return {
            "profile_version": profile_version.strip(),
            "summary": summary.strip(),
            "cluster_interpretations": normalized,
            "primary_coaching_rule": (
                primary.strip() if isinstance(primary, str) else None
            ),
        }

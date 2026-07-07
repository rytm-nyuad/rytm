"""
LLM agent that turns per-user cluster statistics into a coaching behavior profile.
"""
from __future__ import annotations

import json
import re
import sys
from typing import Any, Dict

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from prompts import BEHAVIOR_PROFILE_INTERPRETER_SYSTEM_PROMPT


def debug_log(msg: str) -> None:
    print(msg, file=sys.stderr)


class BehaviorProfileInterpreter:
    def __init__(self, openrouter_api_key: str, model_name: str = "deepseek/deepseek-v3.2"):
        self.model_name = model_name
        self.llm = ChatOpenAI(
            model=model_name,
            api_key=openrouter_api_key,
            base_url="https://openrouter.ai/api/v1",
            temperature=0,
        )

    def interpret(self, cluster_stats: Dict[str, Any]) -> Dict[str, Any]:
        user_prompt = f"""Cluster statistics for this user:
{json.dumps(cluster_stats, indent=2)}

Return the behavior profile JSON."""

        response = self._call_llm(BEHAVIOR_PROFILE_INTERPRETER_SYSTEM_PROMPT, user_prompt)
        parsed = self._parse_json(response)
        return self._normalize_profile(parsed)

    def _call_llm(self, system_prompt: str, user_prompt: str) -> str:
        response = self.llm.invoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_prompt),
            ]
        )
        content = response.content
        if not content or not str(content).strip():
            raise ValueError("Behavior profile interpreter returned empty response")
        return str(content)

    def _parse_json(self, response: str) -> Dict[str, Any]:
        text = response.strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
        return json.loads(text)

    def _normalize_profile(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        interpretations = payload.get("cluster_interpretations") or {}
        normalized_interpretations = {
            key if str(key).startswith("cluster_") else f"cluster_{key}": value
            for key, value in interpretations.items()
        }
        for required in ("cluster_0", "cluster_1", "cluster_2"):
            normalized_interpretations.setdefault(required, "")

        return {
            "profile_version": payload.get("profile_version", "cluster_profile_v1"),
            "summary": payload.get("summary", "").strip(),
            "cluster_interpretations": normalized_interpretations,
            "primary_coaching_rule": payload.get("primary_coaching_rule", "").strip(),
        }

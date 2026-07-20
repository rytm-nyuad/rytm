"""
LLM provider selection for coach Python scripts.

Shared provider values:
  openai      -> OPENAI_API_KEY  + https://api.openai.com/v1
  openrouter  -> OPENROUTER_API_KEY + https://openrouter.ai/api/v1

Morning coach pipeline (langgraph / run_pipeline):
  COACH_LLM_PROVIDER=openai|openrouter
  COACH_LLM_MODEL=...   (optional override)

  Defaults: provider=openrouter (preserves existing pipeline behavior),
            model=gpt-5.4-mini for openrouter, gpt-4.1 for openai

Behavior-profile clustering interpreter:
  BEHAVIOR_PROFILE_LLM_PROVIDER=openai|openrouter
  BEHAVIOR_PROFILE_LLM_MODEL=...   (optional override)

  Defaults: provider=openai,
            model=gpt-4.1 for openai, deepseek/deepseek-v3.2 for openrouter
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal, Mapping, Optional

LlmProvider = Literal["openai", "openrouter"]

DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
DEFAULT_OPENAI_COACH_MODEL = "gpt-4.1"
DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v3.2"
DEFAULT_COACH_OPENROUTER_MODEL = "gpt-5.4-mini"

OPENAI_API_BASE = "https://api.openai.com/v1"
OPENROUTER_API_BASE = "https://openrouter.ai/api/v1"


@dataclass(frozen=True)
class LlmClientConfig:
    provider: LlmProvider
    api_key: str
    api_base: str
    model: str
    env_key_name: str

    @property
    def chat_completions_url(self) -> str:
        return f"{self.api_base.rstrip('/')}/chat/completions"

    @property
    def base_url(self) -> str:
        """Backward-compatible alias used by requests-based callers."""
        return self.chat_completions_url

    def langchain_default_headers(self) -> Optional[Mapping[str, str]]:
        if self.provider != "openrouter":
            return None
        headers = {"X-OpenRouter-Title": "RYTM Coach"}
        referer = os.getenv("NEXT_PUBLIC_APP_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
        if referer:
            headers["HTTP-Referer"] = referer
        return headers


def _normalize_provider(raw: Optional[str], *, env_name: str) -> LlmProvider:
    value = (raw or "").strip().lower()
    if value in ("openai", "openrouter"):
        return value  # type: ignore[return-value]
    raise ValueError(
        f"Invalid {env_name}={raw!r}. Expected 'openai' or 'openrouter'."
    )


def _resolve_llm_config(
    *,
    provider_env: str,
    model_env: str,
    default_provider: LlmProvider,
    openai_default_model: str,
    openrouter_default_model: str,
) -> LlmClientConfig:
    raw_provider = os.getenv(provider_env)
    provider = (
        _normalize_provider(raw_provider, env_name=provider_env)
        if raw_provider and raw_provider.strip()
        else default_provider
    )

    if provider == "openai":
        api_key = os.getenv("OPENAI_API_KEY")
        env_key_name = "OPENAI_API_KEY"
        api_base = OPENAI_API_BASE
        default_model = openai_default_model
    else:
        api_key = os.getenv("OPENROUTER_API_KEY")
        env_key_name = "OPENROUTER_API_KEY"
        api_base = OPENROUTER_API_BASE
        default_model = openrouter_default_model

    if not api_key or not str(api_key).strip():
        raise ValueError(
            f"{env_key_name} is missing/empty but {provider_env}={provider}"
        )

    model = (os.getenv(model_env) or default_model).strip()
    return LlmClientConfig(
        provider=provider,
        api_key=api_key.strip(),
        api_base=api_base,
        model=model,
        env_key_name=env_key_name,
    )


def resolve_behavior_profile_llm_config() -> LlmClientConfig:
    """Resolve API key, URL, and model for behavior-profile LLM calls."""
    return _resolve_llm_config(
        provider_env="BEHAVIOR_PROFILE_LLM_PROVIDER",
        model_env="BEHAVIOR_PROFILE_LLM_MODEL",
        default_provider="openai",
        openai_default_model=DEFAULT_OPENAI_COACH_MODEL,
        openrouter_default_model=DEFAULT_OPENROUTER_MODEL,
    )


def resolve_coach_pipeline_llm_config() -> LlmClientConfig:
    """Resolve API key, URL, and model for the morning coach LangGraph pipeline."""
    return _resolve_llm_config(
        provider_env="COACH_LLM_PROVIDER",
        model_env="COACH_LLM_MODEL",
        default_provider="openrouter",
        openai_default_model=DEFAULT_OPENAI_COACH_MODEL,
        openrouter_default_model=DEFAULT_COACH_OPENROUTER_MODEL,
    )

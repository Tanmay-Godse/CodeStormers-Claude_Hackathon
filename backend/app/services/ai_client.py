from dataclasses import dataclass
from typing import Any, Literal

from app.core.config import settings
from app.core.provider_factory import build_json_message_provider
from app.providers.base import (
    AIConfigurationError,
    AIRequestError,
    AIResponseError,
    JSONMessageRequest,
)

ModelRole = Literal["analysis", "coach", "debrief", "learning"]


@dataclass(frozen=True)
class ProviderRoute:
    provider: str
    base_url: str
    api_key: str
    model: str
    label: str


def send_json_message(
    *,
    model: str,
    system_prompt: str,
    user_content: list[dict[str, Any]],
    output_schema: dict[str, Any],
    max_tokens: int,
    model_role: ModelRole | None = None,
) -> dict[str, Any]:
    normalized_model = model.strip()
    primary_route = _build_primary_route(
        requested_model=normalized_model,
        model_role=model_role,
    )
    fallback_route = _build_fallback_route(model_role=model_role)

    if primary_route is None:
        if fallback_route is None:
            raise AIConfigurationError(
                "The requested model id is empty. Configure the relevant AI_*_MODEL value in backend/.env."
            )
        return _send_with_route(
            fallback_route,
            system_prompt=system_prompt,
            user_content=user_content,
            output_schema=output_schema,
            max_tokens=max_tokens,
        )

    try:
        return _send_with_route(
            primary_route,
            system_prompt=system_prompt,
            user_content=user_content,
            output_schema=output_schema,
            max_tokens=max_tokens,
        )
    except (AIConfigurationError, AIRequestError) as primary_error:
        if not _should_try_fallback(primary_route=primary_route, fallback_route=fallback_route):
            raise

        try:
            return _send_with_route(
                fallback_route,
                system_prompt=system_prompt,
                user_content=user_content,
                output_schema=output_schema,
                max_tokens=max_tokens,
            )
        except (AIConfigurationError, AIRequestError, AIResponseError) as fallback_error:
            message = (
                f"{primary_route.label} failed ({primary_error}). "
                f"{fallback_route.label} also failed: {fallback_error}"
            )
            if isinstance(fallback_error, AIConfigurationError):
                raise AIConfigurationError(message) from fallback_error
            if isinstance(fallback_error, AIRequestError):
                raise AIRequestError(message) from fallback_error
            raise AIResponseError(message) from fallback_error


def _send_with_route(
    route: ProviderRoute,
    *,
    system_prompt: str,
    user_content: list[dict[str, Any]],
    output_schema: dict[str, Any],
    max_tokens: int,
) -> dict[str, Any]:
    provider = build_json_message_provider(
        provider_override=route.provider,
        base_url=route.base_url,
        api_key=route.api_key,
        timeout_seconds=settings.ai_timeout_seconds,
        anthropic_version=settings.anthropic_version,
    )
    return provider.send_json_message(
        JSONMessageRequest(
            model=route.model,
            system_prompt=system_prompt,
            user_content=user_content,
            output_schema=output_schema,
            max_tokens=max_tokens,
        )
    )


def _build_primary_route(
    *,
    requested_model: str,
    model_role: ModelRole | None,
) -> ProviderRoute | None:
    del model_role
    if not requested_model:
        return None

    return ProviderRoute(
        provider=settings.ai_provider,
        base_url=(settings.ai_api_base_url or "").strip(),
        api_key=settings.ai_api_key,
        model=requested_model,
        label="Primary AI provider",
    )


def _build_fallback_route(*, model_role: ModelRole | None) -> ProviderRoute | None:
    fallback_model = _fallback_model_for_role(model_role)
    fallback_base_url = (settings.ai_fallback_api_base_url or "").strip()
    if not fallback_model or not fallback_base_url:
        return None

    return ProviderRoute(
        provider=settings.ai_fallback_provider,
        base_url=fallback_base_url,
        api_key=settings.ai_fallback_api_key,
        model=fallback_model,
        label="Anthropic fallback",
    )


def _fallback_model_for_role(model_role: ModelRole | None) -> str:
    if model_role == "analysis":
        return settings.ai_fallback_analysis_model.strip()
    if model_role == "coach":
        return settings.ai_fallback_coach_model.strip()
    if model_role == "debrief":
        return settings.ai_fallback_debrief_model.strip()
    if model_role == "learning":
        return settings.ai_fallback_learning_model.strip()
    return ""


def _should_try_fallback(
    *,
    primary_route: ProviderRoute,
    fallback_route: ProviderRoute | None,
) -> bool:
    if fallback_route is None:
        return False

    return (
        primary_route.provider.strip().lower() != fallback_route.provider.strip().lower()
        or primary_route.base_url != fallback_route.base_url
        or primary_route.model != fallback_route.model
    )

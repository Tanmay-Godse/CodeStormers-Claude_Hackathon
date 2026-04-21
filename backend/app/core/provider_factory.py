from urllib.parse import urlparse

from app.core.config import settings
from app.providers.anthropic import AnthropicProvider
from app.providers.base import AIConfigurationError, JSONMessageProvider
from app.providers.openai_compatible import OpenAICompatibleProvider


def get_json_message_provider() -> JSONMessageProvider:
    return build_json_message_provider(
        provider_override=settings.ai_provider,
        base_url=settings.ai_api_base_url,
        api_key=settings.ai_api_key,
        timeout_seconds=settings.ai_timeout_seconds,
        anthropic_version=settings.anthropic_version,
    )


def build_json_message_provider(
    *,
    provider_override: str,
    base_url: str | None,
    api_key: str,
    timeout_seconds: float,
    anthropic_version: str,
) -> JSONMessageProvider:
    base_url = (base_url or "").strip()
    if not base_url:
        raise AIConfigurationError(
            "AI_API_BASE_URL is not configured. Point it at either an OpenAI-compatible endpoint or an Anthropic endpoint."
        )

    provider_type = _detect_provider_type(
        base_url,
        provider_override=provider_override,
    )
    if provider_type == "anthropic":
        return AnthropicProvider(
            base_url=base_url,
            api_key=api_key,
            timeout_seconds=timeout_seconds,
            anthropic_version=anthropic_version,
        )

    return OpenAICompatibleProvider(
        base_url=base_url,
        api_key=api_key,
        timeout_seconds=timeout_seconds,
    )


def _detect_provider_type(base_url: str, *, provider_override: str) -> str:
    provider_override = provider_override.strip().lower()
    if provider_override in {"openai", "anthropic"}:
        return provider_override

    normalized = base_url.rstrip("/").lower()
    parsed = urlparse(normalized)

    if "anthropic.com" in parsed.netloc or parsed.path.endswith("/messages"):
        return "anthropic"

    return "openai"

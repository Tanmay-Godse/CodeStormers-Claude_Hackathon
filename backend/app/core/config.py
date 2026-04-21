from pathlib import Path

from dotenv import dotenv_values
from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.providers.base import is_placeholder_api_key


BACKEND_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"
AI_API_KEY_ALIASES = ("AI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY")
AI_FALLBACK_API_KEY_ALIASES = (
    "AI_FALLBACK_API_KEY",
    "ANTHROPIC_API_KEY",
    "AI_API_KEY",
)
TRANSCRIPTION_API_KEY_ALIASES = (
    "TRANSCRIPTION_API_KEY",
    "OPENAI_TRANSCRIPTION_API_KEY",
    "OPENAI_API_KEY",
)


def _load_local_dotenv() -> dict[str, str]:
    if not BACKEND_ENV_FILE.exists():
        return {}

    loaded_values = dotenv_values(BACKEND_ENV_FILE)
    return {
        key: value
        for key, value in loaded_values.items()
        if isinstance(key, str) and isinstance(value, str)
    }


def _normalize_config_value(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = value.strip()
    if not normalized:
        return None

    return normalized


def _is_real_secret(value: str | None) -> bool:
    normalized = _normalize_config_value(value)
    if normalized is None:
        return False
    if normalized.upper() == "EMPTY":
        return False
    return not is_placeholder_api_key(normalized)


def _prefer_real_local_secret(
    resolved_value: str,
    *,
    local_env: dict[str, str],
    aliases: tuple[str, ...],
) -> str:
    for alias in aliases:
        local_value = _normalize_config_value(local_env.get(alias))
        if _is_real_secret(local_value):
            return local_value

    current_value = _normalize_config_value(resolved_value)
    if current_value is None:
        return resolved_value

    return current_value


class Settings(BaseSettings):
    app_name: str = "AI Clinical Skills Coach API"
    app_version: str = "0.1.0"
    frontend_origin: str = "http://localhost:3000"
    simulation_only: bool = True
    prefer_local_file_secrets: bool = Field(
        default=True,
        validation_alias=AliasChoices("PREFER_LOCAL_FILE_SECRETS"),
    )
    ai_provider: str = Field(
        default="auto",
        validation_alias=AliasChoices("AI_PROVIDER", "LLM_PROVIDER"),
    )
    ai_api_base_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "AI_API_BASE_URL",
            "OPENAI_API_BASE_URL",
            "ANTHROPIC_API_BASE_URL",
        ),
    )
    ai_api_key: str = Field(
        default="EMPTY",
        validation_alias=AliasChoices(
            "AI_API_KEY",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
        ),
    )
    ai_fallback_provider: str = Field(
        default="anthropic",
        validation_alias=AliasChoices("AI_FALLBACK_PROVIDER"),
    )
    ai_fallback_api_base_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "AI_FALLBACK_API_BASE_URL",
            "ANTHROPIC_API_BASE_URL",
        ),
    )
    ai_fallback_api_key: str = Field(
        default="EMPTY",
        validation_alias=AliasChoices(
            "AI_FALLBACK_API_KEY",
            "ANTHROPIC_API_KEY",
            "AI_API_KEY",
        ),
    )
    ai_analysis_model: str = Field(
        default="",
        validation_alias=AliasChoices(
            "AI_ANALYSIS_MODEL",
            "OPENAI_ANALYSIS_MODEL",
            "ANTHROPIC_ANALYSIS_MODEL",
        ),
    )
    ai_debrief_model: str = Field(
        default="",
        validation_alias=AliasChoices(
            "AI_DEBRIEF_MODEL",
            "OPENAI_DEBRIEF_MODEL",
            "ANTHROPIC_DEBRIEF_MODEL",
        ),
    )
    ai_coach_model: str = Field(
        default="",
        validation_alias=AliasChoices(
            "AI_COACH_MODEL",
            "OPENAI_COACH_MODEL",
            "ANTHROPIC_COACH_MODEL",
        ),
    )
    ai_learning_model: str = Field(
        default="claude-haiku-4-5",
        validation_alias=AliasChoices(
            "AI_LEARNING_MODEL",
            "OPENAI_LEARNING_MODEL",
            "ANTHROPIC_LEARNING_MODEL",
        ),
    )
    ai_fallback_analysis_model: str = Field(
        default="",
        validation_alias=AliasChoices(
            "AI_FALLBACK_ANALYSIS_MODEL",
            "ANTHROPIC_ANALYSIS_MODEL",
        ),
    )
    ai_fallback_debrief_model: str = Field(
        default="",
        validation_alias=AliasChoices(
            "AI_FALLBACK_DEBRIEF_MODEL",
            "ANTHROPIC_DEBRIEF_MODEL",
        ),
    )
    ai_fallback_coach_model: str = Field(
        default="",
        validation_alias=AliasChoices(
            "AI_FALLBACK_COACH_MODEL",
            "ANTHROPIC_COACH_MODEL",
        ),
    )
    ai_fallback_learning_model: str = Field(
        default="",
        validation_alias=AliasChoices(
            "AI_FALLBACK_LEARNING_MODEL",
            "ANTHROPIC_LEARNING_MODEL",
        ),
    )
    ai_timeout_seconds: float = Field(
        default=60.0,
        validation_alias=AliasChoices(
            "AI_TIMEOUT_SECONDS",
            "OPENAI_TIMEOUT_SECONDS",
            "ANTHROPIC_TIMEOUT_SECONDS",
        ),
    )
    ai_analysis_max_tokens: int = Field(
        default=1400,
        validation_alias=AliasChoices(
            "AI_ANALYSIS_MAX_TOKENS",
            "OPENAI_ANALYSIS_MAX_TOKENS",
            "ANTHROPIC_ANALYSIS_MAX_TOKENS",
        ),
    )
    ai_debrief_max_tokens: int = Field(
        default=1200,
        validation_alias=AliasChoices(
            "AI_DEBRIEF_MAX_TOKENS",
            "OPENAI_DEBRIEF_MAX_TOKENS",
            "ANTHROPIC_DEBRIEF_MAX_TOKENS",
        ),
    )
    ai_coach_max_tokens: int = Field(
        default=450,
        validation_alias=AliasChoices(
            "AI_COACH_MAX_TOKENS",
            "OPENAI_COACH_MAX_TOKENS",
            "ANTHROPIC_COACH_MAX_TOKENS",
        ),
    )
    ai_safety_max_tokens: int = Field(
        default=600,
        validation_alias=AliasChoices(
            "AI_SAFETY_MAX_TOKENS",
            "OPENAI_SAFETY_MAX_TOKENS",
            "ANTHROPIC_SAFETY_MAX_TOKENS",
        ),
    )
    ai_learning_max_tokens: int = Field(
        default=1800,
        validation_alias=AliasChoices(
            "AI_LEARNING_MAX_TOKENS",
            "OPENAI_LEARNING_MAX_TOKENS",
            "ANTHROPIC_LEARNING_MAX_TOKENS",
        ),
    )
    human_review_confidence_threshold: float = Field(
        default=0.78,
        validation_alias=AliasChoices("HUMAN_REVIEW_CONFIDENCE_THRESHOLD"),
    )
    grading_confidence_threshold: float = Field(
        default=0.8,
        validation_alias=AliasChoices("GRADING_CONFIDENCE_THRESHOLD"),
    )
    anthropic_version: str = Field(
        default="2023-06-01",
        validation_alias=AliasChoices("ANTHROPIC_VERSION"),
    )
    transcription_api_base_url: str = Field(
        default="https://api.openai.com/v1",
        validation_alias=AliasChoices(
            "TRANSCRIPTION_API_BASE_URL",
            "OPENAI_TRANSCRIPTION_API_BASE_URL",
            "OPENAI_API_BASE_URL",
        ),
    )
    transcription_api_key: str = Field(
        default="EMPTY",
        validation_alias=AliasChoices(
            "TRANSCRIPTION_API_KEY",
            "OPENAI_TRANSCRIPTION_API_KEY",
            "OPENAI_API_KEY",
        ),
    )
    transcription_model: str = Field(
        default="gpt-4o-mini-transcribe",
        validation_alias=AliasChoices(
            "TRANSCRIPTION_MODEL",
            "OPENAI_TRANSCRIPTION_MODEL",
        ),
    )
    transcription_timeout_seconds: float = Field(
        default=60.0,
        validation_alias=AliasChoices(
            "TRANSCRIPTION_TIMEOUT_SECONDS",
            "OPENAI_TRANSCRIPTION_TIMEOUT_SECONDS",
        ),
    )

    @model_validator(mode="after")
    def apply_local_file_secret_preference(self) -> "Settings":
        if not self.prefer_local_file_secrets:
            return self

        local_env = _load_local_dotenv()
        object.__setattr__(
            self,
            "ai_api_key",
            _prefer_real_local_secret(
                self.ai_api_key,
                local_env=local_env,
                aliases=AI_API_KEY_ALIASES,
            ),
        )
        object.__setattr__(
            self,
            "ai_fallback_api_key",
            _prefer_real_local_secret(
                self.ai_fallback_api_key,
                local_env=local_env,
                aliases=AI_FALLBACK_API_KEY_ALIASES,
            ),
        )
        object.__setattr__(
            self,
            "transcription_api_key",
            _prefer_real_local_secret(
                self.transcription_api_key,
                local_env=local_env,
                aliases=TRANSCRIPTION_API_KEY_ALIASES,
            ),
        )
        return self

    def primary_ai_ready(self) -> bool:
        return self._ai_stack_ready(
            api_base_url=self.ai_api_base_url,
            api_key=self.ai_api_key,
            analysis_model=self.ai_analysis_model,
            coach_model=self.ai_coach_model,
            debrief_model=self.ai_debrief_model,
        )

    def fallback_ai_ready(self) -> bool:
        return self._ai_stack_ready(
            api_base_url=self.ai_fallback_api_base_url,
            api_key=self.ai_fallback_api_key,
            analysis_model=self.ai_fallback_analysis_model,
            coach_model=self.ai_fallback_coach_model,
            debrief_model=self.ai_fallback_debrief_model,
        )

    def any_ai_ready(self) -> bool:
        return self.primary_ai_ready() or self.fallback_ai_ready()

    def ai_health_coach_model(self) -> str:
        return self.ai_coach_model.strip() or self.ai_fallback_coach_model.strip()

    @staticmethod
    def _ai_stack_ready(
        *,
        api_base_url: str | None,
        api_key: str,
        analysis_model: str,
        coach_model: str,
        debrief_model: str,
    ) -> bool:
        return (
            bool(api_key)
            and not is_placeholder_api_key(api_key)
            and bool(api_base_url and api_base_url.strip())
            and bool(analysis_model.strip())
            and bool(coach_model.strip())
            and bool(debrief_model.strip())
        )

    model_config = SettingsConfigDict(
        env_file=BACKEND_ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


settings = Settings()

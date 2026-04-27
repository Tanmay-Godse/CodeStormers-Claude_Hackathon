from app.core import config


def test_settings_prefers_real_backend_env_ai_key_over_shell_env(monkeypatch) -> None:
    monkeypatch.setenv("AI_API_KEY", "stale-shell-key")
    monkeypatch.setattr(
        config,
        "_load_local_dotenv",
        lambda: {"AI_API_KEY": "sk-ant-local-key"},
    )

    settings = config.Settings(_env_file=None)

    assert settings.ai_api_key == "sk-ant-local-key"


def test_settings_keeps_real_shell_ai_key_when_backend_env_has_placeholder(
    monkeypatch,
) -> None:
    monkeypatch.setenv("AI_API_KEY", "sk-ant-shell-key")
    monkeypatch.setattr(
        config,
        "_load_local_dotenv",
        lambda: {"AI_API_KEY": "SET_IN_ENV_MANAGER"},
    )

    settings = config.Settings(_env_file=None)

    assert settings.ai_api_key == "sk-ant-shell-key"


def test_settings_does_not_use_primary_ai_key_as_fallback_key(monkeypatch) -> None:
    monkeypatch.delenv("AI_FALLBACK_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(
        config,
        "_load_local_dotenv",
        lambda: {
            "AI_API_KEY": "local-vllm-key",
            "AI_FALLBACK_API_KEY": "SET_IN_ENV_MANAGER",
        },
    )

    settings = config.Settings(_env_file=None)

    assert settings.ai_api_key == "local-vllm-key"
    assert settings.ai_fallback_api_key == "EMPTY"
    assert settings.fallback_ai_ready() is False


def test_settings_treats_empty_transcription_key_as_not_ready(monkeypatch) -> None:
    monkeypatch.delenv("TRANSCRIPTION_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_TRANSCRIPTION_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(
        config,
        "_load_local_dotenv",
        lambda: {"TRANSCRIPTION_API_KEY": "EMPTY"},
    )

    settings = config.Settings(_env_file=None)

    assert settings.transcription_api_key == "EMPTY"
    assert settings.transcription_ready() is False


def test_settings_prefers_real_backend_env_transcription_key_over_shell_env(
    monkeypatch,
) -> None:
    monkeypatch.setenv("TRANSCRIPTION_API_KEY", "stale-shell-transcription-key")
    monkeypatch.setattr(
        config,
        "_load_local_dotenv",
        lambda: {"TRANSCRIPTION_API_KEY": "sk-proj-local-transcription-key"},
    )

    settings = config.Settings(_env_file=None)

    assert settings.transcription_api_key == "sk-proj-local-transcription-key"


def test_settings_ignore_extra_backend_env_keys(monkeypatch) -> None:
    monkeypatch.setattr(
        config,
        "_load_local_dotenv",
        lambda: {"PRIVATE_SEED_ACCOUNTS_JSON": '[{"id":"x"}]'},
    )

    settings = config.Settings(_env_file=None)

    assert settings.frontend_origin == "http://localhost:3000"

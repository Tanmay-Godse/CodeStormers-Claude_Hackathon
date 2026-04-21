import pytest

from app.services import ai_client
from app.providers import anthropic, openai_compatible


class FakeResponse:
    def __init__(self, *, status_code: int, json_data):
        self.status_code = status_code
        self._json_data = json_data

    def json(self):
        return self._json_data


def test_send_json_message_converts_multimodal_payload(monkeypatch) -> None:
    captured = {}

    def fake_post(url, *, headers, json, timeout):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        captured["timeout"] = timeout
        return FakeResponse(
            status_code=200,
            json_data={
                "choices": [
                    {
                        "message": {
                            "content": '{"ok": true}'
                        }
                    }
                ]
            },
        )

    monkeypatch.setattr(ai_client.settings, "ai_provider", "auto")
    monkeypatch.setattr(ai_client.settings, "ai_api_base_url", "http://localhost:8000/v1")
    monkeypatch.setattr(ai_client.settings, "ai_api_key", "EMPTY")
    monkeypatch.setattr(ai_client.settings, "ai_timeout_seconds", 45.0)
    monkeypatch.setattr(openai_compatible.httpx, "post", fake_post)

    response = ai_client.send_json_message(
        model="Qwen/Qwen2.5-VL-3B-Instruct",
        max_tokens=300,
        system_prompt="You are helpful.",
        user_content=[
            {"type": "text", "text": "Analyze this frame."},
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/jpeg",
                    "data": "ZmFrZQ==",
                },
            },
        ],
        output_schema={"type": "object"},
    )

    assert response == {"ok": True}
    assert captured["url"] == "http://localhost:8000/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer EMPTY"
    assert captured["timeout"] == 45.0
    assert captured["json"]["messages"][1]["content"][1]["type"] == "image_url"
    assert captured["json"]["messages"][1]["content"][1]["image_url"]["url"].startswith(
        "data:image/jpeg;base64,"
    )


def test_send_json_message_converts_audio_payload(monkeypatch) -> None:
    captured = {}

    def fake_post(url, *, headers, json, timeout):
        captured["json"] = json
        return FakeResponse(
            status_code=200,
            json_data={
                "choices": [
                    {
                        "message": {
                            "content": '{"ok": true}'
                        }
                    }
                ]
            },
        )

    monkeypatch.setattr(ai_client.settings, "ai_provider", "auto")
    monkeypatch.setattr(ai_client.settings, "ai_api_base_url", "http://localhost:8000/v1")
    monkeypatch.setattr(ai_client.settings, "ai_api_key", "EMPTY")
    monkeypatch.setattr(openai_compatible.httpx, "post", fake_post)

    response = ai_client.send_json_message(
        model="demo-audio-model",
        max_tokens=200,
        system_prompt="system",
        user_content=[
            {"type": "text", "text": "Listen to this learner and coach them."},
            {
                "type": "audio",
                "source": {
                    "type": "base64",
                    "media_type": "audio/wav",
                    "format": "wav",
                    "data": "UklGRg==",
                },
            },
        ],
        output_schema={"type": "object"},
    )

    assert response == {"ok": True}
    assert captured["json"]["messages"][1]["content"][1] == {
        "type": "input_audio",
        "input_audio": {
            "data": "UklGRg==",
            "format": "wav",
        },
    }


def test_send_json_message_reads_nested_text_parts(monkeypatch) -> None:
    def fake_post(url, *, headers, json, timeout):
        return FakeResponse(
            status_code=200,
            json_data={
                "choices": [
                    {
                        "message": {
                            "content": [
                                {
                                    "type": "text",
                                    "text": '{"step_status":"retry"}',
                                }
                            ]
                        }
                    }
                ]
            },
        )

    monkeypatch.setattr(ai_client.settings, "ai_provider", "auto")
    monkeypatch.setattr(ai_client.settings, "ai_api_base_url", "http://localhost:8000/v1")
    monkeypatch.setattr(ai_client.settings, "ai_api_key", "EMPTY")
    monkeypatch.setattr(openai_compatible.httpx, "post", fake_post)

    response = ai_client.send_json_message(
        model="demo-model",
        max_tokens=100,
        system_prompt="system",
        user_content=[{"type": "text", "text": "hello"}],
        output_schema={"type": "object"},
    )

    assert response == {"step_status": "retry"}


def test_send_json_message_uses_json_object_first_for_zai_and_can_fallback_without_response_format(
    monkeypatch,
) -> None:
    captured_payloads = []

    def fake_post(url, *, headers, json, timeout):
        captured_payloads.append(json)
        if len(captured_payloads) == 1:
            return FakeResponse(
                status_code=400,
                json_data={
                    "error": {
                        "message": "response_format json_object is not supported for this model",
                    }
                },
            )

        return FakeResponse(
            status_code=200,
            json_data={
                "choices": [
                    {
                        "message": {
                            "content": '{"ok": true}'
                        }
                    }
                ]
            },
        )

    monkeypatch.setattr(ai_client.settings, "ai_provider", "auto")
    monkeypatch.setattr(ai_client.settings, "ai_api_base_url", "https://api.z.ai/api/paas/v4")
    monkeypatch.setattr(ai_client.settings, "ai_api_key", "demo-key")
    monkeypatch.setattr(openai_compatible.httpx, "post", fake_post)

    response = ai_client.send_json_message(
        model="glm-4.6v-flash",
        max_tokens=200,
        system_prompt="Return structured coaching.",
        user_content=[{"type": "text", "text": "Analyze this frame."}],
        output_schema={
            "type": "object",
            "properties": {
                "ok": {"type": "boolean"},
            },
            "required": ["ok"],
        },
    )

    assert response == {"ok": True}
    assert len(captured_payloads) == 2
    assert captured_payloads[0]["response_format"] == {"type": "json_object"}
    assert "response_format" not in captured_payloads[1]
    assert "matches this schema exactly" in captured_payloads[0]["messages"][0]["content"]
    assert '"required": [' in captured_payloads[0]["messages"][0]["content"]


def test_send_json_message_rejects_placeholder_api_key(monkeypatch) -> None:
    monkeypatch.setattr(ai_client.settings, "ai_provider", "auto")
    monkeypatch.setattr(ai_client.settings, "ai_api_base_url", "https://api.z.ai/api/paas/v4")
    monkeypatch.setattr(ai_client.settings, "ai_api_key", "SET_IN_ENV_MANAGER")

    with pytest.raises(ai_client.AIConfigurationError):
        ai_client.send_json_message(
            model="glm-4.6v-flash",
            max_tokens=200,
            system_prompt="Return structured coaching.",
            user_content=[{"type": "text", "text": "Analyze this frame."}],
            output_schema={"type": "object"},
        )


def test_send_json_message_rejects_placeholder_api_key_for_anthropic(monkeypatch) -> None:
    monkeypatch.setattr(ai_client.settings, "ai_provider", "anthropic")
    monkeypatch.setattr(
        ai_client.settings,
        "ai_api_base_url",
        "https://api.anthropic.com/v1/messages",
    )
    monkeypatch.setattr(ai_client.settings, "ai_api_key", "SET_IN_ENV_MANAGER")

    with pytest.raises(ai_client.AIConfigurationError):
        ai_client.send_json_message(
            model="claude-sonnet-demo",
            max_tokens=200,
            system_prompt="Return structured coaching.",
            user_content=[{"type": "text", "text": "Analyze this frame."}],
            output_schema={"type": "object"},
        )


def test_send_json_message_maps_invalid_anthropic_api_key_to_configuration_error(
    monkeypatch,
) -> None:
    def fake_post(url, *, headers, json, timeout):
        return FakeResponse(
            status_code=401,
            json_data={
                "error": {
                    "message": "invalid x-api-key",
                }
            },
        )

    monkeypatch.setattr(ai_client.settings, "ai_provider", "anthropic")
    monkeypatch.setattr(
        ai_client.settings,
        "ai_api_base_url",
        "https://api.anthropic.com/v1/messages",
    )
    monkeypatch.setattr(ai_client.settings, "ai_api_key", "wrong-key")
    monkeypatch.setattr(anthropic.httpx, "post", fake_post)

    with pytest.raises(ai_client.AIConfigurationError):
        ai_client.send_json_message(
            model="claude-sonnet-demo",
            max_tokens=200,
            system_prompt="Return structured coaching.",
            user_content=[{"type": "text", "text": "Analyze this frame."}],
            output_schema={"type": "object"},
        )


def test_send_json_message_rejects_audio_for_zai(monkeypatch) -> None:
    monkeypatch.setattr(ai_client.settings, "ai_provider", "auto")
    monkeypatch.setattr(ai_client.settings, "ai_api_base_url", "https://api.z.ai/api/paas/v4")
    monkeypatch.setattr(ai_client.settings, "ai_api_key", "demo-key")

    with pytest.raises(ai_client.AIRequestError):
        ai_client.send_json_message(
            model="glm-4.6v-flash",
            max_tokens=200,
            system_prompt="Return structured coaching.",
            user_content=[
                {"type": "text", "text": "Coach this learner."},
                {
                    "type": "audio",
                    "source": {
                        "type": "base64",
                        "media_type": "audio/wav",
                        "format": "wav",
                        "data": "UklGRg==",
                    },
                },
            ],
            output_schema={"type": "object"},
        )


def test_send_json_message_auto_detects_anthropic_endpoint(monkeypatch) -> None:
    captured = {}

    def fake_post(url, *, headers, json, timeout):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        captured["timeout"] = timeout
        return FakeResponse(
            status_code=200,
            json_data={
                "content": [
                    {
                        "type": "tool_use",
                        "input": {"step_status": "pass"},
                    }
                ]
            },
        )

    monkeypatch.setattr(ai_client.settings, "ai_provider", "auto")
    monkeypatch.setattr(
        ai_client.settings,
        "ai_api_base_url",
        "https://api.anthropic.com/v1/messages",
    )
    monkeypatch.setattr(ai_client.settings, "ai_api_key", "test-key")
    monkeypatch.setattr(ai_client.settings, "ai_timeout_seconds", 30.0)
    monkeypatch.setattr(anthropic.httpx, "post", fake_post)

    response = ai_client.send_json_message(
        model="claude-sonnet-demo",
        max_tokens=128,
        system_prompt="system",
        user_content=[{"type": "text", "text": "hello"}],
        output_schema={"type": "object"},
    )

    assert response == {"step_status": "pass"}
    assert captured["url"] == "https://api.anthropic.com/v1/messages"
    assert captured["headers"]["x-api-key"] == "test-key"
    assert captured["headers"]["anthropic-version"] == "2023-06-01"
    assert captured["json"]["tools"][0]["name"] == "return_json"


def test_send_json_message_falls_back_to_anthropic_when_primary_request_fails(
    monkeypatch,
) -> None:
    primary_calls = []
    fallback_calls = []

    def fake_post(url, *, headers, json, timeout):
        if "anthropic.com" in url:
            fallback_calls.append(json)
            return FakeResponse(
                status_code=200,
                json_data={
                    "content": [
                        {
                            "type": "tool_use",
                            "input": {"step_status": "pass"},
                        }
                    ]
                },
            )

        primary_calls.append(json)
        return FakeResponse(
            status_code=404,
            json_data={
                "error": {
                    "message": "The requested model is not available on this server.",
                }
            },
        )

    monkeypatch.setattr(ai_client.settings, "ai_provider", "openai")
    monkeypatch.setattr(ai_client.settings, "ai_api_base_url", "http://localhost:8000/v1")
    monkeypatch.setattr(ai_client.settings, "ai_api_key", "EMPTY")
    monkeypatch.setattr(
        ai_client.settings,
        "ai_analysis_model",
        "Qwen/Qwen2.5-VL-3B-Instruct",
    )
    monkeypatch.setattr(ai_client.settings, "ai_fallback_provider", "anthropic")
    monkeypatch.setattr(
        ai_client.settings,
        "ai_fallback_api_base_url",
        "https://api.anthropic.com/v1/messages",
    )
    monkeypatch.setattr(ai_client.settings, "ai_fallback_api_key", "anthropic-key")
    monkeypatch.setattr(
        ai_client.settings,
        "ai_fallback_analysis_model",
        "claude-sonnet-demo",
    )
    monkeypatch.setattr(openai_compatible.httpx, "post", fake_post)

    response = ai_client.send_json_message(
        model=ai_client.settings.ai_analysis_model,
        max_tokens=128,
        system_prompt="system",
        user_content=[{"type": "text", "text": "hello"}],
        output_schema={"type": "object"},
        model_role="analysis",
    )

    assert response == {"step_status": "pass"}
    assert len(primary_calls) == 1
    assert len(fallback_calls) == 1
    assert fallback_calls[0]["model"] == "claude-sonnet-demo"


def test_send_json_message_uses_anthropic_fallback_when_primary_model_is_blank(
    monkeypatch,
) -> None:
    captured = {}

    def fake_anthropic_post(url, *, headers, json, timeout):
        captured["json"] = json
        return FakeResponse(
            status_code=200,
            json_data={
                "content": [
                    {
                        "type": "tool_use",
                        "input": {"step_status": "retry"},
                    }
                ]
            },
        )

    monkeypatch.setattr(ai_client.settings, "ai_provider", "openai")
    monkeypatch.setattr(ai_client.settings, "ai_api_base_url", "http://localhost:8000/v1")
    monkeypatch.setattr(ai_client.settings, "ai_api_key", "EMPTY")
    monkeypatch.setattr(ai_client.settings, "ai_analysis_model", "")
    monkeypatch.setattr(ai_client.settings, "ai_fallback_provider", "anthropic")
    monkeypatch.setattr(
        ai_client.settings,
        "ai_fallback_api_base_url",
        "https://api.anthropic.com/v1/messages",
    )
    monkeypatch.setattr(ai_client.settings, "ai_fallback_api_key", "anthropic-key")
    monkeypatch.setattr(
        ai_client.settings,
        "ai_fallback_analysis_model",
        "claude-sonnet-demo",
    )
    monkeypatch.setattr(anthropic.httpx, "post", fake_anthropic_post)

    response = ai_client.send_json_message(
        model="",
        max_tokens=128,
        system_prompt="system",
        user_content=[{"type": "text", "text": "hello"}],
        output_schema={"type": "object"},
        model_role="analysis",
    )

    assert response == {"step_status": "retry"}
    assert captured["json"]["model"] == "claude-sonnet-demo"

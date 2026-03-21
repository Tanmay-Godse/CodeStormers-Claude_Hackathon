from app.services import ai_client


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
    monkeypatch.setattr(ai_client.httpx, "post", fake_post)

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
    monkeypatch.setattr(ai_client.httpx, "post", fake_post)

    response = ai_client.send_json_message(
        model="demo-model",
        max_tokens=100,
        system_prompt="system",
        user_content=[{"type": "text", "text": "hello"}],
        output_schema={"type": "object"},
    )

    assert response == {"step_status": "retry"}


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
    monkeypatch.setattr(ai_client.httpx, "post", fake_post)

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

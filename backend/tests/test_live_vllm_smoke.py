import json
import math
import os
import re
import urllib.error
import urllib.request
import uuid
import wave
from io import BytesIO

import pytest

LIVE_BACKEND_BASE_URL = os.getenv("LIVE_BACKEND_BASE_URL", "http://localhost:8001/api/v1")
LIVE_VLLM_BASE_URL = os.getenv("LIVE_VLLM_BASE_URL", "http://localhost:8000")
LIVE_VLLM_API_KEY = os.getenv("LIVE_VLLM_API_KEY", "EMPTY")
TINY_JPEG_BASE64 = (
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsN"
    "DhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQU"
    "FBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAgACADASIAAhEBAxEB/8QA"
    "HwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIh"
    "MUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVW"
    "V1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG"
    "x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQF"
    "BgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAV"
    "YnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOE"
    "hYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq"
    "8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD2iiiiv5PP6VCiiigAooooAKKKKAP/2Q=="
)


def _build_tiny_wav_base64() -> str:
    sample_rate = 16000
    duration_seconds = 0.4
    sample_count = int(sample_rate * duration_seconds)
    frames = bytearray()

    for index in range(sample_count):
        amplitude = int(9000 * math.sin(2 * math.pi * 440 * index / sample_rate))
        frames.extend(amplitude.to_bytes(2, byteorder="little", signed=True))

    buffer = BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(bytes(frames))

    import base64

    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _request_json(
    url: str,
    *,
    method: str = "GET",
    payload: dict | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 90.0,
) -> dict:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers=headers or {},
    )

    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _request_text(url: str, *, timeout: float = 15.0) -> str:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return response.read().decode("utf-8")


def _get_live_model_id() -> str:
    models_payload = _request_json(
        f"{LIVE_VLLM_BASE_URL}/v1/models",
        headers={
            "Authorization": f"Bearer {LIVE_VLLM_API_KEY}",
            "Content-Type": "application/json",
        },
    )
    data = models_payload.get("data")
    if not isinstance(data, list) or not data:
        raise AssertionError("The live vLLM server did not return any models.")

    model_id = data[0].get("id")
    if not isinstance(model_id, str) or not model_id.strip():
        raise AssertionError("The live vLLM server returned an invalid model id.")

    return model_id


def _read_metric(metric_name: str, model_id: str) -> float:
    metrics_text = _request_text(f"{LIVE_VLLM_BASE_URL}/metrics")
    pattern = re.compile(
        rf'^{re.escape(metric_name)}\{{[^}}]*model_name="{re.escape(model_id)}"[^}}]*\}}\s+([-+0-9.eE]+)$',
        re.MULTILINE,
    )
    match = pattern.search(metrics_text)
    if not match:
        raise AssertionError(
            f"Could not find metric {metric_name!r} for model {model_id!r} in vLLM metrics."
        )

    return float(match.group(1))


def test_live_backend_uses_vllm_for_coach_chat() -> None:
    try:
        model_id = _get_live_model_id()
        prompt_tokens_before = _read_metric("vllm:prompt_tokens_total", model_id)
        generation_tokens_before = _read_metric("vllm:generation_tokens_total", model_id)
    except urllib.error.URLError as exc:
        pytest.skip(f"Live vLLM server is not reachable: {exc}")

    nonce = uuid.uuid4().hex[:8]
    payload = {
        "procedure_id": "simple-interrupted-suture",
        "stage_id": "setup",
        "skill_level": "beginner",
        "feedback_language": "en",
        "simulation_confirmation": False,
        "student_name": "Smoke Test",
        "equity_mode": {
            "enabled": True,
            "audio_coaching": True,
            "low_bandwidth_mode": False,
            "cheap_phone_mode": False,
            "offline_practice_logging": False,
        },
        "messages": [
            {
                "role": "user",
                "content": (
                    f"Smoke test token {nonce}. Please help me plan what to practice first."
                ),
            }
        ],
    }

    try:
        response = _request_json(
            f"{LIVE_BACKEND_BASE_URL}/coach-chat",
            method="POST",
            payload=payload,
            headers={"Content-Type": "application/json"},
        )
    except urllib.error.URLError as exc:
        pytest.skip(f"Live backend is not reachable: {exc}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        pytest.fail(f"Coach chat request failed with status {exc.code}: {detail}")

    prompt_tokens_after = _read_metric("vllm:prompt_tokens_total", model_id)
    generation_tokens_after = _read_metric("vllm:generation_tokens_total", model_id)

    assert response["coach_message"]
    assert response["plan_summary"]
    assert response["suggested_next_step"]
    assert response["conversation_stage"] in {"goal_setting", "planning", "guiding", "blocked"}
    assert (
        prompt_tokens_after > prompt_tokens_before
        or generation_tokens_after > generation_tokens_before
    ), "Expected live vLLM token counters to increase after the backend coach-chat request."

    print(
        f"live_model={model_id} "
        f"prompt_tokens_delta={prompt_tokens_after - prompt_tokens_before} "
        f"generation_tokens_delta={generation_tokens_after - generation_tokens_before}"
    )


def test_live_backend_uses_vllm_for_analyze_frame() -> None:
    try:
        model_id = _get_live_model_id()
        prompt_tokens_before = _read_metric("vllm:prompt_tokens_total", model_id)
        generation_tokens_before = _read_metric("vllm:generation_tokens_total", model_id)
    except urllib.error.URLError as exc:
        pytest.skip(f"Live vLLM server is not reachable: {exc}")

    payload = {
        "procedure_id": "simple-interrupted-suture",
        "stage_id": "setup",
        "skill_level": "beginner",
        "image_base64": TINY_JPEG_BASE64,
        "simulation_confirmation": True,
        "feedback_language": "en",
        "equity_mode": {
            "enabled": False,
            "audio_coaching": False,
            "low_bandwidth_mode": False,
            "cheap_phone_mode": False,
            "offline_practice_logging": False,
        },
    }

    try:
        response = _request_json(
            f"{LIVE_BACKEND_BASE_URL}/analyze-frame",
            method="POST",
            payload=payload,
            headers={"Content-Type": "application/json"},
        )
    except urllib.error.URLError as exc:
        pytest.skip(f"Live backend is not reachable: {exc}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        pytest.fail(f"Analyze-frame request failed with status {exc.code}: {detail}")

    prompt_tokens_after = _read_metric("vllm:prompt_tokens_total", model_id)
    generation_tokens_after = _read_metric("vllm:generation_tokens_total", model_id)

    assert response["analysis_mode"] in {"coaching", "blocked"}
    assert response["step_status"] in {"pass", "retry", "unclear", "unsafe"}
    assert "safety_gate" in response
    assert (
        prompt_tokens_after > prompt_tokens_before
        or generation_tokens_after > generation_tokens_before
    ), "Expected live vLLM token counters to increase after the backend analyze-frame request."

    print(
        f"live_analyze_model={model_id} "
        f"analysis_mode={response['analysis_mode']} "
        f"safety_status={response['safety_gate']['status']} "
        f"prompt_tokens_delta={prompt_tokens_after - prompt_tokens_before} "
        f"generation_tokens_delta={generation_tokens_after - generation_tokens_before}"
    )


def test_live_backend_uses_vllm_for_audio_coach_chat() -> None:
    try:
        model_id = _get_live_model_id()
        prompt_tokens_before = _read_metric("vllm:prompt_tokens_total", model_id)
        generation_tokens_before = _read_metric("vllm:generation_tokens_total", model_id)
    except urllib.error.URLError as exc:
        pytest.skip(f"Live vLLM server is not reachable: {exc}")

    payload = {
        "procedure_id": "simple-interrupted-suture",
        "stage_id": "setup",
        "skill_level": "beginner",
        "feedback_language": "en",
        "simulation_confirmation": False,
        "student_name": "Smoke Test",
        "audio_base64": _build_tiny_wav_base64(),
        "audio_format": "wav",
        "equity_mode": {
            "enabled": True,
            "audio_coaching": True,
            "low_bandwidth_mode": False,
            "cheap_phone_mode": False,
            "offline_practice_logging": False,
        },
        "messages": [],
    }

    try:
        response = _request_json(
            f"{LIVE_BACKEND_BASE_URL}/coach-chat",
            method="POST",
            payload=payload,
            headers={"Content-Type": "application/json"},
        )
    except urllib.error.URLError as exc:
        pytest.skip(f"Live backend is not reachable: {exc}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        pytest.fail(f"Audio coach-chat request failed with status {exc.code}: {detail}")

    prompt_tokens_after = _read_metric("vllm:prompt_tokens_total", model_id)
    generation_tokens_after = _read_metric("vllm:generation_tokens_total", model_id)

    assert response["coach_message"]
    assert response["conversation_stage"] in {"goal_setting", "planning", "guiding", "blocked"}
    assert "learner_goal_summary" in response
    if (
        response["conversation_stage"] == "blocked"
        and "audio support" in response["coach_message"].lower()
    ):
        pytest.skip(response["coach_message"])
    assert (
        prompt_tokens_after > prompt_tokens_before
        or generation_tokens_after > generation_tokens_before
    ), "Expected live vLLM token counters to increase after the backend audio coach-chat request."

    print(
        f"live_audio_model={model_id} "
        f"goal_summary={response['learner_goal_summary']!r} "
        f"prompt_tokens_delta={prompt_tokens_after - prompt_tokens_before} "
        f"generation_tokens_delta={generation_tokens_after - generation_tokens_before}"
    )

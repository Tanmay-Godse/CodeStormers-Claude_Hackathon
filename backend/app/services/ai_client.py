import json
from typing import Any
from urllib.parse import urlparse

import httpx

from app.core.config import settings


class AIConfigurationError(RuntimeError):
    pass


class AIRequestError(RuntimeError):
    pass


class AIResponseError(RuntimeError):
    pass


def send_json_message(
    *,
    model: str,
    system_prompt: str,
    user_content: list[dict[str, Any]],
    output_schema: dict[str, Any],
    max_tokens: int,
) -> dict[str, Any]:
    base_url = (settings.ai_api_base_url or "").strip()
    if not base_url:
        raise AIConfigurationError(
            "AI_API_BASE_URL is not configured. Point it at either an OpenAI-compatible endpoint or an Anthropic endpoint."
        )

    if not model.strip():
        raise AIConfigurationError(
            "The requested model id is empty. Set AI_ANALYSIS_MODEL and AI_DEBRIEF_MODEL in backend/.env."
        )

    api_type = _detect_api_type(base_url)
    if api_type == "anthropic":
        return _send_anthropic_json_message(
            base_url=base_url,
            model=model,
            system_prompt=system_prompt,
            user_content=user_content,
            output_schema=output_schema,
            max_tokens=max_tokens,
        )

    return _send_openai_json_message(
        base_url=base_url,
        model=model,
        system_prompt=system_prompt,
        user_content=user_content,
        output_schema=output_schema,
        max_tokens=max_tokens,
    )


def _send_openai_json_message(
    *,
    base_url: str,
    model: str,
    system_prompt: str,
    user_content: list[dict[str, Any]],
    output_schema: dict[str, Any],
    max_tokens: int,
) -> dict[str, Any]:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": _to_openai_content(user_content)},
        ],
        "max_tokens": max_tokens,
        "temperature": 0,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "coach_response",
                "schema": output_schema,
            },
        },
    }

    headers = {
        "Authorization": f"Bearer {_get_api_key()}",
        "Content-Type": "application/json",
    }

    try:
        response = httpx.post(
            _chat_completions_url(base_url),
            headers=headers,
            json=payload,
            timeout=settings.ai_timeout_seconds,
        )
    except httpx.HTTPError as exc:
        raise AIRequestError(
            "The OpenAI-compatible request could not reach the configured model server."
        ) from exc

    if response.status_code >= 400:
        raise AIRequestError(_extract_error_message(response))

    try:
        response_data = response.json()
    except json.JSONDecodeError as exc:
        raise AIResponseError(
            "The model server returned a non-JSON response."
        ) from exc

    raw_payload = _extract_message_text(response_data)

    try:
        return json.loads(raw_payload)
    except json.JSONDecodeError as exc:
        raise AIResponseError("The model server returned invalid JSON content.") from exc


def _send_anthropic_json_message(
    *,
    base_url: str,
    model: str,
    system_prompt: str,
    user_content: list[dict[str, Any]],
    output_schema: dict[str, Any],
    max_tokens: int,
) -> dict[str, Any]:
    api_key = _get_api_key(require_non_empty=True)
    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system_prompt,
        "messages": [
            {
                "role": "user",
                "content": _to_anthropic_content(user_content),
            }
        ],
        "tools": [
            {
                "name": "return_json",
                "description": "Return the response payload so it matches the provided JSON schema exactly.",
                "input_schema": output_schema,
            }
        ],
        "tool_choice": {
            "type": "tool",
            "name": "return_json",
        },
    }

    headers = {
        "x-api-key": api_key,
        "anthropic-version": settings.anthropic_version,
        "Content-Type": "application/json",
    }

    try:
        response = httpx.post(
            _anthropic_messages_url(base_url),
            headers=headers,
            json=payload,
            timeout=settings.ai_timeout_seconds,
        )
    except httpx.HTTPError as exc:
        raise AIRequestError(
            "The Anthropic request could not reach the configured model server."
        ) from exc

    if response.status_code >= 400:
        raise AIRequestError(_extract_error_message(response))

    try:
        response_data = response.json()
    except json.JSONDecodeError as exc:
        raise AIResponseError(
            "The model server returned a non-JSON response."
        ) from exc

    return _extract_anthropic_tool_input(response_data)


def _get_api_key(*, require_non_empty: bool = False) -> str:
    api_key = (settings.ai_api_key or "").strip()
    if require_non_empty and (not api_key or api_key == "EMPTY"):
        raise AIConfigurationError(
            "AI_API_KEY is not configured for Anthropic requests."
        )
    return api_key or "EMPTY"


def _detect_api_type(base_url: str) -> str:
    provider_override = settings.ai_provider.strip().lower()
    if provider_override in {"openai", "anthropic"}:
        return provider_override

    normalized = base_url.rstrip("/").lower()
    parsed = urlparse(normalized)

    if "anthropic.com" in parsed.netloc or parsed.path.endswith("/messages"):
        return "anthropic"

    return "openai"


def _chat_completions_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized
    return f"{normalized}/chat/completions"


def _anthropic_messages_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    parsed = urlparse(normalized)

    if parsed.path.endswith("/messages"):
        return normalized
    if parsed.path.endswith("/v1"):
        return f"{normalized}/messages"
    if "anthropic.com" in parsed.netloc and not parsed.path:
        return f"{normalized}/v1/messages"
    return f"{normalized}/messages"


def _to_openai_content(user_content: list[dict[str, Any]]) -> list[dict[str, Any]]:
    converted: list[dict[str, Any]] = []

    for item in user_content:
        item_type = item.get("type")

        if item_type == "text":
            text = item.get("text")
            if isinstance(text, str):
                converted.append({"type": "text", "text": text})
            continue

        if item_type == "image":
            source = item.get("source")
            if not isinstance(source, dict):
                raise AIRequestError("The image payload is missing its source block.")
            media_type = source.get("media_type")
            data = source.get("data")
            if not isinstance(media_type, str) or not isinstance(data, str):
                raise AIRequestError(
                    "The image payload must include a media type and base64 data."
                )
            converted.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{media_type};base64,{data}",
                    },
                }
            )

    if not converted:
        raise AIRequestError("The model request did not include any usable user content.")

    return converted


def _to_anthropic_content(user_content: list[dict[str, Any]]) -> list[dict[str, Any]]:
    converted: list[dict[str, Any]] = []

    for item in user_content:
        item_type = item.get("type")
        if item_type == "text":
            text = item.get("text")
            if isinstance(text, str):
                converted.append({"type": "text", "text": text})
            continue

        if item_type == "image":
            source = item.get("source")
            if not isinstance(source, dict):
                raise AIRequestError("The image payload is missing its source block.")
            converted.append(
                {
                    "type": "image",
                    "source": source,
                }
            )

    if not converted:
        raise AIRequestError("The model request did not include any usable user content.")

    return converted


def _extract_error_message(response: httpx.Response) -> str:
    fallback_message = (
        f"OpenAI-compatible request failed with status {response.status_code}."
    )

    try:
        error_data = response.json()
    except json.JSONDecodeError:
        return fallback_message

    if isinstance(error_data, dict):
        error_block = error_data.get("error")
        if isinstance(error_block, dict):
            message = error_block.get("message")
            if isinstance(message, str) and message.strip():
                return message.strip()
        detail = error_data.get("detail")
        if isinstance(detail, str) and detail.strip():
            return detail.strip()

    return fallback_message


def _extract_message_text(response_data: dict[str, Any]) -> str:
    try:
        message = response_data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError) as exc:
        raise AIResponseError(
            "The model server returned an unexpected response structure."
        ) from exc

    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content

    if isinstance(content, list):
        text_parts = [
            item.get("text", "")
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        ]
        joined = "".join(part for part in text_parts if isinstance(part, str))
        if joined.strip():
            return joined

    raise AIResponseError("The model server returned an empty response body.")


def _extract_anthropic_tool_input(response_data: dict[str, Any]) -> dict[str, Any]:
    content = response_data.get("content")
    if not isinstance(content, list):
        raise AIResponseError(
            "The Anthropic response did not include a valid content list."
        )

    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_use":
            tool_input = block.get("input")
            if isinstance(tool_input, dict):
                return tool_input
            raise AIResponseError(
                "The Anthropic tool response did not contain a JSON object."
            )

    text_parts = [
        block.get("text", "")
        for block in content
        if isinstance(block, dict) and block.get("type") == "text"
    ]
    raw_payload = "".join(part for part in text_parts if isinstance(part, str))
    if not raw_payload.strip():
        raise AIResponseError("The model server returned an empty response body.")

    try:
        parsed_payload = json.loads(raw_payload)
    except json.JSONDecodeError as exc:
        raise AIResponseError(
            "The Anthropic response did not contain valid JSON text."
        ) from exc

    if not isinstance(parsed_payload, dict):
        raise AIResponseError(
            "The Anthropic response did not contain a JSON object."
        )

    return parsed_payload

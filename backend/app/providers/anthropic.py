import json
from typing import Any
from urllib.parse import urlparse

import httpx

from app.providers.base import (
    AIConfigurationError,
    AIRequestError,
    AIResponseError,
    JSONMessageRequest,
)


class AnthropicProvider:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        timeout_seconds: float,
        anthropic_version: str,
    ) -> None:
        self._base_url = base_url
        self._api_key = api_key
        self._timeout_seconds = timeout_seconds
        self._anthropic_version = anthropic_version

    def send_json_message(self, request: JSONMessageRequest) -> dict[str, Any]:
        api_key = self._api_key.strip()
        if not api_key or api_key == "EMPTY":
            raise AIConfigurationError(
                "AI_API_KEY is not configured for Anthropic requests."
            )

        payload = {
            "model": request.model,
            "max_tokens": request.max_tokens,
            "system": request.system_prompt,
            "messages": [
                {
                    "role": "user",
                    "content": _to_anthropic_content(request.user_content),
                }
            ],
            "tools": [
                {
                    "name": "return_json",
                    "description": "Return the response payload so it matches the provided JSON schema exactly.",
                    "input_schema": request.output_schema,
                }
            ],
            "tool_choice": {
                "type": "tool",
                "name": "return_json",
            },
        }

        headers = {
            "x-api-key": api_key,
            "anthropic-version": self._anthropic_version,
            "Content-Type": "application/json",
        }

        try:
            response = httpx.post(
                _anthropic_messages_url(self._base_url),
                headers=headers,
                json=payload,
                timeout=self._timeout_seconds,
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
            continue

        if item_type == "audio":
            raise AIRequestError(
                "Audio input is not supported for the Anthropic provider in this build."
            )

    if not converted:
        raise AIRequestError("The model request did not include any usable user content.")

    return converted


def _extract_error_message(response: httpx.Response) -> str:
    fallback_message = f"Anthropic request failed with status {response.status_code}."

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

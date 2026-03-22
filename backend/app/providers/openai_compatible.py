import json
from typing import Any

import httpx

from app.providers.base import AIRequestError, AIResponseError, JSONMessageRequest


class OpenAICompatibleProvider:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        timeout_seconds: float,
    ) -> None:
        self._base_url = base_url
        self._api_key = api_key or "EMPTY"
        self._timeout_seconds = timeout_seconds

    def send_json_message(self, request: JSONMessageRequest) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        try:
            response = self._post_json_message(
                headers=headers,
                payload=_build_payload(request=request, response_format_type="json_schema"),
            )
        except httpx.HTTPError as exc:
            raise AIRequestError(
                "The OpenAI-compatible request could not reach the configured model server."
            ) from exc

        if response.status_code >= 400:
            if _should_retry_with_json_object(response):
                try:
                    response = self._post_json_message(
                        headers=headers,
                        payload=_build_payload(
                            request=request,
                            response_format_type="json_object",
                        ),
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
            parsed_payload = json.loads(raw_payload)
        except json.JSONDecodeError as exc:
            raise AIResponseError(
                "The model server returned invalid JSON content."
            ) from exc

        if not isinstance(parsed_payload, dict):
            raise AIResponseError("The model server returned a JSON value that was not an object.")

        return parsed_payload

    def _post_json_message(
        self,
        *,
        headers: dict[str, str],
        payload: dict[str, Any],
    ) -> httpx.Response:
        return httpx.post(
            _chat_completions_url(self._base_url),
            headers=headers,
            json=payload,
            timeout=self._timeout_seconds,
        )


def _build_payload(
    *,
    request: JSONMessageRequest,
    response_format_type: str,
) -> dict[str, Any]:
    system_prompt = request.system_prompt
    response_format: dict[str, Any] = {"type": response_format_type}

    if response_format_type == "json_schema":
        response_format["json_schema"] = {
            "name": "coach_response",
            "schema": request.output_schema,
        }
    elif response_format_type == "json_object":
        system_prompt = _system_prompt_with_embedded_schema(
            request.system_prompt,
            request.output_schema,
        )

    return {
        "model": request.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": _to_openai_content(request.user_content)},
        ],
        "max_tokens": request.max_tokens,
        "temperature": 0,
        "response_format": response_format,
    }


def _system_prompt_with_embedded_schema(
    system_prompt: str,
    output_schema: dict[str, Any],
) -> str:
    schema_json = json.dumps(output_schema, indent=2, sort_keys=True)
    return (
        f"{system_prompt}\n\n"
        "Return a valid JSON object that matches this schema exactly. "
        "Do not wrap the JSON in markdown or add any extra commentary.\n"
        f"{schema_json}"
    )


def _should_retry_with_json_object(response: httpx.Response) -> bool:
    if response.status_code not in {400, 404, 422}:
        return False

    error_message = _extract_error_message(response).lower()
    return "json_schema" in error_message or (
        "response_format" in error_message and "schema" in error_message
    )


def _chat_completions_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized
    return f"{normalized}/chat/completions"


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
            continue

        if item_type == "audio":
            source = item.get("source")
            if not isinstance(source, dict):
                raise AIRequestError("The audio payload is missing its source block.")
            data = source.get("data")
            audio_format = source.get("format")
            if not isinstance(data, str) or not isinstance(audio_format, str):
                raise AIRequestError(
                    "The audio payload must include base64 data and a format."
                )
            normalized_format = audio_format.strip().lower()
            if normalized_format not in {"wav", "mp3"}:
                raise AIRequestError(
                    "The audio payload format must be wav or mp3 for the OpenAI-compatible provider."
                )
            converted.append(
                {
                    "type": "input_audio",
                    "input_audio": {
                        "data": data,
                        "format": normalized_format,
                    },
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

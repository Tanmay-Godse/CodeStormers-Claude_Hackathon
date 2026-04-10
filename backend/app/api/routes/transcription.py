from time import perf_counter

from fastapi import APIRouter, HTTPException

from app.core.config import settings
from app.providers.base import AIConfigurationError, AIRequestError, AIResponseError
from app.schemas.transcription import (
    TranscriptionTestRequest,
    TranscriptionTestResponse,
)
from app.services import transcription_service

router = APIRouter(tags=["transcription"])


def _get_transcription_provider_label(api_base_url: str) -> str:
    normalized = api_base_url.strip().lower()
    if "api.openai.com" in normalized:
        return "OpenAI API"
    if normalized:
        return "Custom transcription API"
    return "Backend transcription API"


@router.post("/transcription/test", response_model=TranscriptionTestResponse)
def test_transcription(payload: TranscriptionTestRequest) -> TranscriptionTestResponse:
    started_at = perf_counter()

    try:
        transcript = transcription_service.transcribe_audio_clip(
            audio_base64=payload.audio_base64,
            audio_format=payload.audio_format,
        )
    except AIConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (AIRequestError, AIResponseError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    latency_ms = max(0, round((perf_counter() - started_at) * 1000))

    return TranscriptionTestResponse(
        transcript=transcript,
        latency_ms=latency_ms,
        transcription_model=settings.transcription_model,
        transcription_api_base_url=settings.transcription_api_base_url,
        transcription_provider=_get_transcription_provider_label(
            settings.transcription_api_base_url,
        ),
    )

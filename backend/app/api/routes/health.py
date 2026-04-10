from fastapi import APIRouter

from app.core.config import settings
from app.providers.base import is_placeholder_api_key

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check() -> dict[str, bool | str]:
    ai_ready = bool(settings.ai_api_key) and not is_placeholder_api_key(
        settings.ai_api_key
    )
    transcription_ready = bool(
        settings.transcription_api_key
    ) and not is_placeholder_api_key(settings.transcription_api_key)

    return {
        "status": "ok",
        "simulation_only": settings.simulation_only,
        "ai_provider": settings.ai_provider,
        "ai_ready": ai_ready,
        "ai_coach_model": settings.ai_coach_model,
        "transcription_ready": transcription_ready,
        "transcription_model": settings.transcription_model,
        "transcription_api_base_url": settings.transcription_api_base_url,
    }

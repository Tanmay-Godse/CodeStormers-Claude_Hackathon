from fastapi import APIRouter

from app.core.config import settings
router = APIRouter(tags=["health"])


@router.get("/health")
def health_check() -> dict[str, bool | str]:
    ai_ready = settings.any_ai_ready()
    transcription_ready = settings.transcription_ready()

    return {
        "status": "ok",
        "simulation_only": settings.simulation_only,
        "ai_provider": settings.ai_provider,
        "ai_ready": ai_ready,
        "ai_coach_model": settings.ai_health_coach_model(),
        "transcription_ready": transcription_ready,
        "transcription_model": settings.transcription_model,
        "transcription_api_base_url": settings.transcription_api_base_url,
    }

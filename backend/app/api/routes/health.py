from fastapi import APIRouter

from app.core.config import settings
router = APIRouter(tags=["health"])


@router.get("/health")
def health_check() -> dict[str, bool | str]:
    ai_ready = settings.any_ai_ready()
    transcription_ready = settings._ai_stack_ready(
        api_base_url=settings.transcription_api_base_url,
        api_key=settings.transcription_api_key,
        analysis_model=settings.transcription_model,
        coach_model=settings.transcription_model,
        debrief_model=settings.transcription_model,
    )

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

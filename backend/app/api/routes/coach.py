from fastapi import APIRouter, HTTPException

from app.schemas.coach import CoachChatRequest, CoachChatResponse
from app.services import coach_service
from app.services.ai_client import AIConfigurationError
from app.services.procedure_loader import ProcedureNotFoundError, StageNotFoundError

router = APIRouter(tags=["coach"])


@router.post("/coach-chat", response_model=CoachChatResponse)
def coach_chat(payload: CoachChatRequest) -> CoachChatResponse:
    try:
        return coach_service.generate_coach_turn(payload)
    except (ProcedureNotFoundError, StageNotFoundError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AIConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

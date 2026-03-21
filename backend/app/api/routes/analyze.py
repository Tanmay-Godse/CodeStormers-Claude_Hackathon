from fastapi import APIRouter, HTTPException

from app.schemas.analyze import AnalyzeFrameRequest, AnalyzeFrameResponse
from app.services import analysis_service
from app.services.ai_client import (
    AIConfigurationError,
    AIRequestError,
    AIResponseError,
)
from app.services.procedure_loader import ProcedureNotFoundError, StageNotFoundError

router = APIRouter(tags=["analyze"])


@router.post("/analyze-frame", response_model=AnalyzeFrameResponse)
def analyze_frame(payload: AnalyzeFrameRequest) -> AnalyzeFrameResponse:
    try:
        return analysis_service.analyze_frame_payload(payload)
    except (ProcedureNotFoundError, StageNotFoundError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AIConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (AIRequestError, AIResponseError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

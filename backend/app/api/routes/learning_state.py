from typing import Any

from fastapi import APIRouter, Header, HTTPException

from app.schemas.learning_state import (
    LearningStateSnapshot,
    UpsertKnowledgeProgressRequest,
    UpsertLearningSessionRequest,
)
from app.services import learning_state_service
from app.services.auth_service import AuthAccountNotFoundError, AuthPermissionError
from app.services.learning_state_service import LearningStateValidationError

router = APIRouter(tags=["learning-state"])


@router.get("/learning-state", response_model=LearningStateSnapshot)
def get_learning_state(
    account_id: str = Header(alias="X-Account-Id", min_length=3),
    session_token: str = Header(alias="X-Session-Token", min_length=16),
) -> LearningStateSnapshot:
    try:
        return learning_state_service.get_learning_state(
            account_id=account_id,
            session_token=session_token,
        )
    except AuthAccountNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AuthPermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LearningStateValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/learning-state/sessions/{session_id}", response_model=dict[str, Any])
def upsert_learning_session(
    session_id: str,
    payload: UpsertLearningSessionRequest,
) -> dict[str, Any]:
    try:
        return learning_state_service.upsert_learning_session(
            session_id=session_id,
            account_id=payload.account_id,
            session_token=payload.session_token,
            session=payload.session,
            make_active=payload.make_active,
        )
    except AuthAccountNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AuthPermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LearningStateValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put(
    "/learning-state/knowledge-progress",
    response_model=dict[str, Any],
)
def upsert_knowledge_progress(
    payload: UpsertKnowledgeProgressRequest,
) -> dict[str, Any]:
    try:
        return learning_state_service.upsert_knowledge_progress(
            account_id=payload.account_id,
            session_token=payload.session_token,
            progress=payload.progress,
        )
    except AuthAccountNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AuthPermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LearningStateValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

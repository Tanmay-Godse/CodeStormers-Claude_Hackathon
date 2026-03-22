from fastapi import APIRouter, HTTPException, Query, status

from app.schemas.auth import (
    AuthAccountPreview,
    CreateAuthAccountRequest,
    SignInAuthRequest,
)
from app.services import auth_service
from app.services.auth_service import (
    AuthAccountConflictError,
    AuthAccountNotFoundError,
    AuthDuplicateDisplayNameError,
    AuthValidationError,
)

router = APIRouter(tags=["auth"])


@router.get("/auth/accounts/preview", response_model=AuthAccountPreview)
def preview_auth_account(
    identifier: str = Query(min_length=3),
) -> AuthAccountPreview:
    try:
        return auth_service.preview_auth_account(identifier)
    except AuthAccountNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AuthDuplicateDisplayNameError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except AuthValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/auth/accounts",
    response_model=AuthAccountPreview,
    status_code=status.HTTP_201_CREATED,
)
def create_auth_account(
    payload: CreateAuthAccountRequest,
) -> AuthAccountPreview:
    try:
        return auth_service.create_auth_account(payload)
    except AuthAccountConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except AuthValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/auth/sign-in", response_model=AuthAccountPreview)
def sign_in_auth_user(payload: SignInAuthRequest) -> AuthAccountPreview:
    try:
        return auth_service.sign_in_auth_user(payload)
    except AuthAccountNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AuthAccountConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except AuthDuplicateDisplayNameError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except AuthValidationError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

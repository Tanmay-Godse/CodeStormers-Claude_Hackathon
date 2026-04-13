from fastapi import APIRouter, Header, HTTPException, Query, status

from app.schemas.auth import (
    AuthAccountPreview,
    ConsumeLiveSessionRequest,
    CreateAuthAccountRequest,
    ResetLiveSessionLimitRequest,
    ResolveAdminRequest,
    SignInAuthRequest,
    UpdateAuthAccountRequest,
)
from app.services import auth_service
from app.services.auth_service import (
    AuthAccountConflictError,
    AuthAccountNotFoundError,
    AuthDuplicateDisplayNameError,
    AuthPermissionError,
    AuthValidationError,
)

router = APIRouter(tags=["auth"])


@router.get("/auth/session", response_model=AuthAccountPreview)
def get_authenticated_auth_account(
    actor_account_id: str = Header(alias="X-Account-Id", min_length=3),
    actor_session_token: str = Header(alias="X-Session-Token", min_length=16),
) -> AuthAccountPreview:
    try:
        return auth_service.get_authenticated_auth_account(
            actor_account_id=actor_account_id,
            actor_session_token=actor_session_token,
        )
    except AuthAccountNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AuthPermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except AuthValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/auth/accounts/preview", response_model=AuthAccountPreview)
def preview_auth_account(
    identifier: str = Query(min_length=3),
    actor_account_id: str = Header(alias="X-Account-Id", min_length=3),
    actor_session_token: str = Header(alias="X-Session-Token", min_length=16),
) -> AuthAccountPreview:
    try:
        return auth_service.preview_authenticated_auth_account(
            identifier=identifier,
            actor_account_id=actor_account_id,
            actor_session_token=actor_session_token,
        )
    except AuthAccountNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AuthPermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
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
    except AuthPermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
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


@router.put("/auth/accounts/{account_id}", response_model=AuthAccountPreview)
def update_auth_account(
    account_id: str,
    payload: UpdateAuthAccountRequest,
) -> AuthAccountPreview:
    try:
        return auth_service.update_auth_account(account_id, payload)
    except AuthAccountNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AuthAccountConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except AuthPermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except AuthValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/auth/admin-requests", response_model=list[AuthAccountPreview])
def list_pending_admin_requests(
    developer_account_id: str = Header(alias="X-Account-Id", min_length=3),
    developer_session_token: str = Header(alias="X-Session-Token", min_length=16),
) -> list[AuthAccountPreview]:
    try:
        return auth_service.list_pending_admin_requests(
            developer_account_id,
            developer_session_token,
        )
    except AuthAccountNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AuthPermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except AuthValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/auth/admin-requests/{account_id}/approve",
    response_model=AuthAccountPreview,
)
def approve_admin_request(
    account_id: str,
    payload: ResolveAdminRequest,
) -> AuthAccountPreview:
    try:
        return auth_service.resolve_admin_request(
            target_account_id=account_id,
            payload=payload,
            approved=True,
        )
    except AuthAccountNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AuthPermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except AuthValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/auth/demo-accounts", response_model=list[AuthAccountPreview])
def list_demo_accounts(
    actor_account_id: str = Header(alias="X-Account-Id", min_length=3),
    actor_session_token: str = Header(alias="X-Session-Token", min_length=16),
) -> list[AuthAccountPreview]:
    try:
        return auth_service.list_live_session_accounts(
            actor_account_id,
            actor_session_token,
        )
    except AuthAccountNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AuthPermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except AuthValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/auth/live-sessions/consume", response_model=AuthAccountPreview)
def consume_live_session(
    payload: ConsumeLiveSessionRequest,
) -> AuthAccountPreview:
    try:
        return auth_service.consume_live_session(payload)
    except AuthAccountNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AuthPermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except AuthValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/auth/accounts/{account_id}/reset-live-sessions",
    response_model=AuthAccountPreview,
)
def reset_live_session_limit(
    account_id: str,
    payload: ResetLiveSessionLimitRequest,
) -> AuthAccountPreview:
    try:
        return auth_service.reset_live_session_limit(account_id, payload)
    except AuthAccountNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AuthPermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except AuthValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/auth/admin-requests/{account_id}/reject",
    response_model=AuthAccountPreview,
)
def reject_admin_request(
    account_id: str,
    payload: ResolveAdminRequest,
) -> AuthAccountPreview:
    try:
        return auth_service.resolve_admin_request(
            target_account_id=account_id,
            payload=payload,
            approved=False,
        )
    except AuthAccountNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AuthPermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except AuthValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

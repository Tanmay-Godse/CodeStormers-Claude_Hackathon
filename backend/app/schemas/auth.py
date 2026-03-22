from typing import Literal

from pydantic import BaseModel, ConfigDict

AdminApprovalStatus = Literal["none", "pending", "rejected"]


class AuthAccountPreview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    username: str
    role: Literal["student", "admin"]
    is_developer: bool = False
    is_seeded: bool = False
    requested_role: Literal["admin"] | None = None
    admin_approval_status: AdminApprovalStatus = "none"
    live_session_limit: int | None = None
    live_session_used: int = 0
    live_session_remaining: int | None = None
    session_token: str | None = None
    created_at: str


class CreateAuthAccountRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    username: str
    password: str
    role: Literal["student", "admin"]


class SignInAuthRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    identifier: str
    password: str
    role: Literal["student", "admin"] | None = None


class UpdateAuthAccountRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    username: str
    current_password: str
    new_password: str | None = None


class ResolveAdminRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    developer_account_id: str
    developer_session_token: str


class ConsumeLiveSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_id: str
    session_token: str


class ResetLiveSessionLimitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    actor_account_id: str
    actor_session_token: str

from typing import Literal

from pydantic import BaseModel, ConfigDict


class AuthAccountPreview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    username: str
    role: Literal["student", "admin"]
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

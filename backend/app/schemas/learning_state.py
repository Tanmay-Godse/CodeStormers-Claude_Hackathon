from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class LearningStateAuthRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_id: str
    session_token: str


class UpsertLearningSessionRequest(LearningStateAuthRequest):
    model_config = ConfigDict(extra="forbid")

    session: dict[str, Any]
    make_active: bool = False


class UpsertKnowledgeProgressRequest(LearningStateAuthRequest):
    model_config = ConfigDict(extra="forbid")

    progress: dict[str, Any]


class LearningStateSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sessions: list[dict[str, Any]] = Field(default_factory=list)
    active_session_ids: dict[str, str] = Field(default_factory=dict)
    knowledge_progress: dict[str, Any] = Field(default_factory=dict)

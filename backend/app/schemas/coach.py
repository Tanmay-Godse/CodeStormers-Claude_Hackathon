from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.analyze import EquityModeConfig, FeedbackLanguage


class CoachChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class CoachChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    procedure_id: str
    stage_id: str
    skill_level: Literal["beginner", "intermediate"]
    practice_surface: str | None = None
    learner_focus: str | None = None
    feedback_language: FeedbackLanguage = "en"
    simulation_confirmation: bool = False
    image_base64: str | None = None
    audio_base64: str | None = None
    audio_format: Literal["wav", "mp3"] | None = None
    student_name: str | None = None
    session_id: str | None = None
    equity_mode: EquityModeConfig = Field(default_factory=EquityModeConfig)
    messages: list[CoachChatMessage] = Field(default_factory=list, max_length=12)


class CoachChatResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_stage: Literal["goal_setting", "planning", "guiding", "blocked"]
    coach_message: str
    plan_summary: str
    suggested_next_step: str
    camera_observations: list[str] = Field(default_factory=list, max_length=3)
    stage_focus: list[str] = Field(default_factory=list, max_length=3)
    learner_goal_summary: str = ""
    learner_transcript: str = ""


class CoachChatDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_stage: Literal["goal_setting", "planning", "guiding"]
    coach_message: str
    plan_summary: str
    suggested_next_step: str
    camera_observations: list[str] = Field(default_factory=list, max_length=3)
    stage_focus: list[str] = Field(default_factory=list, max_length=3)
    learner_goal_summary: str = ""

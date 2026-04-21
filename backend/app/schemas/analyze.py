from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

FeedbackLanguage = Literal["en", "es", "fr", "hi"]


class Issue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    severity: Literal["low", "medium", "high"]
    message: str


class EquityModeConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    audio_coaching: bool = False
    low_bandwidth_mode: bool = False
    cheap_phone_mode: bool = False
    offline_practice_logging: bool = False


class AnalyzeFrameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    procedure_id: str
    stage_id: str
    skill_level: Literal["beginner", "intermediate"]
    practice_surface: str | None = None
    image_base64: str = Field(min_length=1)
    student_question: str | None = None
    simulation_confirmation: bool = False
    session_id: str | None = None
    student_name: str | None = None
    student_username: str | None = None
    feedback_language: FeedbackLanguage = "en"
    equity_mode: EquityModeConfig = Field(default_factory=EquityModeConfig)


class AnalyzeLiveFrameRequest(AnalyzeFrameRequest):
    model_config = ConfigDict(extra="forbid")

    force_refresh: bool = False
    min_analysis_interval_ms: int = Field(default=600, ge=250, le=10000)
    state_window_ms: int = Field(default=5000, ge=1000, le=20000)


class SafetyGateResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["cleared", "blocked", "needs_human_review"]
    confidence: float = Field(ge=0, le=1)
    reason: str
    refusal_message: str | None = None


class TemporalAnalysisState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analysis_source: Literal["fresh", "cached", "smoothed"]
    dominant_step_status: Literal["pass", "retry", "unclear", "unsafe"]
    recent_analysis_count: int = Field(ge=1)
    stability: float = Field(ge=0, le=1)
    analysis_window_ms: int = Field(ge=0)
    next_recommended_check_ms: int = Field(ge=0)


class AnalyzeFrameResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analysis_mode: Literal["coaching", "blocked"] = "coaching"
    step_status: Literal["pass", "retry", "unclear", "unsafe"]
    grading_decision: Literal["graded", "not_graded"] = "graded"
    grading_reason: str | None = None
    confidence: float = Field(ge=0, le=1)
    visible_observations: list[str]
    issues: list[Issue]
    coaching_message: str
    next_action: str
    overlay_target_ids: list[str]
    score_delta: int = Field(ge=0)
    safety_gate: SafetyGateResult
    requires_human_review: bool = False
    human_review_reason: str | None = None
    review_case_id: str | None = None
    temporal_state: TemporalAnalysisState | None = None


class AnalysisDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step_status: Literal["pass", "retry", "unclear", "unsafe"]
    confidence: float = Field(ge=0, le=1)
    visible_observations: list[str] = Field(min_length=2, max_length=4)
    issues: list[Issue] = Field(default_factory=list, max_length=3)
    coaching_message: str
    next_action: str
    overlay_target_ids: list[str] = Field(default_factory=list, max_length=3)


class SafetyGateDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["cleared", "blocked", "needs_human_review"]
    confidence: float = Field(ge=0, le=1)
    reason: str
    refusal_message: str | None = None

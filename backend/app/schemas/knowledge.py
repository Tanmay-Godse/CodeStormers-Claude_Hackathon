from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.analyze import FeedbackLanguage

KnowledgeStudyMode = Literal[
    "current_procedure",
    "related_topics",
    "common_mistakes",
]


class KnowledgeMultipleChoiceQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    stage_id: str
    prompt: str
    choices: list[str] = Field(min_length=4, max_length=4)
    correct_index: int = Field(ge=0, le=3)
    explanation: str
    point_value: int = Field(ge=5, le=40)
    difficulty: Literal["warmup", "core", "challenge"] = "core"


class KnowledgeFlashcard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    stage_id: str
    front: str
    back: str
    memory_tip: str
    point_value: int = Field(ge=5, le=25)


class KnowledgeTopicSuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    description: str
    study_mode: KnowledgeStudyMode


class KnowledgePackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    procedure_id: str
    skill_level: Literal["beginner", "intermediate"]
    feedback_language: FeedbackLanguage = "en"
    learner_name: str | None = None
    focus_area: str | None = None
    study_mode: KnowledgeStudyMode = "current_procedure"
    selected_topic: str | None = None
    recent_issue_labels: list[str] = Field(default_factory=list, max_length=5)
    avoid_question_prompts: list[str] = Field(default_factory=list, max_length=80)
    avoid_flashcard_fronts: list[str] = Field(default_factory=list, max_length=80)
    generation_nonce: str | None = None


class KnowledgePackResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    study_mode: KnowledgeStudyMode
    topic_title: str
    title: str
    summary: str
    recommended_focus: str
    celebration_line: str
    topic_suggestions: list[KnowledgeTopicSuggestion] = Field(min_length=4, max_length=8)
    rapidfire_rounds: list[KnowledgeMultipleChoiceQuestion] = Field(
        min_length=4, max_length=6
    )
    quiz_questions: list[KnowledgeMultipleChoiceQuestion] = Field(
        min_length=4, max_length=6
    )
    flashcards: list[KnowledgeFlashcard] = Field(min_length=4, max_length=8)

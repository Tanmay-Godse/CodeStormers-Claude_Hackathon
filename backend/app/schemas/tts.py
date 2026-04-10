from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.analyze import FeedbackLanguage


class SpeechSynthesisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=600)
    feedback_language: FeedbackLanguage = "en"
    coach_voice: Literal["guide_male", "guide_female", "mentor_female", "system_default"] = (
        "guide_female"
    )

    @field_validator("coach_voice", mode="before")
    @classmethod
    def normalize_legacy_voice_presets(cls, value: object) -> object:
        if value == "guide_male":
            return "guide_male"
        if value == "mentor_male":
            return "guide_male"
        return value

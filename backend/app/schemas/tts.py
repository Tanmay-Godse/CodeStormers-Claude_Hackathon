from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.analyze import FeedbackLanguage


class SpeechSynthesisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=600)
    feedback_language: FeedbackLanguage = "en"
    coach_voice: Literal["guide_male", "mentor_male", "system_default"] = (
        "guide_male"
    )

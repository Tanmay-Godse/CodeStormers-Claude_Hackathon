from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class TranscriptionTestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    audio_base64: str = Field(min_length=8)
    audio_format: Literal["wav", "mp3"] = "wav"


class TranscriptionTestResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    transcript: str = Field(min_length=1)
    latency_ms: int = Field(ge=0)
    transcription_model: str = Field(min_length=1)
    transcription_api_base_url: str = Field(min_length=1)
    transcription_provider: str = Field(min_length=1)

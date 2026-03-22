from __future__ import annotations

import os
import tempfile
from typing import Any

from app.schemas.tts import SpeechSynthesisRequest


class TTSConfigurationError(RuntimeError):
    pass


class TTSSynthesisError(RuntimeError):
    pass


VOICE_ID_PREFERENCES: dict[str, dict[str, list[str]]] = {
    "en": {
        "guide_male": ["gmw/en-us", "gmw/en", "gmw/en-gb-x-rp"],
        "mentor_male": ["gmw/en-gb-x-rp", "gmw/en", "gmw/en-us"],
        "system_default": ["gmw/en-us", "gmw/en"],
    },
    "es": {
        "guide_male": ["roa/es", "roa/es-419"],
        "mentor_male": ["roa/es-419", "roa/es"],
        "system_default": ["roa/es", "roa/es-419"],
    },
    "fr": {
        "guide_male": ["roa/fr", "roa/fr-be", "roa/fr-ch"],
        "mentor_male": ["roa/fr", "roa/fr-ch", "roa/fr-be"],
        "system_default": ["roa/fr", "roa/fr-be", "roa/fr-ch"],
    },
    "hi": {
        "guide_male": ["inc/hi"],
        "mentor_male": ["inc/hi"],
        "system_default": ["inc/hi"],
    },
}

VOICE_RATE_BY_PRESET = {
    "guide_male": 172,
    "mentor_male": 155,
    "system_default": 180,
}


def synthesize_speech_wav(payload: SpeechSynthesisRequest) -> bytes:
    text = " ".join(payload.text.split())
    if not text:
        raise TTSSynthesisError("Speech text was empty after normalization.")

    try:
        import pyttsx3
    except ImportError as exc:
        raise TTSConfigurationError(
            "Backend TTS requires pyttsx3. Install backend requirements and restart the backend."
        ) from exc

    file_descriptor, output_path = tempfile.mkstemp(suffix=".wav")
    os.close(file_descriptor)
    engine: Any | None = None

    try:
        engine = pyttsx3.init()
        selected_voice_id = _select_voice_id(
            engine=engine,
            language=payload.feedback_language,
            coach_voice=payload.coach_voice,
        )
        if selected_voice_id:
            engine.setProperty("voice", selected_voice_id)

        engine.setProperty(
            "rate",
            VOICE_RATE_BY_PRESET.get(payload.coach_voice, VOICE_RATE_BY_PRESET["guide_male"]),
        )
        engine.save_to_file(text, output_path)
        engine.runAndWait()
        engine.stop()

        if not os.path.exists(output_path) or os.path.getsize(output_path) <= 0:
            raise TTSSynthesisError("Backend TTS did not produce any audio output.")

        with open(output_path, "rb") as audio_file:
            return audio_file.read()
    except (TTSConfigurationError, TTSSynthesisError):
        raise
    except Exception as exc:
        raise TTSSynthesisError(
            "Backend TTS could not synthesize speech on this machine."
        ) from exc
    finally:
        if engine is not None:
            try:
                engine.stop()
            except Exception:
                pass
        if os.path.exists(output_path):
            os.remove(output_path)


def _select_voice_id(*, engine: Any, language: str, coach_voice: str) -> str | None:
    voices = engine.getProperty("voices") or []
    preferred_ids = VOICE_ID_PREFERENCES.get(language, {}).get(coach_voice, [])

    for preferred_id in preferred_ids:
        if any(getattr(voice, "id", "") == preferred_id for voice in voices):
            return preferred_id

    for voice in voices:
        voice_id = str(getattr(voice, "id", "")).lower()
        voice_languages = [
            str(item).lower() for item in getattr(voice, "languages", []) or []
        ]
        if (
            voice_id.endswith(f"/{language}")
            or f"/{language}-" in voice_id
            or any(language in item for item in voice_languages)
        ):
            return getattr(voice, "id", None)

    return getattr(voices[0], "id", None) if voices else None

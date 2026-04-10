from __future__ import annotations

import asyncio
import os
import tempfile
from dataclasses import dataclass
from typing import Any

from app.schemas.tts import SpeechSynthesisRequest


class TTSConfigurationError(RuntimeError):
    pass


class TTSSynthesisError(RuntimeError):
    pass


@dataclass(frozen=True)
class SynthesizedSpeechAudio:
    audio_bytes: bytes
    media_type: str


EDGE_TTS_VOICE_IDS: dict[str, dict[str, list[str]]] = {
    "en": {
        "guide_male": [
            "en-US-GuyNeural",
            "en-US-DavisNeural",
            "en-US-TonyNeural",
        ],
        "guide_female": [
            "en-US-JennyNeural",
            "en-US-AvaNeural",
            "en-US-AriaNeural",
            "en-US-EmmaNeural",
        ],
        "mentor_female": [
            "en-US-AriaNeural",
            "en-US-MichelleNeural",
            "en-US-EmmaNeural",
            "en-US-JennyNeural",
        ],
        "system_default": [
            "en-US-AvaNeural",
            "en-US-EmmaNeural",
        ],
    },
    "es": {
        "guide_female": ["es-MX-DaliaNeural", "es-ES-ElviraNeural"],
        "mentor_female": ["es-ES-ElviraNeural", "es-MX-DaliaNeural"],
        "system_default": ["es-MX-DaliaNeural", "es-ES-ElviraNeural"],
    },
    "fr": {
        "guide_female": ["fr-FR-DeniseNeural", "fr-FR-EloiseNeural"],
        "mentor_female": ["fr-FR-EloiseNeural", "fr-FR-DeniseNeural"],
        "system_default": ["fr-FR-DeniseNeural", "fr-FR-EloiseNeural"],
    },
    "hi": {
        "guide_female": ["hi-IN-SwaraNeural"],
        "mentor_female": ["hi-IN-SwaraNeural"],
        "system_default": ["hi-IN-SwaraNeural"],
    },
}

EDGE_TTS_RATE_BY_PRESET = {
    "guide_male": "+0%",
    "guide_female": "+4%",
    "mentor_female": "-2%",
    "system_default": "+0%",
}

EDGE_TTS_PITCH_BY_PRESET = {
    "guide_male": "+0Hz",
    "guide_female": "+2Hz",
    "mentor_female": "+0Hz",
    "system_default": "+0Hz",
}


VOICE_ID_PREFERENCES: dict[str, dict[str, list[str]]] = {
    "en": {
        "guide_male": ["gmw/en-us-nyc", "gmw/en-us"],
        "guide_female": ["gmw/en-us", "gmw/en-us-nyc"],
        "mentor_female": [
            "gmw/en-us-nyc",
            "gmw/en-us",
        ],
        "system_default": ["gmw/en-us", "gmw/en-us-nyc"],
    },
    "es": {
        "guide_female": ["roa/es", "roa/es-419"],
        "mentor_female": ["roa/es-419", "roa/es"],
        "system_default": ["roa/es", "roa/es-419"],
    },
    "fr": {
        "guide_female": ["roa/fr", "roa/fr-be", "roa/fr-ch"],
        "mentor_female": ["roa/fr", "roa/fr-ch", "roa/fr-be"],
        "system_default": ["roa/fr", "roa/fr-be", "roa/fr-ch"],
    },
    "hi": {
        "guide_female": ["inc/hi"],
        "mentor_female": ["inc/hi"],
        "system_default": ["inc/hi"],
    },
}

VOICE_RATE_BY_PRESET = {
    "guide_male": 168,
    "guide_female": 176,
    "mentor_female": 160,
    "system_default": 180,
}

VOICE_NAME_HINTS_BY_PRESET = {
    "guide_male": [
        "america",
        "american",
        "andrew",
        "brian",
        "christopher",
        "davis",
        "david",
        "eric",
        "guy",
        "james",
        "matthew",
        "new york",
        "new york city",
        "tony",
    ],
    "guide_female": [
        "america",
        "american",
        "allison",
        "aria",
        "ava",
        "emma",
        "jenny",
        "samantha",
        "victoria",
        "zira",
    ],
    "mentor_female": [
        "america",
        "american",
        "allison",
        "aria",
        "ava",
        "emma",
        "jenny",
        "kimberly",
        "kendra",
        "michelle",
        "new york",
        "new york city",
        "samantha",
        "sara",
        "susan",
        "victoria",
    ],
    "system_default": [],
}

FEMALE_VOICE_HINTS = [
    "female",
    "+f",
    "allison",
    "aria",
    "ava",
    "emma",
    "hazel",
    "jenny",
    "karen",
    "luna",
    "moira",
    "monica",
    "samantha",
    "sara",
    "susan",
    "victoria",
    "zira",
]

US_ENGLISH_VOICE_HINTS = [
    "en-us",
    "america",
    "american",
    "new york",
    "new york city",
    "united states",
]

MALE_VOICE_HINTS = [
    "male",
    "+m",
    "andrew",
    "alex",
    "arthur",
    "brian",
    "christopher",
    "davis",
    "daniel",
    "david",
    "eric",
    "fred",
    "guy",
    "james",
    "john",
    "lee",
    "matthew",
    "oliver",
    "thomas",
]


def synthesize_speech(payload: SpeechSynthesisRequest) -> SynthesizedSpeechAudio:
    text = " ".join(payload.text.split())
    if not text:
        raise TTSSynthesisError("Speech text was empty after normalization.")

    edge_error: RuntimeError | None = None
    try:
        return asyncio.run(_synthesize_with_edge_tts(text, payload))
    except (TTSConfigurationError, TTSSynthesisError) as exc:
        edge_error = exc
    except Exception as exc:
        edge_error = TTSSynthesisError("Neural TTS could not synthesize speech.")

    try:
        return SynthesizedSpeechAudio(
            audio_bytes=_synthesize_with_pyttsx3(text, payload),
            media_type="audio/wav",
        )
    except (TTSConfigurationError, TTSSynthesisError) as local_error:
        if edge_error and isinstance(edge_error, TTSConfigurationError):
            raise TTSConfigurationError(
                f"{edge_error} Local fallback also failed: {local_error}"
            ) from local_error

        if edge_error:
            raise TTSSynthesisError(
                f"{edge_error} Local fallback also failed: {local_error}"
            ) from local_error
        raise


def synthesize_speech_wav(payload: SpeechSynthesisRequest) -> bytes:
    return synthesize_speech(payload).audio_bytes


async def _synthesize_with_edge_tts(
    text: str,
    payload: SpeechSynthesisRequest,
) -> SynthesizedSpeechAudio:
    try:
        import edge_tts
    except ImportError as exc:
        raise TTSConfigurationError(
            "Backend neural TTS requires edge-tts. Install backend requirements and restart the backend."
        ) from exc

    voice_id = _select_edge_voice_id(
        language=payload.feedback_language,
        coach_voice=payload.coach_voice,
    )
    if not voice_id:
        raise TTSSynthesisError("No neural voice is configured for this language and preset.")

    file_descriptor, output_path = tempfile.mkstemp(suffix=".mp3")
    os.close(file_descriptor)

    try:
        communicate = edge_tts.Communicate(
            text=text,
            voice=voice_id,
            rate=EDGE_TTS_RATE_BY_PRESET.get(payload.coach_voice, "+0%"),
            pitch=EDGE_TTS_PITCH_BY_PRESET.get(payload.coach_voice, "+0Hz"),
        )
        await communicate.save(output_path)

        if not os.path.exists(output_path) or os.path.getsize(output_path) <= 0:
            raise TTSSynthesisError("Neural TTS did not produce any audio output.")

        with open(output_path, "rb") as audio_file:
            return SynthesizedSpeechAudio(
                audio_bytes=audio_file.read(),
                media_type="audio/mpeg",
            )
    except TTSSynthesisError:
        raise
    except Exception as exc:
        raise TTSSynthesisError("Neural TTS could not synthesize speech.") from exc
    finally:
        if os.path.exists(output_path):
            os.remove(output_path)


def _synthesize_with_pyttsx3(
    text: str,
    payload: SpeechSynthesisRequest,
) -> bytes:
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
            VOICE_RATE_BY_PRESET.get(
                payload.coach_voice, VOICE_RATE_BY_PRESET["guide_female"]
            ),
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


def _select_edge_voice_id(*, language: str, coach_voice: str) -> str | None:
    preferred = EDGE_TTS_VOICE_IDS.get(language, {}).get(coach_voice)
    if preferred:
        return preferred[0]

    fallback = EDGE_TTS_VOICE_IDS.get(language, {}).get("system_default")
    if fallback:
        return fallback[0]

    english_default = EDGE_TTS_VOICE_IDS.get("en", {}).get("guide_female", [])
    return english_default[0] if english_default else None


def _select_voice_id(*, engine: Any, language: str, coach_voice: str) -> str | None:
    voices = engine.getProperty("voices") or []
    preferred_ids = VOICE_ID_PREFERENCES.get(language, {}).get(coach_voice, [])
    preferred_hints = VOICE_NAME_HINTS_BY_PRESET.get(coach_voice, [])
    preferred_gender: str | None = None
    if coach_voice in {"guide_female", "mentor_female"}:
        preferred_gender = "female"
    elif coach_voice == "guide_male":
        preferred_gender = "male"

    best_voice_id: str | None = None
    best_score = float("-inf")

    for voice in voices:
        voice_id = str(getattr(voice, "id", ""))
        voice_name = str(getattr(voice, "name", ""))
        voice_gender = str(getattr(voice, "gender", ""))
        combined_voice_text = f"{voice_id} {voice_name} {voice_gender}".lower()
        voice_languages = [
            str(item).lower() for item in getattr(voice, "languages", []) or []
        ]

        language_score = 0
        lowered_voice_id = voice_id.lower()
        if (
            lowered_voice_id.endswith(f"/{language}")
            or f"/{language}-" in lowered_voice_id
            or any(language in item for item in voice_languages)
        ):
            language_score = 24
        elif any(language.split("-")[0] in item for item in voice_languages):
            language_score = 12

        preferred_id_index = (
            preferred_ids.index(voice_id) if voice_id in preferred_ids else None
        )
        preferred_id_score = (
            48 - preferred_id_index if preferred_id_index is not None else 0
        )
        preferred_hint_score = (
            18
            if any(hint in combined_voice_text for hint in preferred_hints)
            else 0
        )
        gender_score = (
            24
            if preferred_gender == "female"
            and any(hint in combined_voice_text for hint in FEMALE_VOICE_HINTS)
            else 24
            if preferred_gender == "male"
            and any(hint in combined_voice_text for hint in MALE_VOICE_HINTS)
            else 0
        )
        us_english_score = (
            18
            if language == "en"
            and coach_voice != "system_default"
            and any(hint in combined_voice_text for hint in US_ENGLISH_VOICE_HINTS)
            else 0
        )
        gender_mismatch_penalty = (
            -10
            if preferred_gender == "female"
            and any(hint in combined_voice_text for hint in MALE_VOICE_HINTS)
            else -10
            if preferred_gender == "male"
            and any(hint in combined_voice_text for hint in FEMALE_VOICE_HINTS)
            else 0
        )
        score = (
            language_score
            + preferred_id_score
            + preferred_hint_score
            + gender_score
            + us_english_score
            + gender_mismatch_penalty
        )

        if score > best_score:
            best_score = score
            best_voice_id = voice_id or None

    return best_voice_id or (getattr(voices[0], "id", None) if voices else None)

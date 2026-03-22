from fastapi import APIRouter, HTTPException, Response

from app.schemas.tts import SpeechSynthesisRequest
from app.services import tts_service

router = APIRouter(tags=["tts"])


@router.post("/tts")
def synthesize_speech(payload: SpeechSynthesisRequest) -> Response:
    try:
        audio_bytes = tts_service.synthesize_speech_wav(payload)
    except tts_service.TTSConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except tts_service.TTSSynthesisError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return Response(
        content=audio_bytes,
        media_type="audio/wav",
        headers={"Cache-Control": "no-store"},
    )

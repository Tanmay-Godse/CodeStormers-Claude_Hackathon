import json
import re
from typing import Any

from pydantic import ValidationError

from app.core.config import settings
from app.schemas.analyze import AnalyzeFrameRequest, SafetyGateDraft, SafetyGateResult
from app.schemas.procedure import ProcedureDefinition, ProcedureStage
from app.services.ai_client import AIRequestError, AIResponseError, send_json_message

CLINICAL_SCENE_PATTERN = re.compile(
    r"\b(patient|operating room|hospital|bedside|clinic|ward|incision|bleeding|surgery|wound|tissue)\b",
    re.IGNORECASE,
)
CLINICAL_EVIDENCE_PATTERN = re.compile(
    r"\b(hospital|bedside|clinic|ward|operating room|incision|bleeding|surgery|wound|tissue|sterile drape|medical monitor|clinical environment)\b",
    re.IGNORECASE,
)
NONCLINICAL_PERSON_PATTERN = re.compile(
    r"\b(person|human|face|upper body|body|hand|student|learner|bystander|casual indoor|home|living room|couch)\b",
    re.IGNORECASE,
)
SAFETY_GATE_MAX_RESPONSE_TOKENS = 220


def evaluate_safety_gate(
    *,
    payload: AnalyzeFrameRequest,
    procedure: ProcedureDefinition,
    stage: ProcedureStage,
) -> SafetyGateResult:
    practice_surface = (payload.practice_surface or procedure.practice_surface).strip()

    if not payload.simulation_confirmation:
        return SafetyGateResult(
            status="blocked",
            confidence=1.0,
            reason="Simulation-only confirmation is required before any analysis can run.",
            refusal_message=(
                "Analysis was blocked because this product only supports simulation practice. "
                f"Confirm that the image shows {practice_surface} before retrying."
            ),
        )

    text_signal = payload.student_question or ""
    if CLINICAL_SCENE_PATTERN.search(text_signal):
        return SafetyGateResult(
            status="blocked",
            confidence=0.95,
            reason="The request text suggests a real-patient or live-clinical context.",
            refusal_message=(
                "Analysis was blocked because the request appears related to a real patient or clinical scene. "
                "Use the trainer only for simulation images captured on a practice surface."
            ),
        )

    fast_clear_result = _build_fast_simulation_clear_result(
        payload=payload,
        procedure=procedure,
        stage=stage,
    )
    if fast_clear_result is not None:
        return fast_clear_result

    try:
        response_data = send_json_message(
            model=settings.ai_analysis_model,
            max_tokens=min(settings.ai_safety_max_tokens, SAFETY_GATE_MAX_RESPONSE_TOKENS),
            system_prompt=_build_safety_system_prompt(),
            user_content=_build_safety_user_content(
                payload=payload,
                procedure=procedure,
                stage=stage,
            ),
            output_schema=SafetyGateDraft.model_json_schema(),
        )
        draft = SafetyGateDraft.model_validate(response_data)
    except (AIRequestError, AIResponseError, ValidationError):
        setup_fallback = _build_setup_stage_fallback_result(
            payload=payload,
            procedure=procedure,
            stage=stage,
        )
        if setup_fallback is not None:
            return setup_fallback
        return SafetyGateResult(
            status="needs_human_review",
            confidence=0.0,
            reason="Automatic safety screening could not confirm a simulation-only practice scene.",
            refusal_message=(
                "Analysis was paused because the safety screen could not confidently verify that this image comes "
                "from a simulation setup. A faculty reviewer can inspect the session manually."
            ),
        )

    refusal_message = (draft.refusal_message or "").strip() or None
    normalized_result = _override_nonclinical_person_false_positive(draft)
    if normalized_result is not None:
        return normalized_result

    if draft.status == "blocked" and not refusal_message:
        refusal_message = (
            "Analysis was blocked because the image may depict a real patient or live clinical scene. "
            "Use only simulation images from any fruit or foam pad."
        )
    if draft.status == "needs_human_review" and not refusal_message:
        refusal_message = (
            "Analysis was paused because the safety screen could not confidently clear the image for autonomous coaching. "
            "A faculty reviewer can inspect the session manually."
        )

    return SafetyGateResult(
        status=draft.status,
        confidence=draft.confidence,
        reason=draft.reason.strip(),
        refusal_message=refusal_message,
    )


def _build_fast_simulation_clear_result(
    *,
    payload: AnalyzeFrameRequest,
    procedure: ProcedureDefinition,
    stage: ProcedureStage,
) -> SafetyGateResult | None:
    if not procedure.simulation_only or not payload.image_base64:
        return None

    practice_surface = (payload.practice_surface or procedure.practice_surface).strip()
    surface_detail = (
        f" using the confirmed practice surface '{practice_surface}'."
        if practice_surface
        else "."
    )
    return SafetyGateResult(
        status="cleared",
        confidence=0.84 if stage.id == "setup" else 0.8,
        reason=(
            "The learner confirmed a simulation-only scene in a simulation-only procedure, "
            "and no clinical text indicators were detected, so the frame was cleared without "
            f"an extra safety-model pass{surface_detail}"
        ),
        refusal_message=None,
    )


def _build_safety_system_prompt() -> str:
    return (
        "You are a safety gate for a simulation-only suturing coach. "
        "Your job is to block or escalate images that may show a real patient, living tissue, or a live clinical environment. "
        "A learner, instructor, face, hands, or upper body appearing in frame is allowed by itself and must not be treated as a block reason. "
        "A casual home, classroom, or practice environment is also allowed by itself. "
        "Only block when there is evidence of a real patient, exposed living tissue, a live wound, or a real clinical environment. "
        "Only clear images that confidently appear to be simulation practice on an orange, banana, foam pad, bench model, or other inert training surface. "
        "If the scene is non-clinical but the practice surface or tools are missing, occluded, or not yet ready, still return 'cleared' and let the main analyzer mark the frame unclear or retry. "
        "If you are unsure whether the scene is clinical, use 'needs_human_review'."
    )


def _build_safety_user_content(
    *,
    payload: AnalyzeFrameRequest,
    procedure: ProcedureDefinition,
    stage: ProcedureStage,
) -> list[dict[str, Any]]:
    practice_surface = (payload.practice_surface or procedure.practice_surface).strip()

    safety_context = {
        "procedure_title": procedure.title,
        "stage_title": stage.title,
        "practice_surface": practice_surface,
        "student_question": payload.student_question or "",
        "allowed_scene_examples": [
            "orange practice surface",
            "banana peel practice surface",
            "foam pad or bench model",
        ],
        "blocked_scene_examples": [
            "real patient skin or tissue",
            "operating room",
            "bedside clinical environment",
            "live wound or incision",
        ],
        "allowed_people_examples": [
            "student face visible in frame",
            "learner hands holding the practice surface",
            "casual indoor or home practice setup with a learner present",
        ],
    }

    return [
        {
            "type": "text",
            "text": (
                "Classify whether this scene is safe for simulation-only coaching.\n\n"
                f"{json.dumps(safety_context, indent=2)}"
            ),
        },
        {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/jpeg",
                "data": payload.image_base64,
            },
        },
    ]


def _override_nonclinical_person_false_positive(
    draft: SafetyGateDraft,
) -> SafetyGateResult | None:
    reason = draft.reason.strip()
    if not reason:
        return None

    if draft.status == "cleared":
        return None

    if not NONCLINICAL_PERSON_PATTERN.search(reason):
        return None

    if CLINICAL_EVIDENCE_PATTERN.search(reason):
        return None

    return SafetyGateResult(
        status="cleared",
        confidence=max(0.55, min(draft.confidence, 0.8)),
        reason=(
            "A learner or bystander being visible in a non-clinical scene is allowed for simulation practice. "
            "No real-patient or live-clinical indicators were detected, so the frame was passed to the main analyzer."
        ),
        refusal_message=None,
    )


def _build_setup_stage_fallback_result(
    *,
    payload: AnalyzeFrameRequest,
    procedure: ProcedureDefinition,
    stage: ProcedureStage,
) -> SafetyGateResult | None:
    if stage.id != "setup" or not payload.simulation_confirmation:
        return None

    practice_surface = (payload.practice_surface or procedure.practice_surface).strip()
    if not practice_surface:
        return None

    return SafetyGateResult(
        status="cleared",
        confidence=0.58,
        reason=(
            "The setup stage was allowed to continue because the learner confirmed a simulation-only practice scene "
            "and the safety classifier could not finish. The main analyzer will still verify that a practice surface is visible."
        ),
        refusal_message=None,
    )

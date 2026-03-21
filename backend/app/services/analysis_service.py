import json
from typing import Any

from pydantic import ValidationError

from app.core.config import settings
from app.schemas.analyze import AnalysisDraft, AnalyzeFrameRequest, AnalyzeFrameResponse
from app.schemas.procedure import ProcedureDefinition, ProcedureStage
from app.services.ai_client import AIResponseError, send_json_message
from app.services.procedure_loader import load_procedure, load_stage
from app.services.scoring_service import (
    InvalidOverlayTargetError,
    compute_score_delta,
    validate_overlay_target_ids,
)


def analyze_frame_payload(payload: AnalyzeFrameRequest) -> AnalyzeFrameResponse:
    procedure = load_procedure(payload.procedure_id)
    stage = load_stage(procedure, payload.stage_id)

    analysis_draft = request_stage_analysis(
        payload=payload,
        procedure=procedure,
        stage=stage,
    )
    try:
        overlay_target_ids = validate_overlay_target_ids(
            stage,
            analysis_draft.overlay_target_ids,
        )
    except InvalidOverlayTargetError as exc:
        raise AIResponseError(str(exc)) from exc

    visible_observations = _normalize_visible_observations(
        stage,
        analysis_draft.visible_observations,
    )
    coaching_message = analysis_draft.coaching_message.strip()
    next_action = analysis_draft.next_action.strip()

    return AnalyzeFrameResponse(
        step_status=analysis_draft.step_status,
        confidence=analysis_draft.confidence,
        visible_observations=visible_observations,
        issues=analysis_draft.issues,
        coaching_message=coaching_message
        or f"Reset for the {stage.title.lower()} stage and keep the main objective visible.",
        next_action=next_action
        or f"Capture one more clear frame that shows {stage.objective.lower()}",
        overlay_target_ids=overlay_target_ids,
        score_delta=compute_score_delta(
            stage=stage,
            step_status=analysis_draft.step_status,
            issues=analysis_draft.issues,
        ),
    )


def request_stage_analysis(
    *,
    payload: AnalyzeFrameRequest,
    procedure: ProcedureDefinition,
    stage: ProcedureStage,
) -> AnalysisDraft:
    response_data = send_json_message(
        model=settings.ai_analysis_model,
        max_tokens=settings.ai_analysis_max_tokens,
        system_prompt=_build_analysis_system_prompt(),
        user_content=_build_analysis_user_content(
            payload=payload,
            procedure=procedure,
            stage=stage,
        ),
        output_schema=AnalysisDraft.model_json_schema(),
    )

    try:
        draft = AnalysisDraft.model_validate(response_data)
    except ValidationError as exc:
        raise AIResponseError("The model server returned an invalid analysis payload.") from exc

    if len(draft.issues) > 3:
        raise AIResponseError("The model server returned too many issues for a single stage.")

    return draft


def _build_analysis_system_prompt() -> str:
    return (
        "You are an AI clinical skills coach reviewing a simulation-only suturing practice frame. "
        "The learner is practicing a simple interrupted suture on a banana, orange, or foam pad. "
        "Never imply diagnosis, patient care, or real-world medical clearance. "
        "Base every judgment only on what is visible in the frame and the provided stage rubric. "
        "Use 'pass' only when the current stage objective is visibly met. "
        "Use 'retry' when the frame is clear enough to judge but the technique needs correction. "
        "Use 'unclear' when framing, blur, occlusion, or missing tools make the step hard to judge. "
        "Use 'unsafe' when the learner appears to be using instruments or tension in a clearly unsafe way even for simulation. "
        "Only return overlay_target_ids from the allowed list. "
        "Write concise, specific coaching in a supportive tone."
    )


def _build_analysis_user_content(
    *,
    payload: AnalyzeFrameRequest,
    procedure: ProcedureDefinition,
    stage: ProcedureStage,
) -> list[dict[str, Any]]:
    allowed_targets = [
        {
            "id": target.id,
            "label": target.label,
            "description": target.description,
        }
        for target in procedure.named_overlay_targets
        if target.id in stage.overlay_targets
    ]

    stage_context = {
        "procedure_title": procedure.title,
        "practice_surface": procedure.practice_surface,
        "simulation_only": procedure.simulation_only,
        "skill_level": payload.skill_level,
        "stage": {
            "id": stage.id,
            "title": stage.title,
            "objective": stage.objective,
            "visible_checks": stage.visible_checks,
            "common_errors": stage.common_errors,
            "score_weight": stage.score_weight,
        },
        "allowed_overlay_targets": allowed_targets,
        "student_question": payload.student_question or "",
        "response_rules": {
            "visible_observations": "Return 2 to 4 short observations grounded in the frame.",
            "issues": "Return 0 to 3 issues. Each issue needs a code, severity, and message.",
            "overlay_target_ids": "Return only allowed ids that match the most helpful on-screen coaching targets.",
            "coaching_message": "Return one short coaching paragraph for the learner's next attempt.",
            "next_action": "Return one clear next action sentence.",
        },
    }

    return [
        {
            "type": "text",
            "text": (
                "Review this suturing practice frame and return JSON that follows the schema.\n\n"
                f"{json.dumps(stage_context, indent=2)}"
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


def _clean_lines(lines: list[str]) -> list[str]:
    cleaned: list[str] = []
    for line in lines:
        candidate = line.strip()
        if candidate and candidate not in cleaned:
            cleaned.append(candidate)
    return cleaned


def _normalize_visible_observations(
    stage: ProcedureStage,
    lines: list[str],
) -> list[str]:
    cleaned = _clean_lines(lines)[:4]
    fallback_lines = [
        f"Review the {stage.title.lower()} stage with focus on {check}."
        for check in stage.visible_checks
    ]

    for fallback_line in fallback_lines:
        if len(cleaned) >= 2:
            break
        if fallback_line not in cleaned:
            cleaned.append(fallback_line)

    return cleaned[:4]

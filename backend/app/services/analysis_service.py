import json
from typing import Any

from pydantic import ValidationError

from app.core.config import settings
from app.schemas.analyze import (
    AnalysisDraft,
    AnalyzeFrameRequest,
    AnalyzeFrameResponse,
    Issue,
)
from app.schemas.procedure import ProcedureDefinition, ProcedureStage
from app.services.ai_client import AIResponseError, send_json_message
from app.services.procedure_loader import load_procedure, load_stage
from app.services import review_queue_service, safety_service
from app.services.scoring_service import (
    InvalidOverlayTargetError,
    compute_score_delta,
    validate_overlay_target_ids,
)

ANALYSIS_RESPONSE_MAX_TOKENS = 360


def analyze_frame_payload(payload: AnalyzeFrameRequest) -> AnalyzeFrameResponse:
    procedure = load_procedure(payload.procedure_id)
    stage = load_stage(procedure, payload.stage_id)
    safety_gate = safety_service.evaluate_safety_gate(
        payload=payload,
        procedure=procedure,
        stage=stage,
    )

    if safety_gate.status != "cleared":
        review_case = _create_review_case_for_blocked_analysis(
            payload=payload,
            stage=stage,
            safety_gate=safety_gate,
        )
        return _build_blocked_analysis_response(
            stage=stage,
            safety_gate=safety_gate,
            review_case_id=review_case.id if review_case else None,
        )

    analysis_draft = request_stage_analysis(
        payload=payload,
        procedure=procedure,
        stage=stage,
    )
    analysis_draft = _apply_setup_stage_acceptance(
        draft=analysis_draft,
        payload=payload,
        procedure=procedure,
        stage=stage,
        safety_gate=safety_gate,
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
    grading_decision, grading_reason = _determine_grading_decision(
        draft=analysis_draft,
    )
    requires_human_review, human_review_reason, review_source = _determine_human_review(
        draft=analysis_draft,
    )
    review_case = None
    if requires_human_review:
        review_case = review_queue_service.create_review_case(
            source=review_source,
            session_id=payload.session_id,
            procedure_id=payload.procedure_id,
            stage_id=payload.stage_id,
            skill_level=payload.skill_level,
            student_name=payload.student_name,
            student_username=payload.student_username,
            trigger_reason=human_review_reason,
            analysis_blocked=False,
            initial_step_status=analysis_draft.step_status,
            confidence=analysis_draft.confidence,
            coaching_message=coaching_message,
            safety_gate=safety_gate,
        )

    return AnalyzeFrameResponse(
        analysis_mode="coaching",
        step_status=analysis_draft.step_status,
        grading_decision=grading_decision,
        grading_reason=grading_reason,
        confidence=analysis_draft.confidence,
        visible_observations=visible_observations,
        issues=analysis_draft.issues,
        coaching_message=coaching_message
        or f"Reset for the {stage.title.lower()} stage and keep the main objective visible.",
        next_action=next_action
        or f"Capture one more clear frame that shows {stage.objective.lower()}",
        overlay_target_ids=overlay_target_ids,
        score_delta=(
            compute_score_delta(
                stage=stage,
                step_status=analysis_draft.step_status,
                issues=analysis_draft.issues,
            )
            if grading_decision == "graded"
            else 0
        ),
        safety_gate=safety_gate,
        requires_human_review=requires_human_review,
        human_review_reason=human_review_reason if requires_human_review else None,
        review_case_id=review_case.id if review_case else None,
    )


def request_stage_analysis(
    *,
    payload: AnalyzeFrameRequest,
    procedure: ProcedureDefinition,
    stage: ProcedureStage,
) -> AnalysisDraft:
    response_data = send_json_message(
        model=settings.ai_analysis_model,
        max_tokens=min(settings.ai_analysis_max_tokens, ANALYSIS_RESPONSE_MAX_TOKENS),
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
        "The learner is practicing a simple interrupted suture on any fruit or foam pad. "
        "Never imply diagnosis, patient care, or real-world medical clearance. "
        "Return every learner-facing field in the requested feedback_language. "
        "Base every judgment only on what is visible in the frame and the provided stage rubric. "
        "A learner's face, hands, upper body, or another person being visible in the frame is allowed and is not a safety violation by itself. "
        "Use 'pass' only when the current stage objective is visibly met. "
        "Use 'retry' when the frame is clear enough to judge but the technique needs correction. "
        "Use 'unclear' when framing, blur, occlusion, or missing tools make the step hard to judge. "
        "Use 'unsafe' only when the learner appears to be using instruments or tension in a clearly unsafe way even for simulation. "
        "If a person is visible but the practice surface or instruments are not visible enough to judge the stage, use 'unclear' rather than 'unsafe'. "
        "For the setup stage, a clearly visible orange, banana, foam pad, bench model, or other inert practice surface is enough to accept the setup and mark the stage as pass unless the frame is truly unclear or clearly unsafe. "
        "Only return overlay_target_ids from the allowed list. "
        "Write concise, specific coaching in a supportive tone. "
        "When equity_mode is enabled, prefer plain language and short instructions that work well on low-resource devices."
    )


def _build_analysis_user_content(
    *,
    payload: AnalyzeFrameRequest,
    procedure: ProcedureDefinition,
    stage: ProcedureStage,
) -> list[dict[str, Any]]:
    practice_surface = (payload.practice_surface or procedure.practice_surface).strip()

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
        "practice_surface": practice_surface,
        "simulation_only": procedure.simulation_only,
        "skill_level": payload.skill_level,
        "feedback_language": payload.feedback_language,
        "equity_mode": payload.equity_mode.model_dump(mode="json"),
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
            "visible_observations": "Return 1 to 3 short observations grounded in the frame.",
            "issues": "Return 0 to 2 issues. Each issue needs a code, severity, and message.",
            "overlay_target_ids": "Return only allowed ids that match the most helpful on-screen coaching targets.",
            "coaching_message": "Return one short spoken-friendly coaching message for the learner's next attempt. Keep it to at most 2 brief sentences.",
            "next_action": "Return one short clear next action sentence.",
            "student_question_usage": "If student_question is provided, treat it as the learner's instruction for what to emphasize in coaching_message and next_action, but do not invent visual facts that are not in the frame.",
        },
    }

    if stage.id == "setup":
        stage_context["setup_acceptance_rule"] = (
            "If the frame clearly shows an approved inert practice surface such as an orange, banana, foam pad, or bench model, "
            "treat the setup as pass even if the framing is not perfect yet. Only use retry when the setup is visible but needs a small fix, "
            "and use unclear only when the surface or main tools cannot be judged reliably."
        )

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


def _apply_setup_stage_acceptance(
    *,
    draft: AnalysisDraft,
    payload: AnalyzeFrameRequest,
    procedure: ProcedureDefinition,
    stage: ProcedureStage,
    safety_gate,
) -> AnalysisDraft:
    if (
        stage.id != "setup"
        or safety_gate.status != "cleared"
        or not payload.simulation_confirmation
        or draft.step_status == "unsafe"
    ):
        return draft

    if draft.step_status == "pass":
        return draft

    observations = _clean_lines(draft.visible_observations)
    ready_note = (
        f"Approved practice surface detected for setup: {(payload.practice_surface or procedure.practice_surface).strip()}."
    )
    if ready_note not in observations:
        observations.insert(0, ready_note)

    suggested_target = stage.overlay_targets[:1]

    return draft.model_copy(
        update={
            "step_status": "pass",
            "confidence": max(draft.confidence, 0.92),
            "visible_observations": observations[:4],
            "issues": [],
            "coaching_message": (
                "Setup looks ready. Keep the practice surface centered and move on to the grip stage."
            ),
            "next_action": "Proceed to Grip and capture the next coached rep when you are ready.",
            "overlay_target_ids": suggested_target,
        }
    )


def _determine_human_review(
    *,
    draft: AnalysisDraft,
) -> tuple[bool, str, str]:
    if draft.step_status in {"unclear", "unsafe"}:
        return (
            True,
            "The AI marked this attempt as unclear or unsafe, so a faculty reviewer should validate the coaching outcome.",
            "quality_flag",
        )

    if draft.confidence < settings.human_review_confidence_threshold:
        return (
            True,
            "The model confidence fell below the human-review threshold, so the attempt was escalated for supervised validation.",
            "confidence_flag",
        )

    if any(issue.severity == "high" for issue in draft.issues):
        return (
            True,
            "A high-severity issue was detected, so the attempt was escalated for faculty review.",
            "quality_flag",
        )

    return False, "", "quality_flag"


def _determine_grading_decision(
    *,
    draft: AnalysisDraft,
) -> tuple[str, str | None]:
    if draft.step_status == "unclear":
        return (
            "not_graded",
            "Not graded - retake required because the frame was too ambiguous to score reliably.",
        )

    if draft.confidence < settings.grading_confidence_threshold:
        return (
            "not_graded",
            "Not graded - retake required because the confidence was too low for a trustworthy score.",
        )

    return "graded", None


def _create_review_case_for_blocked_analysis(
    *,
    payload: AnalyzeFrameRequest,
    stage: ProcedureStage,
    safety_gate,
):
    if not payload.session_id:
        return None

    if (
        safety_gate.status == "blocked"
        and "confirmation" in safety_gate.reason.lower()
    ):
        return None

    return review_queue_service.create_review_case(
        source="safety_gate",
        session_id=payload.session_id,
        procedure_id=payload.procedure_id,
        stage_id=stage.id,
        skill_level=payload.skill_level,
        student_name=payload.student_name,
        student_username=payload.student_username,
        trigger_reason=safety_gate.reason,
        analysis_blocked=True,
        initial_step_status="unsafe",
        confidence=safety_gate.confidence,
        coaching_message=safety_gate.refusal_message,
        safety_gate=safety_gate,
    )


def _build_blocked_analysis_response(
    *,
    stage: ProcedureStage,
    safety_gate,
    review_case_id: str | None,
) -> AnalyzeFrameResponse:
    refusal_message = (
        safety_gate.refusal_message
        or "Analysis was blocked because the image did not clear the simulation-only safety gate."
    )
    next_action = (
        "Use a clearly simulated setup on any fruit or foam pad, then retry once the image is safe to review."
    )
    return AnalyzeFrameResponse(
        analysis_mode="blocked",
        step_status="unsafe",
        grading_decision="not_graded",
        grading_reason="Not graded - retake required because the safety gate blocked autonomous coaching.",
        confidence=safety_gate.confidence,
        visible_observations=[
            f"{stage.title} analysis was paused by the safety gate.",
            safety_gate.reason,
        ],
        issues=[
            Issue(
                code="simulation_only_gate",
                severity="high",
                message=safety_gate.reason,
            )
        ],
        coaching_message=refusal_message,
        next_action=next_action,
        overlay_target_ids=[],
        score_delta=0,
        safety_gate=safety_gate,
        requires_human_review=safety_gate.status == "needs_human_review"
        or review_case_id is not None,
        human_review_reason=(
            "A human reviewer has been asked to inspect this blocked session."
            if review_case_id
            else safety_gate.reason
        ),
        review_case_id=review_case_id,
    )

import json
from typing import Any

from pydantic import ValidationError

from app.core.config import settings
from app.schemas.analyze import AnalyzeFrameRequest
from app.schemas.coach import CoachChatDraft, CoachChatRequest, CoachChatResponse
from app.schemas.procedure import ProcedureDefinition, ProcedureStage
from app.services import safety_service
from app.services.ai_client import AIRequestError, AIResponseError, send_json_message
from app.services.procedure_loader import load_procedure, load_stage


def generate_coach_turn(payload: CoachChatRequest) -> CoachChatResponse:
    procedure = load_procedure(payload.procedure_id)
    stage = load_stage(procedure, payload.stage_id)
    fallback_response = _build_fallback_response(
        payload=payload,
        procedure=procedure,
        stage=stage,
    )

    safety_gate = None
    if payload.image_base64 and payload.simulation_confirmation:
        safety_gate = safety_service.evaluate_safety_gate(
            payload=_to_safety_payload(payload),
            procedure=procedure,
            stage=stage,
        )
        if safety_gate.status != "cleared":
            return CoachChatResponse(
                conversation_stage="blocked",
                coach_message=(
                    safety_gate.refusal_message
                    or "I can help once the trainer confirms a safe simulation-only setup."
                ),
                plan_summary="Confirm a simulation-only practice surface before image-guided coaching starts.",
                suggested_next_step="Confirm the simulation setup, then send another message so we can plan the session.",
                camera_observations=[],
                stage_focus=[stage.title],
            )

    try:
        response_data = send_json_message(
            model=settings.ai_coach_model,
            max_tokens=settings.ai_coach_max_tokens,
            system_prompt=_build_coach_system_prompt(),
            user_content=_build_coach_user_content(
                payload=payload,
                procedure=procedure,
                stage=stage,
                include_image=bool(payload.image_base64 and payload.simulation_confirmation),
            ),
            output_schema=CoachChatDraft.model_json_schema(),
        )
        draft = CoachChatDraft.model_validate(response_data)
    except AIRequestError as exc:
        if payload.audio_base64 and _is_audio_support_error(exc):
            return CoachChatResponse(
                conversation_stage="blocked",
                coach_message=(
                    "Voice chat is not available yet because the local vLLM server was started without audio support."
                ),
                plan_summary=(
                    "Use typed coach replies for now, or restart the model server with audio support enabled."
                ),
                suggested_next_step=(
                    "Install the audio extras for vLLM, restart the model server, then try another voice reply."
                ),
                camera_observations=[],
                stage_focus=[stage.title],
                learner_goal_summary="",
            )
        return fallback_response
    except (AIResponseError, ValidationError):
        return fallback_response

    return CoachChatResponse(
        conversation_stage=draft.conversation_stage,
        coach_message=draft.coach_message.strip() or fallback_response.coach_message,
        plan_summary=draft.plan_summary.strip() or fallback_response.plan_summary,
        suggested_next_step=(
            draft.suggested_next_step.strip() or fallback_response.suggested_next_step
        ),
        camera_observations=_clean_lines(draft.camera_observations)[:3],
        stage_focus=_clean_lines(draft.stage_focus)[:3] or fallback_response.stage_focus,
        learner_goal_summary=(
            draft.learner_goal_summary.strip()
            or fallback_response.learner_goal_summary
        ),
    )


def _build_coach_system_prompt() -> str:
    return (
        "You are a respectful AI voice coach for a simulation-only suturing trainer. "
        "Speak directly to the learner in a calm, supportive tone. "
        "The coach should feel attentive and specific, not generic. "
        "Avoid canned encouragement and avoid repeating the same setup script on every turn. "
        "Use the current stage objective and visible checks to make the coaching turn concrete. "
        "If coach_mode is hands_free_startup, greet the learner briefly, mention the current stage by name, "
        "and tell them exactly what to show or stabilize next. "
        "If coach_mode is hands_free_observing, do not ask broad planning questions. Give one or two short, stage-specific cues grounded in the current frame. "
        "If the learner has not shared a goal yet and no frame is available, ask at most one short, stage-specific question. "
        "If an audio clip is provided, listen to it carefully, infer the learner's goal from the audio, "
        "and populate learner_goal_summary with a short phrase in the requested feedback_language. "
        "If the learner has shared a goal, summarize a short plan, keep it practical, and guide them stage by stage. "
        "If an image is provided, mention only visible setup or technique observations from that frame. "
        "If no image is provided, do not claim any object or surface is visible. "
        "Do not invent camera observations. Return an empty camera_observations list when the frame is unavailable or unclear. "
        "Never imply real-patient care, diagnosis, or medical clearance. "
        "Keep coach_message concise enough to be spoken aloud comfortably. "
        "Return every learner-facing field in the requested feedback_language."
    )


def _build_coach_user_content(
    *,
    payload: CoachChatRequest,
    procedure: ProcedureDefinition,
    stage: ProcedureStage,
    include_image: bool,
) -> list[dict[str, Any]]:
    conversation = [
        {"role": message.role, "content": message.content.strip()}
        for message in payload.messages
        if message.content.strip()
    ]
    coach_mode = _determine_coach_mode(payload)
    context = {
        "procedure_title": procedure.title,
        "practice_surface": procedure.practice_surface,
        "simulation_only": procedure.simulation_only,
        "coach_mode": coach_mode,
        "camera_ready": bool(payload.image_base64),
        "stage": {
            "id": stage.id,
            "title": stage.title,
            "objective": stage.objective,
            "visible_checks": stage.visible_checks,
            "common_errors": stage.common_errors,
        },
        "skill_level": payload.skill_level,
        "feedback_language": payload.feedback_language,
        "student_name": payload.student_name or "",
        "simulation_confirmation": payload.simulation_confirmation,
        "equity_mode": payload.equity_mode.model_dump(mode="json"),
        "conversation_history": conversation,
        "response_rules": {
            "coach_message": "2 to 4 short sentences that can be spoken aloud naturally.",
            "plan_summary": "1 short summary sentence of the agreed learning plan.",
            "suggested_next_step": "1 clear next action for the learner right now.",
            "camera_observations": "0 to 3 short observations grounded in the visible frame.",
            "stage_focus": "1 to 3 short focus points for the current stage.",
            "learner_goal_summary": "A short phrase capturing the learner's stated goal from text or audio, or an empty string if still unclear.",
        },
    }

    user_content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                "Generate the next conversational coaching turn for this suturing practice session.\n\n"
                f"{json.dumps(context, indent=2)}"
            ),
        }
    ]

    if include_image and payload.image_base64:
        user_content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/jpeg",
                    "data": payload.image_base64,
                },
            }
        )

    if payload.audio_base64:
        user_content.append(
            {
                "type": "audio",
                "source": {
                    "type": "base64",
                    "media_type": f"audio/{payload.audio_format or 'wav'}",
                    "format": payload.audio_format or "wav",
                    "data": payload.audio_base64,
                },
            }
        )

    return user_content


def _build_fallback_response(
    *,
    payload: CoachChatRequest,
    procedure: ProcedureDefinition,
    stage: ProcedureStage,
) -> CoachChatResponse:
    learner_name = (payload.student_name or "there").strip()
    last_user_message = next(
        (message.content.strip() for message in reversed(payload.messages) if message.role == "user"),
        "",
    )

    if payload.audio_base64 and not last_user_message:
        return CoachChatResponse(
            conversation_stage="goal_setting",
            coach_message=(
                f"Hello {learner_name}. I received your voice note, but I need one clearer practice goal before we start. "
                "Try another short voice reply or type the skill you want to improve today."
            ),
            plan_summary=(
                f"We will confirm your learning goal, then work through the {stage.title.lower()} stage step by step."
            ),
            suggested_next_step="Send a short voice reply about what you want to improve, or type your goal in one sentence.",
            camera_observations=[],
            stage_focus=[stage.title, stage.objective],
            learner_goal_summary="",
        )

    if payload.image_base64 and not last_user_message:
        first_check = stage.visible_checks[0] if stage.visible_checks else stage.objective
        second_check = stage.visible_checks[1] if len(stage.visible_checks) > 1 else stage.title
        return CoachChatResponse(
            conversation_stage="guiding",
            coach_message=(
                f"Camera is live, {learner_name}. We are in the {stage.title.lower()} stage. "
                f"Keep the frame steady and show {_normalize_focus_text(first_check)}. "
                f"Next, make {_normalize_focus_text(second_check)} easy to see so I can guide the stage hands-free."
            ),
            plan_summary=(
                f"Hands-free focus: stabilize the {stage.title.lower()} stage and make the key visual checks easy to inspect."
            ),
            suggested_next_step=(
                f"Hold the field steady and clearly show {_normalize_focus_text(first_check)} in the camera view."
            ),
            camera_observations=[],
            stage_focus=_clean_lines(stage.visible_checks)[:3] or [stage.title, stage.objective],
            learner_goal_summary="",
        )

    if not last_user_message:
        first_check = stage.visible_checks[0] if stage.visible_checks else stage.title
        return CoachChatResponse(
            conversation_stage="goal_setting",
            coach_message=(
                f"Camera is live, {learner_name}. We are starting with the {stage.title.lower()} stage. "
                "I will guide this stage hands-free. "
                f"Confirm the simulation setup, then show {_normalize_focus_text(first_check)} so I can coach the next cue in real time."
            ),
            plan_summary=(
                f"Start by confirming the simulation setup, then we will coach the {stage.title.lower()} stage using the live camera view."
            ),
            suggested_next_step=(
                f"Confirm the simulation surface, then position the camera so I can inspect {_normalize_focus_text(first_check)}."
            ),
            camera_observations=[],
            stage_focus=_clean_lines(stage.visible_checks)[:3] or [stage.title, stage.objective],
            learner_goal_summary="",
        )

    if not payload.simulation_confirmation:
        return CoachChatResponse(
            conversation_stage="planning",
            coach_message=(
                f"Thanks for sharing that you want to focus on {last_user_message}. "
                f"We can build the session around the {stage.title.lower()} stage. "
                "Confirm the simulation-only setup when you are ready, and then I will guide the next step."
            ),
            plan_summary=(
                f"Focus on {last_user_message} while using the {stage.title.lower()} stage as the starting checkpoint."
            ),
            suggested_next_step="Confirm the simulation setup, then capture a clear frame so I can guide the stage with you.",
            camera_observations=[],
            stage_focus=[stage.title, stage.objective],
            learner_goal_summary=last_user_message,
        )

    return CoachChatResponse(
        conversation_stage="guiding",
        coach_message=(
            f"Thanks. We will focus on {last_user_message}. "
            f"Start by keeping the practice surface steady and visible for the {stage.title.lower()} stage. "
            "Once the frame is clear, check the step and I will help refine the next attempt."
        ),
        plan_summary=f"Practice goal: {last_user_message}. Start with the {stage.title.lower()} stage.",
        suggested_next_step=(
            f"Center the practice surface, prepare for {stage.title.lower()}, and capture the next frame."
        ),
        camera_observations=(
            ["A live frame is available for image-guided coaching."]
            if payload.image_base64
            else []
        ),
        stage_focus=[stage.title, stage.objective],
        learner_goal_summary=last_user_message,
    )


def _to_safety_payload(payload: CoachChatRequest) -> AnalyzeFrameRequest:
    last_user_message = next(
        (message.content.strip() for message in reversed(payload.messages) if message.role == "user"),
        "",
    )
    return AnalyzeFrameRequest(
        procedure_id=payload.procedure_id,
        stage_id=payload.stage_id,
        skill_level=payload.skill_level,
        image_base64=payload.image_base64 or "missing-frame",
        student_question=last_user_message or None,
        simulation_confirmation=payload.simulation_confirmation,
        session_id=payload.session_id,
        student_name=payload.student_name,
        feedback_language=payload.feedback_language,
        equity_mode=payload.equity_mode,
    )


def _clean_lines(lines: list[str]) -> list[str]:
    cleaned: list[str] = []
    for line in lines:
        candidate = line.strip()
        if candidate and candidate not in cleaned:
            cleaned.append(candidate)
    return cleaned


def _is_audio_support_error(error: AIRequestError) -> bool:
    return "vllm[audio]" in str(error).lower() or "audio support" in str(error).lower()


def _determine_coach_mode(payload: CoachChatRequest) -> str:
    if payload.image_base64 and not payload.messages:
        return "hands_free_observing"
    if not payload.messages:
        return "hands_free_startup"
    return "conversation"


def _normalize_focus_text(text: str) -> str:
    normalized = text.strip().rstrip(".").lower()
    if normalized.endswith(" visible"):
        normalized = normalized[: -len(" visible")].strip()
    if normalized and not normalized.startswith(("the ", "a ", "an ")):
        normalized = f"the {normalized}"
    return normalized

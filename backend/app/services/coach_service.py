import json
from typing import Any

from pydantic import ValidationError

from app.core.config import settings
from app.schemas.analyze import AnalyzeFrameRequest
from app.schemas.coach import (
    CoachChatDraft,
    CoachChatMessage,
    CoachChatRequest,
    CoachChatResponse,
)
from app.schemas.procedure import ProcedureDefinition, ProcedureStage
from app.services import safety_service, transcription_service
from app.services.ai_client import (
    AIConfigurationError,
    AIRequestError,
    AIResponseError,
    send_json_message,
)
from app.services.procedure_loader import load_procedure, load_stage

COACH_RESPONSE_MAX_TOKENS = 280
COACH_HISTORY_WINDOW = 8


def generate_coach_turn(payload: CoachChatRequest) -> CoachChatResponse:
    procedure = load_procedure(payload.procedure_id)
    stage = load_stage(procedure, payload.stage_id)
    learner_transcript = ""
    try:
        normalized_payload, learner_transcript = _normalize_payload_with_transcript(
            payload
        )
    except (AIConfigurationError, AIRequestError, AIResponseError) as exc:
        if payload.audio_base64:
            return _build_transcription_blocked_response(
                payload=payload,
                stage=stage,
                reason=str(exc),
            )
        raise

    fallback_response = _build_fallback_response(
        payload=normalized_payload,
        procedure=procedure,
        stage=stage,
    )

    safety_gate = None
    if normalized_payload.image_base64 and normalized_payload.simulation_confirmation:
        safety_gate = safety_service.evaluate_safety_gate(
            payload=_to_safety_payload(normalized_payload),
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
                learner_transcript=learner_transcript,
            )

    try:
        response_data = send_json_message(
            model=settings.ai_coach_model,
            max_tokens=min(settings.ai_coach_max_tokens, COACH_RESPONSE_MAX_TOKENS),
            system_prompt=_build_coach_system_prompt(),
            user_content=_build_coach_user_content(
                payload=normalized_payload,
                procedure=procedure,
                stage=stage,
                include_image=bool(
                    normalized_payload.image_base64
                    and normalized_payload.simulation_confirmation
                ),
            ),
            output_schema=CoachChatDraft.model_json_schema(),
        )
        draft = CoachChatDraft.model_validate(response_data)
    except AIRequestError:
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
        learner_transcript=learner_transcript,
    )


def _normalize_payload_with_transcript(
    payload: CoachChatRequest,
) -> tuple[CoachChatRequest, str]:
    if not payload.audio_base64:
        return payload, ""

    transcript = transcription_service.transcribe_audio_clip(
        audio_base64=payload.audio_base64,
        audio_format=payload.audio_format,
    ).strip()

    if not transcript:
        raise AIResponseError(
            "The transcription endpoint returned an empty learner transcript."
        )

    next_messages = [
        *payload.messages,
        CoachChatMessage(role="user", content=transcript),
    ][-COACH_HISTORY_WINDOW:]

    normalized_payload = CoachChatRequest.model_validate(
        {
            **payload.model_dump(mode="json"),
            "audio_base64": None,
            "audio_format": None,
            "messages": [message.model_dump(mode="json") for message in next_messages],
        }
    )
    return normalized_payload, transcript


def _build_transcription_blocked_response(
    *,
    payload: CoachChatRequest,
    stage: ProcedureStage,
    reason: str,
) -> CoachChatResponse:
    learner_name = (payload.student_name or "there").strip()
    detail = reason.strip() or "The learner audio clip could not be turned into text."
    return CoachChatResponse(
        conversation_stage="blocked",
        coach_message=(
            f"Hello {learner_name}. I could not transcribe that voice reply clearly enough to continue hands-free. {detail}"
        ),
        plan_summary=(
            "Use learner voice through transcription first, or type the goal so the coach can keep guiding the stage."
        ),
        suggested_next_step=(
            "Try another short voice reply in a quieter setting, or type the learner goal in one sentence."
        ),
        camera_observations=[],
        stage_focus=[stage.title],
        learner_goal_summary="",
        learner_transcript="",
    )


def _build_coach_system_prompt() -> str:
    return (
        "You are a respectful AI voice coach for a simulation-only suturing trainer. "
        "Speak directly to the learner in a calm, supportive tone. "
        "The coach should feel like a skilled person standing beside the learner, attentive and specific, not generic. "
        "Avoid canned encouragement and avoid repeating the same setup script on every turn. "
        "If the latest turn already came from the assistant and there is no newer learner message, "
        "assume you are waiting for the learner rather than delivering another lecture. "
        "Do not restate the same correction verbatim on consecutive turns. "
        "If you need to speak again, give one brief check-in, one follow-up question, or one fresh cue. "
        "Use the current stage objective and visible checks to make the coaching turn concrete. "
        "When the learner has just spoken, answer that exact remark first in a natural sentence, then give one immediate next cue for the current stage. "
        "If a live frame is available, ground the reply in what the learner should show next in that frame so the exchange feels real-time. "
        "Do not sound like a report, debrief, or checklist reader. "
        "If coach_mode is hands_free_startup, greet the learner briefly, mention the current stage by name, "
        "and tell them exactly what to show or stabilize next. "
        "If coach_mode is hands_free_observing, do not ask broad planning questions. Give one or two short, stage-specific cues grounded in the current frame. "
        "If the learner asks a direct question, answer it clearly in one or two short sentences before returning to the current stage cue. "
        "If the learner has not shared a goal yet and no frame is available, ask at most one short, stage-specific question. "
        "If the learner's latest reply came from voice transcription, infer the learner's goal from that transcript "
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
    practice_surface = (payload.practice_surface or procedure.practice_surface).strip()
    learner_focus = (payload.learner_focus or "").strip()
    conversation = [
        {"role": message.role, "content": message.content.strip()}
        for message in payload.messages
        if message.content.strip()
    ]
    latest_user_message = next(
        (
            message["content"]
            for message in reversed(conversation)
            if message["role"] == "user"
        ),
        "",
    )
    latest_assistant_message = next(
        (
            message["content"]
            for message in reversed(conversation)
            if message["role"] == "assistant"
        ),
        "",
    )
    latest_turn_role = conversation[-1]["role"] if conversation else ""
    coach_mode = _determine_coach_mode(payload)
    latest_user_is_question = _looks_like_direct_question(latest_user_message)
    context = {
        "procedure_title": procedure.title,
        "practice_surface": practice_surface,
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
        "learner_focus": learner_focus,
        "conversation_history": conversation,
        "latest_turn_role": latest_turn_role,
        "latest_user_message": latest_user_message,
        "latest_user_is_question": latest_user_is_question,
        "latest_assistant_message": latest_assistant_message,
        "awaiting_new_learner_turn": bool(
            conversation and latest_turn_role == "assistant"
        ),
        "response_rules": {
            "coach_message": "2 to 4 short sentences that can be spoken aloud naturally.",
            "coach_message_flow": "If latest_user_message is present, acknowledge or answer it in the first sentence, then give one concrete stage cue for the next rep.",
            "plan_summary": "1 short summary sentence of the agreed learning plan.",
            "suggested_next_step": "1 clear next action for the learner right now.",
            "camera_observations": "0 to 3 short observations grounded in the visible frame.",
            "stage_focus": "1 to 3 short focus points for the current stage.",
            "learner_goal_summary": "A short phrase capturing the learner's stated goal from text or audio, or an empty string if still unclear.",
            "learner_focus_usage": "If learner_focus is provided, treat it as the learner's standing instruction unless a newer learner message overrides it.",
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
    learner_focus = (payload.learner_focus or "").strip()
    last_user_message = next(
        (
            message.content.strip()
            for message in reversed(payload.messages)
            if message.role == "user"
        ),
        "",
    )
    latest_user_is_question = _looks_like_direct_question(last_user_message)
    effective_learner_goal = last_user_message or learner_focus
    last_assistant_message = next(
        (
            message.content.strip()
            for message in reversed(payload.messages)
            if message.role == "assistant"
        ),
        "",
    )
    primary_focus = stage.visible_checks[0] if stage.visible_checks else stage.objective
    secondary_focus = (
        stage.visible_checks[1]
        if len(stage.visible_checks) > 1
        else stage.objective
    )
    goal_summary = _summarize_learner_goal(
        learner_focus=learner_focus,
        last_user_message=last_user_message,
        stage=stage,
    )

    if payload.audio_base64 and not effective_learner_goal:
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

    if not effective_learner_goal and last_assistant_message:
        return CoachChatResponse(
            conversation_stage="guiding",
            coach_message=(
                f"I am still with you on the {stage.title.lower()} stage, {learner_name}. "
                f"Show {_normalize_focus_text(primary_focus)} again when you are ready, or ask one short question."
            ),
            plan_summary=(
                f"Stay with the {stage.title.lower()} stage and wait for the learner's next move."
            ),
            suggested_next_step=(
                f"Keep the field steady and clearly show {_normalize_focus_text(primary_focus)} for the next cue."
            ),
            camera_observations=[],
            stage_focus=_clean_lines(stage.visible_checks)[:3] or [stage.title, stage.objective],
            learner_goal_summary="",
        )

    if payload.image_base64 and not effective_learner_goal:
        return CoachChatResponse(
            conversation_stage="guiding",
            coach_message=(
                f"Camera is live, {learner_name}. We are in the {stage.title.lower()} stage. "
                f"Keep the frame steady and show {_normalize_focus_text(primary_focus)}. "
                f"Next, make {_normalize_focus_text(secondary_focus)} easy to see so I can guide the stage hands-free."
            ),
            plan_summary=(
                f"Hands-free focus: stabilize the {stage.title.lower()} stage and make the key visual checks easy to inspect."
            ),
            suggested_next_step=(
                f"Hold the field steady and clearly show {_normalize_focus_text(primary_focus)} in the camera view."
            ),
            camera_observations=[],
            stage_focus=_clean_lines(stage.visible_checks)[:3] or [stage.title, stage.objective],
            learner_goal_summary="",
        )

    if not effective_learner_goal:
        return CoachChatResponse(
            conversation_stage="goal_setting",
            coach_message=(
                f"Camera is live, {learner_name}. We are starting with the {stage.title.lower()} stage. "
                "I will guide this stage hands-free. "
                f"Confirm the simulation setup, then show {_normalize_focus_text(primary_focus)} so I can coach the next cue in real time."
            ),
            plan_summary=(
                f"Start by confirming the simulation setup, then we will coach the {stage.title.lower()} stage using the live camera view."
            ),
            suggested_next_step=(
                f"Confirm the simulation surface, then position the camera so I can inspect {_normalize_focus_text(primary_focus)}."
            ),
            camera_observations=[],
            stage_focus=_clean_lines(stage.visible_checks)[:3] or [stage.title, stage.objective],
            learner_goal_summary="",
        )

    if not payload.simulation_confirmation:
        return CoachChatResponse(
            conversation_stage="planning",
            coach_message=(
                f"Thanks for sharing that you want to focus on {effective_learner_goal}. "
                f"We can build the session around the {stage.title.lower()} stage. "
                "Confirm the simulation-only setup when you are ready, and then I will guide the next step."
            ),
            plan_summary=(
                f"Focus on {effective_learner_goal} while using the {stage.title.lower()} stage as the starting checkpoint."
            ),
            suggested_next_step="Confirm the simulation setup, then capture a clear frame so I can guide the stage with you.",
            camera_observations=[],
            stage_focus=[stage.title, stage.objective],
            learner_goal_summary=goal_summary,
            learner_transcript=last_user_message,
        )

    if last_user_message:
        opening = "Good question." if latest_user_is_question else "I heard you."
        frame_cue = (
            f"I can see the live frame, so show {_normalize_focus_text(primary_focus)} and keep {_normalize_focus_text(secondary_focus)} steady on the next rep."
            if payload.image_base64
            else f"On the next rep, show {_normalize_focus_text(primary_focus)} clearly and keep {_normalize_focus_text(secondary_focus)} steady."
        )
        return CoachChatResponse(
            conversation_stage="guiding",
            coach_message=(
                f"{opening} For {stage.title.lower()}, focus on {_normalize_focus_text(primary_focus)} first. "
                f"{frame_cue} I will adjust the next cue with you in real time."
            ),
            plan_summary=(
                f"Live goal: {goal_summary or stage.title}. Guide the learner through the {stage.title.lower()} stage one visible cue at a time."
            ),
            suggested_next_step=(
                f"Make one controlled rep and clearly show {_normalize_focus_text(primary_focus)} in the frame."
            ),
            camera_observations=(
                ["A live frame is available for real-time coaching."]
                if payload.image_base64
                else []
            ),
            stage_focus=_clean_lines(stage.visible_checks)[:3] or [stage.title, stage.objective],
            learner_goal_summary=goal_summary,
            learner_transcript=last_user_message,
        )

    return CoachChatResponse(
        conversation_stage="guiding",
        coach_message=(
            f"Thanks. We will focus on {goal_summary or effective_learner_goal}. "
            f"Start by keeping {payload.practice_surface or procedure.practice_surface} steady and visible for the {stage.title.lower()} stage. "
            "Once the frame is clear, check the step and I will guide the next attempt in real time."
        ),
        plan_summary=f"Practice goal: {goal_summary or effective_learner_goal}. Start with the {stage.title.lower()} stage.",
        suggested_next_step=(
            f"Center {payload.practice_surface or procedure.practice_surface}, prepare for {stage.title.lower()}, and capture the next frame."
        ),
        camera_observations=(
            ["A live frame is available for image-guided coaching."]
            if payload.image_base64
            else []
        ),
        stage_focus=[stage.title, stage.objective],
        learner_goal_summary=goal_summary,
        learner_transcript=last_user_message,
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
        practice_surface=payload.practice_surface,
        image_base64=payload.image_base64 or "missing-frame",
        student_question=last_user_message or (payload.learner_focus or "").strip() or None,
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


def _looks_like_direct_question(text: str) -> bool:
    candidate = text.strip().lower()
    if not candidate:
        return False

    if candidate.endswith("?"):
        return True

    question_prefixes = (
        "what ",
        "why ",
        "how ",
        "when ",
        "where ",
        "which ",
        "who ",
        "is ",
        "are ",
        "am ",
        "do ",
        "does ",
        "did ",
        "can ",
        "could ",
        "should ",
        "would ",
        "will ",
        "have ",
        "has ",
    )
    return candidate.startswith(question_prefixes)


def _summarize_learner_goal(
    *,
    learner_focus: str,
    last_user_message: str,
    stage: ProcedureStage,
) -> str:
    if learner_focus:
        return learner_focus
    if not last_user_message:
        return ""
    if _looks_like_direct_question(last_user_message):
        return f"{stage.title} guidance"
    return last_user_message

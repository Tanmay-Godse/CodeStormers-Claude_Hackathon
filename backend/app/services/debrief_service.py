import json
from typing import Any

from app.core.config import settings
from app.schemas.debrief import DebriefRequest, DebriefResponse, QuizQuestion
from app.services.ai_client import (
    AIConfigurationError,
    AIRequestError,
    AIResponseError,
    send_json_message,
)
from app.services.procedure_loader import load_procedure


def generate_session_debrief(payload: DebriefRequest) -> DebriefResponse:
    procedure = load_procedure(payload.procedure_id)
    fallback_response = _build_fallback_debrief(payload)

    if not payload.events:
        return fallback_response

    try:
        response_data = send_json_message(
            model=settings.ai_debrief_model,
            max_tokens=settings.ai_debrief_max_tokens,
            system_prompt=_build_debrief_system_prompt(),
            user_content=_build_debrief_user_content(
                payload=payload,
                procedure_title=procedure.title,
                practice_surface=procedure.practice_surface,
            ),
            output_schema=DebriefResponse.model_json_schema(),
        )
    except (AIConfigurationError, AIRequestError, AIResponseError):
        return fallback_response

    return _normalize_debrief_response(response_data, fallback_response)


def _build_debrief_system_prompt() -> str:
    return (
        "You are an AI clinical skills coach writing a brief review for a simulation-only suturing practice session. "
        "The learner is practicing a simple interrupted suture on a safe practice surface, not a patient. "
        "Use the recorded stage events to identify strengths, improvement areas, a three-step practice plan, and a three-question quiz. "
        "Keep the tone encouraging, specific, and educational. "
        "Do not invent patient-care claims or high-stakes medical advice."
    )


def _build_debrief_user_content(
    *,
    payload: DebriefRequest,
    procedure_title: str,
    practice_surface: str,
) -> list[dict[str, Any]]:
    session_summary: dict[str, Any] = {
        "session_id": payload.session_id,
        "procedure_title": procedure_title,
        "practice_surface": practice_surface,
        "skill_level": payload.skill_level,
        "attempt_count": len(payload.events),
        "total_score": sum(event.score_delta for event in payload.events),
        "events": [event.model_dump(mode="json") for event in payload.events],
    }

    return [
        {
            "type": "text",
            "text": (
                "Generate a concise debrief for this stored suturing session. "
                "The response must match the JSON schema exactly.\n\n"
                f"{json.dumps(session_summary, indent=2)}"
            ),
        }
    ]


def _build_fallback_debrief(payload: DebriefRequest) -> DebriefResponse:
    if not payload.events:
        return DebriefResponse(
            strengths=[
                "You opened the trainer and set up a simulation-only suturing session.",
                "The review workflow is ready once you capture a scored attempt.",
                "Your session record is already structured for stage-by-stage coaching.",
            ],
            improvement_areas=[
                "Capture at least one analyzed frame to unlock personalized technique feedback.",
                "Log a full attempt on the current stage so the debrief can compare progress.",
                "Use the trainer camera to keep the practice surface centered and visible.",
            ],
            practice_plan=[
                "Start with the setup stage and capture a clear frame with the instrument visible.",
                "Ask one focused question during analysis so the coaching stays targeted.",
                "Return to review after the first scored attempt to generate the AI debrief.",
            ],
            quiz=_default_quiz(),
        )

    latest_event = payload.events[-1]
    pass_events = [event for event in payload.events if event.step_status == "pass"]
    unclear_events = [event for event in payload.events if event.step_status == "unclear"]
    unsafe_events = [event for event in payload.events if event.step_status == "unsafe"]
    issue_messages = _collect_issue_messages(payload)
    latest_observation = _first_non_empty(latest_event.visible_observations)

    strengths = [
        f"You logged {len(payload.events)} coached attempt(s), which is enough to compare progress across the session.",
        (
            f"You finished {len(pass_events)} stage attempt(s) with a pass, showing that parts of the technique are already repeatable."
            if pass_events
            else "You completed the full capture-and-review loop, which gives the coach something concrete to analyze."
        ),
        (
            f"Your latest frame still preserved a useful visual cue: {latest_observation}"
            if latest_observation
            else "Your session history is structured well enough to turn each retry into a focused next attempt."
        ),
    ]

    improvement_areas = [
        (
            f"Revisit the {_format_stage_id(latest_event.stage_id)} stage and focus on the latest coaching cue before advancing."
        ),
        (
            "Improve framing, lighting, and tool visibility when a frame is marked as unclear."
            if unclear_events
            else "Keep the camera framing steady so each retry is easy to judge against the stage rubric."
        ),
        (
            "Slow down and reset technique before the next capture whenever a step feels unsafe, even on a practice surface."
            if unsafe_events
            else (
                f"The most common correction in this session was: {issue_messages[0]}"
                if issue_messages
                else "Use the highlighted overlays to correct one visible issue at a time instead of changing everything at once."
            )
        ),
    ]

    practice_plan = [
        f"Repeat the {_format_stage_id(latest_event.stage_id)} stage once with the main objective clearly visible in frame.",
        (
            f"Use this exact coaching point on the next capture: {issue_messages[0]}"
            if issue_messages
            else "Ask one short question during the next analysis so the coaching stays focused on the correction you care about most."
        ),
        "After one cleaner retry, reopen the review page and compare the new coaching with the earlier attempt.",
    ]

    quiz = _build_quiz_from_events(payload)

    return DebriefResponse(
        strengths=_normalize_text_items(strengths, []),
        improvement_areas=_normalize_text_items(improvement_areas, []),
        practice_plan=_normalize_text_items(practice_plan, []),
        quiz=quiz,
    )


def _normalize_debrief_response(
    response_data: dict[str, Any],
    fallback_response: DebriefResponse,
) -> DebriefResponse:
    if not isinstance(response_data, dict):
        return fallback_response

    return DebriefResponse(
        strengths=_normalize_text_items(
            response_data.get("strengths"),
            fallback_response.strengths,
        ),
        improvement_areas=_normalize_text_items(
            response_data.get("improvement_areas"),
            fallback_response.improvement_areas,
        ),
        practice_plan=_normalize_text_items(
            response_data.get("practice_plan"),
            fallback_response.practice_plan,
        ),
        quiz=_normalize_quiz(
            response_data.get("quiz"),
            fallback_response.quiz,
        ),
    )


def _normalize_text_items(value: Any, fallback: list[str]) -> list[str]:
    cleaned: list[str] = []

    if isinstance(value, list):
        for item in value:
            if not isinstance(item, str):
                continue
            candidate = item.strip()
            if candidate and candidate not in cleaned:
                cleaned.append(candidate)
            if len(cleaned) == 3:
                break

    for item in fallback:
        candidate = item.strip()
        if candidate and candidate not in cleaned:
            cleaned.append(candidate)
        if len(cleaned) == 3:
            break

    return cleaned[:3]


def _normalize_quiz(value: Any, fallback: list[QuizQuestion]) -> list[QuizQuestion]:
    cleaned: list[QuizQuestion] = []
    seen_questions: set[str] = set()

    if isinstance(value, list):
        for item in value:
            if not isinstance(item, dict):
                continue
            question = item.get("question")
            answer = item.get("answer")
            if not isinstance(question, str) or not isinstance(answer, str):
                continue
            normalized_question = question.strip()
            normalized_answer = answer.strip()
            if (
                not normalized_question
                or not normalized_answer
                or normalized_question in seen_questions
            ):
                continue
            cleaned.append(
                QuizQuestion(
                    question=normalized_question,
                    answer=normalized_answer,
                )
            )
            seen_questions.add(normalized_question)
            if len(cleaned) == 3:
                break

    for item in fallback:
        if item.question in seen_questions:
            continue
        cleaned.append(item)
        seen_questions.add(item.question)
        if len(cleaned) == 3:
            break

    return cleaned[:3]


def _build_quiz_from_events(payload: DebriefRequest) -> list[QuizQuestion]:
    latest_event = payload.events[-1]
    issue_messages = _collect_issue_messages(payload)

    quiz = [
        QuizQuestion(
            question=f"What is the goal of the {_format_stage_id(latest_event.stage_id)} stage?",
            answer="It is to complete the stage objective cleanly enough that the coach can mark the step as visible and controlled.",
        ),
        QuizQuestion(
            question="What should you do when a frame is blurry or the tool is partly out of view?",
            answer="Retake the frame with steadier lighting and better visibility so the coaching stays reliable.",
        ),
        QuizQuestion(
            question="What is the next correction you should prioritize from this session?",
            answer=issue_messages[0]
            if issue_messages
            else "Use the latest coaching message and overlay targets to improve one visible issue before changing anything else.",
        ),
    ]

    return _normalize_quiz([], quiz)


def _default_quiz() -> list[QuizQuestion]:
    return [
        QuizQuestion(
            question="Why does the trainer ask for a clear view of the practice surface?",
            answer="A clear view makes it easier to judge technique, framing, and target alignment.",
        ),
        QuizQuestion(
            question="What should you do if the frame is blurry or the tool is out of view?",
            answer="Retake the frame so the analyzer can judge the step more reliably.",
        ),
        QuizQuestion(
            question="What is the first goal of the setup stage?",
            answer="Center the simulation surface and keep the tools visible before advancing.",
        ),
    ]


def _collect_issue_messages(payload: DebriefRequest) -> list[str]:
    messages: list[str] = []
    for event in reversed(payload.events):
        for issue in event.issues:
            candidate = issue.message.strip()
            if candidate and candidate not in messages:
                messages.append(candidate)
    return messages


def _first_non_empty(items: list[str]) -> str | None:
    for item in items:
        candidate = item.strip()
        if candidate:
            return candidate
    return None


def _format_stage_id(stage_id: str) -> str:
    return stage_id.replace("-", " ").replace("_", " ")

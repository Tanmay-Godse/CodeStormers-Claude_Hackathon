import pytest

from app.schemas.analyze import AnalyzeFrameRequest
from app.schemas.debrief import DebriefRequest, DebriefEvent
from app.services import analysis_service, debrief_service
from app.services.ai_client import AIRequestError, AIResponseError


def test_analysis_service_rejects_unknown_overlay_targets(monkeypatch) -> None:
    monkeypatch.setattr(
        analysis_service,
        "send_json_message",
        lambda **_: {
            "step_status": "retry",
            "confidence": 0.82,
            "visible_observations": [
                "entry zone is visible",
                "needle angle looks shallow",
            ],
            "issues": [
                {
                    "code": "angle_shallow",
                    "severity": "medium",
                    "message": "The angle is too shallow.",
                }
            ],
            "coaching_message": "Rotate upward before retrying.",
            "next_action": "Capture a second attempt.",
            "overlay_target_ids": ["not_a_real_target"],
        },
    )

    payload = AnalyzeFrameRequest(
        procedure_id="simple-interrupted-suture",
        stage_id="needle_entry",
        skill_level="beginner",
        image_base64="ZmFrZQ==",
    )

    with pytest.raises(AIResponseError, match="not allowed for stage 'needle_entry'"):
        analysis_service.analyze_frame_payload(payload)


def test_debrief_service_returns_local_fallback_for_empty_session() -> None:
    response = debrief_service.generate_session_debrief(
        DebriefRequest(
            session_id="session-123",
            procedure_id="simple-interrupted-suture",
            skill_level="beginner",
            events=[],
        )
    )

    assert len(response.strengths) == 3
    assert len(response.improvement_areas) == 3
    assert len(response.practice_plan) == 3
    assert len(response.quiz) == 3


def test_analysis_service_backfills_trimmed_response_fields(monkeypatch) -> None:
    monkeypatch.setattr(
        analysis_service,
        "send_json_message",
        lambda **_: {
            "step_status": "retry",
            "confidence": 0.82,
            "visible_observations": [
                "  ",
                "needle angle looks shallow",
            ],
            "issues": [],
            "coaching_message": "   ",
            "next_action": "   ",
            "overlay_target_ids": [],
        },
    )

    payload = AnalyzeFrameRequest(
        procedure_id="simple-interrupted-suture",
        stage_id="needle_entry",
        skill_level="beginner",
        image_base64="ZmFrZQ==",
    )

    response = analysis_service.analyze_frame_payload(payload)

    assert len(response.visible_observations) >= 2
    assert all(item.strip() for item in response.visible_observations)
    assert response.coaching_message
    assert response.next_action


def test_debrief_service_falls_back_when_ai_request_fails(monkeypatch) -> None:
    monkeypatch.setattr(
        debrief_service,
        "send_json_message",
        lambda **_: (_ for _ in ()).throw(AIRequestError("boom")),
    )

    response = debrief_service.generate_session_debrief(
        DebriefRequest(
            session_id="session-123",
            procedure_id="simple-interrupted-suture",
            skill_level="beginner",
            events=[
                DebriefEvent(
                    stage_id="needle_entry",
                    attempt=1,
                    step_status="retry",
                    issues=[],
                    score_delta=8,
                    coaching_message="Rotate upward before retrying.",
                    overlay_target_ids=["entry_point"],
                    visible_observations=["entry zone is visible"],
                    next_action="Capture a second attempt.",
                    confidence=0.84,
                    created_at="2026-03-20T17:10:00.000Z",
                )
            ],
        )
    )

    assert len(response.strengths) == 3
    assert len(response.practice_plan) == 3
    assert len(response.quiz) == 3
    assert "needle entry" in response.practice_plan[0].lower()


def test_debrief_service_backfills_quiz_when_ai_payload_is_partial(monkeypatch) -> None:
    monkeypatch.setattr(
        debrief_service,
        "send_json_message",
        lambda **_: {
            "strengths": [
                "You kept the field centered.",
                "Your tool stayed visible.",
                "You logged a useful retry.",
            ],
            "improvement_areas": [
                "Improve the angle.",
                "Keep the arc smoother.",
                "Retake any blurry frame.",
            ],
            "practice_plan": [
                "Retry the entry stage once.",
                "Use the overlay before advancing.",
                "Reopen review after the retry.",
            ],
            "quiz": [
                {
                    "question": "   ",
                    "answer": "",
                }
            ],
        },
    )

    response = debrief_service.generate_session_debrief(
        DebriefRequest(
            session_id="session-123",
            procedure_id="simple-interrupted-suture",
            skill_level="beginner",
            events=[
                DebriefEvent(
                    stage_id="needle_entry",
                    attempt=1,
                    step_status="retry",
                    issues=[],
                    score_delta=8,
                    coaching_message="Rotate upward before retrying.",
                    overlay_target_ids=["entry_point"],
                    visible_observations=["entry zone is visible"],
                    next_action="Capture a second attempt.",
                    confidence=0.84,
                    created_at="2026-03-20T17:10:00.000Z",
                )
            ],
        )
    )

    assert response.strengths[0] == "You kept the field centered."
    assert len(response.quiz) == 3

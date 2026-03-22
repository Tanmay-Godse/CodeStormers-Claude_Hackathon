import pytest

from app.schemas.analyze import AnalyzeFrameRequest, SafetyGateResult
from app.schemas.coach import CoachChatRequest
from app.schemas.debrief import DebriefRequest, DebriefEvent
from app.schemas.review import ResolveReviewCaseRequest
from app.services import analysis_service, coach_service, debrief_service
from app.services.ai_client import AIRequestError, AIResponseError
from app.services import review_queue_service, safety_service


def make_cleared_safety_gate() -> SafetyGateResult:
    return SafetyGateResult(
        status="cleared",
        confidence=0.97,
        reason="The image cleared the simulation-only safety screen.",
        refusal_message=None,
    )


def test_analysis_service_rejects_unknown_overlay_targets(monkeypatch) -> None:
    monkeypatch.setattr(
        safety_service,
        "evaluate_safety_gate",
        lambda **_: make_cleared_safety_gate(),
    )
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
        simulation_confirmation=True,
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
    assert len(response.equity_support_plan) == 3
    assert response.audio_script
    assert len(response.quiz) == 3


def test_analysis_service_backfills_trimmed_response_fields(monkeypatch) -> None:
    monkeypatch.setattr(
        safety_service,
        "evaluate_safety_gate",
        lambda **_: make_cleared_safety_gate(),
    )
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
        simulation_confirmation=True,
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
    assert len(response.equity_support_plan) == 3
    assert response.audio_script
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
            "equity_support_plan": [
                "Use low-bandwidth mode when needed.",
                "Replay audio coaching for accessibility.",
                "Keep logging attempts offline if the network drops.",
            ],
            "audio_script": "Quick recap. Retry the entry stage once.",
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
    assert response.audio_script == "Quick recap. Retry the entry stage once."
    assert len(response.quiz) == 3


def test_debrief_service_localizes_fallback_response() -> None:
    response = debrief_service.generate_session_debrief(
        DebriefRequest(
            session_id="session-456",
            procedure_id="simple-interrupted-suture",
            skill_level="beginner",
            feedback_language="es",
            events=[],
        )
    )

    assert response.feedback_language == "es"
    assert "simulacion" in response.strengths[0].lower()
    assert "coaching" in response.audio_script.lower() or "resumen" in response.audio_script.lower()


def test_coach_service_sends_audio_to_model(monkeypatch) -> None:
    captured = {}

    def fake_send_json_message(**kwargs):
        captured["request"] = kwargs
        return {
            "conversation_stage": "planning",
            "coach_message": "Thanks. We will work on entry angle first.",
            "plan_summary": "Plan: focus on entry angle and steady framing.",
            "suggested_next_step": "Center the field and take one slow attempt.",
            "camera_observations": [],
            "stage_focus": ["Needle Entry"],
            "learner_goal_summary": "Improve my entry angle",
        }

    monkeypatch.setattr(
        coach_service,
        "send_json_message",
        fake_send_json_message,
    )

    response = coach_service.generate_coach_turn(
        CoachChatRequest(
            procedure_id="simple-interrupted-suture",
            stage_id="needle_entry",
            skill_level="beginner",
            audio_base64="UklGRg==",
            audio_format="wav",
            messages=[],
        )
    )

    assert response.learner_goal_summary == "Improve my entry angle"
    assert captured["request"]["user_content"][-1] == {
        "type": "audio",
        "source": {
            "type": "base64",
            "media_type": "audio/wav",
            "format": "wav",
            "data": "UklGRg==",
        },
    }


def test_coach_service_surfaces_missing_vllm_audio_support(monkeypatch) -> None:
    monkeypatch.setattr(
        coach_service,
        "send_json_message",
        lambda **_: (_ for _ in ()).throw(
            AIRequestError("Please install vllm[audio] for audio support")
        ),
    )

    response = coach_service.generate_coach_turn(
        CoachChatRequest(
            procedure_id="simple-interrupted-suture",
            stage_id="needle_entry",
            skill_level="beginner",
            audio_base64="UklGRg==",
            audio_format="wav",
            messages=[],
        )
    )

    assert response.conversation_stage == "blocked"
    assert "audio support" in response.coach_message.lower()
    assert "typed" in response.plan_summary.lower()


def test_safety_service_blocks_without_simulation_confirmation() -> None:
    payload = AnalyzeFrameRequest(
        procedure_id="simple-interrupted-suture",
        stage_id="needle_entry",
        skill_level="beginner",
        image_base64="ZmFrZQ==",
        simulation_confirmation=False,
    )

    procedure = analysis_service.load_procedure("simple-interrupted-suture")
    stage = analysis_service.load_stage(procedure, "needle_entry")
    result = safety_service.evaluate_safety_gate(
        payload=payload,
        procedure=procedure,
        stage=stage,
    )

    assert result.status == "blocked"
    assert "confirmation" in result.reason.lower()


def test_review_queue_service_resolves_case(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(
        review_queue_service,
        "REVIEW_CASES_PATH",
        tmp_path / "review_cases.json",
    )

    created_case = review_queue_service.create_review_case(
        source="safety_gate",
        session_id="session-123",
        procedure_id="simple-interrupted-suture",
        stage_id="needle_entry",
        skill_level="beginner",
        student_name="Student User",
        trigger_reason="The scene may depict a live clinical setting.",
        analysis_blocked=True,
        initial_step_status="unsafe",
        confidence=0.94,
        coaching_message="Analysis was blocked.",
        safety_gate=SafetyGateResult(
          status="blocked",
          confidence=0.94,
          reason="The scene may depict a live clinical setting.",
          refusal_message="Analysis was blocked.",
        ),
    )

    resolved_case = review_queue_service.resolve_review_case(
        created_case.id,
        payload=ResolveReviewCaseRequest(
            reviewer_name="Faculty Reviewer",
            reviewer_notes="Good block. Keep the safety gate strict.",
            corrected_step_status="unsafe",
            corrected_coaching_message="Do not analyze real-patient imagery.",
            rubric_feedback="Preserve this refusal pattern.",
        ),
    )

    assert resolved_case.status == "resolved"
    assert resolved_case.reviewer_name == "Faculty Reviewer"

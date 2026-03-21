from fastapi.testclient import TestClient

from app.api.routes import analyze as analyze_route
from app.api.routes import debrief as debrief_route
from app.api.routes import review_cases as review_cases_route
from app.main import app
from app.schemas.analyze import AnalyzeFrameResponse, Issue, SafetyGateResult
from app.schemas.debrief import DebriefResponse, QuizQuestion
from app.services.ai_client import AIConfigurationError
from app.services import review_queue_service

client = TestClient(app)


def test_health_route() -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "simulation_only": True}


def test_procedure_route_returns_expected_shape() -> None:
    response = client.get("/api/v1/procedures/simple-interrupted-suture")

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == "simple-interrupted-suture"
    assert len(data["stages"]) == 7
    assert len(data["named_overlay_targets"]) == 8


def test_analyze_route_returns_ai_response(monkeypatch) -> None:
    def fake_analyze_frame_payload(_payload):
        return AnalyzeFrameResponse(
            analysis_mode="coaching",
            step_status="retry",
            confidence=0.88,
            visible_observations=[
                "needle driver is visible near the target zone",
                "entry angle looks shallower than ideal",
            ],
            issues=[
                Issue(
                    code="angle_shallow",
                    severity="medium",
                    message="The entry angle is too shallow for a confident bite.",
                )
            ],
            coaching_message="Rotate the wrist slightly upward before the next attempt.",
            next_action="Reframe the entry and capture one more attempt.",
            overlay_target_ids=["entry_point", "needle_angle"],
            score_delta=13,
            safety_gate=SafetyGateResult(
                status="cleared",
                confidence=0.98,
                reason="The image cleared the simulation-only safety screen.",
                refusal_message=None,
            ),
            requires_human_review=False,
            human_review_reason=None,
            review_case_id=None,
        )

    monkeypatch.setattr(
        analyze_route.analysis_service,
        "analyze_frame_payload",
        fake_analyze_frame_payload,
    )

    response = client.post(
        "/api/v1/analyze-frame",
        json={
            "procedure_id": "simple-interrupted-suture",
            "stage_id": "needle_entry",
            "skill_level": "beginner",
            "image_base64": "ZmFrZQ==",
            "simulation_confirmation": True,
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["step_status"] == "retry"
    assert data["overlay_target_ids"] == ["entry_point", "needle_angle"]
    assert data["score_delta"] == 13


def test_debrief_route_returns_ai_summary(monkeypatch) -> None:
    def fake_generate_session_debrief(_payload):
        return DebriefResponse(
            feedback_language="en",
            strengths=[
                "You kept the practice surface centered during the attempt.",
                "Your grip remained stable enough to judge the frame.",
                "You captured a reviewable image for coaching.",
            ],
            improvement_areas=[
                "Improve the entry angle on the first bite.",
                "Keep the needle arc consistent through the wound line.",
                "Seat the knot more centrally during the final tie.",
            ],
            practice_plan=[
                "Repeat the entry stage with a more perpendicular approach.",
                "Practice one slow exit arc while keeping the far side visible.",
                "Finish with one centered knot attempt and review the frame.",
            ],
            equity_support_plan=[
                "Use low-bandwidth mode when the connection is weak.",
                "Replay the audio coaching if reading is tiring.",
                "Keep logging practice locally when the network drops.",
            ],
            audio_script="Quick coaching recap. Repeat the entry stage with a more perpendicular approach.",
            quiz=[
                QuizQuestion(
                    question="What does a shallow entry angle usually affect?",
                    answer="It makes the first bite less confident and harder to control.",
                ),
                QuizQuestion(
                    question="Why should the far-side exit remain visible?",
                    answer="Visibility helps confirm the arc completes across the practice line.",
                ),
                QuizQuestion(
                    question="What does a centered final knot improve?",
                    answer="It improves the presentation and alignment of the finished stitch.",
                ),
            ],
        )

    monkeypatch.setattr(
        debrief_route.debrief_service,
        "generate_session_debrief",
        fake_generate_session_debrief,
    )

    response = client.post(
        "/api/v1/debrief",
        json={
            "session_id": "session-123",
            "procedure_id": "simple-interrupted-suture",
            "skill_level": "beginner",
            "events": [
                {
                    "stage_id": "needle_entry",
                    "attempt": 1,
                    "step_status": "retry",
                    "issues": [
                        {
                            "code": "angle_shallow",
                            "severity": "medium",
                            "message": "The angle is too shallow.",
                        }
                    ],
                    "score_delta": 13,
                    "coaching_message": "Rotate upward before retrying.",
                    "overlay_target_ids": ["entry_point", "needle_angle"],
                    "visible_observations": [
                        "surface is centered",
                        "entry zone is visible",
                    ],
                    "next_action": "Retry the entry stage.",
                    "confidence": 0.88,
                    "created_at": "2026-03-20T17:10:00.000Z",
                }
            ],
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data["strengths"]) == 3
    assert len(data["practice_plan"]) == 3
    assert len(data["equity_support_plan"]) == 3
    assert data["feedback_language"] == "en"
    assert data["audio_script"]
    assert len(data["quiz"]) == 3


def test_analyze_route_returns_503_for_missing_ai_configuration(monkeypatch) -> None:
    def fake_analyze_frame_payload(_payload):
        raise AIConfigurationError("AI_API_BASE_URL is not configured.")

    monkeypatch.setattr(
        analyze_route.analysis_service,
        "analyze_frame_payload",
        fake_analyze_frame_payload,
    )

    response = client.post(
        "/api/v1/analyze-frame",
        json={
            "procedure_id": "simple-interrupted-suture",
            "stage_id": "needle_entry",
            "skill_level": "beginner",
            "image_base64": "ZmFrZQ==",
            "simulation_confirmation": True,
        },
    )

    assert response.status_code == 503
    assert response.json() == {"detail": "AI_API_BASE_URL is not configured."}


def test_review_cases_route_lists_and_resolves_cases(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(
        review_queue_service,
        "REVIEW_CASES_PATH",
        tmp_path / "review_cases.json",
    )

    created_case = review_queue_service.create_review_case(
        source="quality_flag",
        session_id="session-123",
        procedure_id="simple-interrupted-suture",
        stage_id="needle_entry",
        skill_level="beginner",
        student_name="Student User",
        trigger_reason="Low confidence triggered human review.",
        analysis_blocked=False,
        initial_step_status="retry",
        confidence=0.51,
        coaching_message="Retry with a better angle.",
        safety_gate=SafetyGateResult(
            status="cleared",
            confidence=0.92,
            reason="The safety gate cleared the image.",
            refusal_message=None,
        ),
    )

    response = client.get("/api/v1/review-cases?status=pending")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["id"] == created_case.id

    resolve_response = client.post(
        f"/api/v1/review-cases/{created_case.id}/resolve",
        json={
            "reviewer_name": "Faculty Reviewer",
            "reviewer_notes": "The AI was directionally correct but too uncertain.",
            "corrected_step_status": "retry",
            "rubric_feedback": "Tighten the wording around shallow entry angle.",
        },
    )

    assert resolve_response.status_code == 200
    resolved = resolve_response.json()
    assert resolved["status"] == "resolved"
    assert resolved["reviewer_name"] == "Faculty Reviewer"

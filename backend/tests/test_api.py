from fastapi.testclient import TestClient

from app.api.routes import analyze as analyze_route
from app.api.routes import debrief as debrief_route
from app.main import app
from app.schemas.analyze import AnalyzeFrameResponse, Issue
from app.schemas.debrief import DebriefResponse, QuizQuestion
from app.services.ai_client import AIConfigurationError

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
        },
    )

    assert response.status_code == 503
    assert response.json() == {"detail": "AI_API_BASE_URL is not configured."}

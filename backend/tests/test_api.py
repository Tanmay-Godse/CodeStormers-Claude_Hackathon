import hashlib
import sqlite3

from fastapi.testclient import TestClient

from app.api.routes import analyze as analyze_route
from app.api.routes import coach as coach_route
from app.api.routes import debrief as debrief_route
from app.api.routes import review_cases as review_cases_route
from app.api.routes import tts as tts_route
from app.main import app
from app.schemas.analyze import AnalyzeFrameResponse, Issue, SafetyGateResult
from app.schemas.coach import CoachChatResponse
from app.schemas.debrief import AdaptiveDrill, DebriefResponse, ErrorFingerprintItem, QuizQuestion
from app.services import auth_service
from app.services.ai_client import AIConfigurationError
from app.services import review_queue_service

client = TestClient(app)


def test_health_route() -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "simulation_only": True}


def test_auth_routes_create_preview_and_sign_in_with_sqlite(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(auth_service, "AUTH_DB_PATH", tmp_path / "auth.db")

    create_response = client.post(
        "/api/v1/auth/accounts",
        json={
            "name": "Student One",
            "username": "Student01",
            "password": "supersecure",
            "role": "student",
        },
    )

    assert create_response.status_code == 201
    created = create_response.json()
    assert created["username"] == "student01"
    assert created["name"] == "Student One"
    assert created["role"] == "student"

    preview_response = client.get(
        "/api/v1/auth/accounts/preview",
        params={"identifier": "student01"},
    )

    assert preview_response.status_code == 200
    assert preview_response.json()["name"] == "Student One"

    sign_in_response = client.post(
        "/api/v1/auth/sign-in",
        json={
            "identifier": "Student One",
            "password": "supersecure",
            "role": "student",
        },
    )

    assert sign_in_response.status_code == 200
    signed_in = sign_in_response.json()
    assert signed_in["id"] == created["id"]
    assert signed_in["username"] == "student01"


def test_auth_preview_conflicts_on_duplicate_display_name(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(auth_service, "AUTH_DB_PATH", tmp_path / "auth.db")

    first_response = client.post(
        "/api/v1/auth/accounts",
        json={
            "name": "Shared Name",
            "username": "student01",
            "password": "supersecure",
            "role": "student",
        },
    )
    second_response = client.post(
        "/api/v1/auth/accounts",
        json={
            "name": "Shared Name",
            "username": "faculty01",
            "password": "supersecure",
            "role": "admin",
        },
    )

    assert first_response.status_code == 201
    assert second_response.status_code == 201

    preview_response = client.get(
        "/api/v1/auth/accounts/preview",
        params={"identifier": "Shared Name"},
    )

    assert preview_response.status_code == 409
    assert "display name" in preview_response.json()["detail"]


def test_auth_sign_in_upgrades_legacy_sha256_hash(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "auth.db"
    monkeypatch.setattr(auth_service, "AUTH_DB_PATH", db_path)

    auth_service._ensure_store()
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            INSERT INTO auth_accounts (
                id,
                name,
                username,
                normalized_display_name,
                password_hash,
                password_salt,
                password_scheme,
                role,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "account-legacy",
                "Legacy User",
                "legacy01",
                "legacy user",
                hashlib.sha256("supersecure".encode("utf-8")).hexdigest(),
                None,
                "sha256",
                "student",
                "2026-03-21T00:00:00+00:00",
            ),
        )

    sign_in_response = client.post(
        "/api/v1/auth/sign-in",
        json={
            "identifier": "legacy01",
            "password": "supersecure",
            "role": "student",
        },
    )

    assert sign_in_response.status_code == 200

    with sqlite3.connect(db_path) as connection:
        row = connection.execute(
            """
            SELECT password_hash, password_salt, password_scheme
            FROM auth_accounts
            WHERE id = ?
            """,
            ("account-legacy",),
        ).fetchone()

    assert row is not None
    assert row[1]
    assert row[2] == auth_service.CURRENT_PASSWORD_SCHEME
    assert row[0] != hashlib.sha256("supersecure".encode("utf-8")).hexdigest()


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
            graded_attempt_count=1,
            not_graded_attempt_count=0,
            error_fingerprint=[
                ErrorFingerprintItem(
                    code="angle_shallow",
                    label="shallow entry angle",
                    count=2,
                    stage_ids=["needle_entry"],
                )
            ],
            adaptive_drill=AdaptiveDrill(
                title="shallow entry angle mini drill",
                focus="shallow entry angle",
                reason="This drill targets your most repeated issue across sessions: shallow entry angle.",
                instructions=[
                    "Do 5 slow reps that isolate the entry angle.",
                    "Pause after each rep and check whether the correction stayed visible.",
                    "Finish with 1 full captured attempt and compare it with the earlier pattern.",
                ],
                rep_target="Target: 5 focused reps and 1 full capture.",
            ),
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
    assert data["graded_attempt_count"] == 1
    assert len(data["error_fingerprint"]) == 1
    assert data["audio_script"]
    assert len(data["quiz"]) == 3


def test_coach_chat_route_returns_conversational_turn(monkeypatch) -> None:
    def fake_generate_coach_turn(_payload):
        return CoachChatResponse(
            conversation_stage="planning",
            coach_message=(
                "Thanks for sharing your goal. We will focus on a steadier needle entry and a clearer first bite."
            ),
            plan_summary="Plan: stabilize setup, focus on entry angle, then capture one coached attempt.",
            suggested_next_step="Tell me when you are ready to focus on the needle entry stage.",
            camera_observations=["Practice surface is visible and centered."],
            stage_focus=["Needle Entry", "Stable framing"],
        )

    monkeypatch.setattr(
        coach_route.coach_service,
        "generate_coach_turn",
        fake_generate_coach_turn,
    )

    response = client.post(
        "/api/v1/coach-chat",
        json={
            "procedure_id": "simple-interrupted-suture",
            "stage_id": "needle_entry",
            "skill_level": "beginner",
            "feedback_language": "en",
            "simulation_confirmation": True,
            "image_base64": "ZmFrZQ==",
            "messages": [
                {
                    "role": "user",
                    "content": "I want to improve my needle entry angle.",
                }
            ],
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["conversation_stage"] == "planning"
    assert data["camera_observations"] == ["Practice surface is visible and centered."]


def test_tts_route_returns_audio_payload(monkeypatch) -> None:
    monkeypatch.setattr(
        tts_route.tts_service,
        "synthesize_speech_wav",
        lambda _payload: b"RIFFfakewav",
    )

    response = client.post(
        "/api/v1/tts",
        json={
            "text": "Coach voice check.",
            "feedback_language": "en",
            "coach_voice": "guide_male",
        },
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("audio/wav")
    assert response.content == b"RIFFfakewav"


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

import json
import hashlib
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.api.routes import analyze as analyze_route
from app.api.routes import coach as coach_route
from app.api.routes import debrief as debrief_route
from app.api.routes import knowledge as knowledge_route
from app.api.routes import review_cases as review_cases_route
from app.api.routes import transcription as transcription_route
from app.api.routes import tts as tts_route
from app.core.config import settings
from app.main import app
from app.schemas.analyze import AnalyzeFrameResponse, Issue, SafetyGateResult
from app.schemas.coach import CoachChatResponse
from app.schemas.debrief import AdaptiveDrill, DebriefResponse, ErrorFingerprintItem, QuizQuestion
from app.schemas.knowledge import (
    KnowledgeFlashcard,
    KnowledgeMultipleChoiceQuestion,
    KnowledgePackResponse,
)
from app.services import auth_service
from app.services import learning_state_service
from app.services.ai_client import AIConfigurationError
from app.services import review_queue_service

client = TestClient(app)

PRIVATE_SEED_ACCOUNTS = json.dumps(
    [
        {
            "id": "account-developer-team",
            "name": "Developer Team",
            "username": "developer@gmail.com",
            "password": "Qwerty@123",
            "role": "admin",
            "is_developer": True,
            "live_session_limit": None,
        },
        {
            "id": "account-team-tanmay",
            "name": "Tanmay",
            "username": "tanmay@gmail.com",
            "password": "QwertY@123",
            "role": "admin",
            "is_developer": False,
            "live_session_limit": 10,
        },
    ]
)


@pytest.fixture(autouse=True)
def clear_private_seed_accounts(monkeypatch) -> None:
    monkeypatch.delenv("PRIVATE_SEED_ACCOUNTS_JSON", raising=False)


def configure_private_seed_accounts(monkeypatch) -> None:
    monkeypatch.setenv("PRIVATE_SEED_ACCOUNTS_JSON", PRIVATE_SEED_ACCOUNTS)


def auth_headers(account: dict[str, object]) -> dict[str, str]:
    return {
        "X-Account-Id": str(account["id"]),
        "X-Session-Token": str(account["session_token"]),
    }


def test_private_seed_accounts_can_load_from_backend_env_file(
    tmp_path,
    monkeypatch,
) -> None:
    env_path = tmp_path / ".env"
    env_path.write_text(
        'PRIVATE_SEED_ACCOUNTS_JSON=[{"id":"account-local-dev","name":"Local Dev","username":"local.dev@example.com","password":"LocalDev@2026","role":"admin","is_developer":true,"live_session_limit":null}]',
        encoding="utf-8",
    )

    monkeypatch.delenv("PRIVATE_SEED_ACCOUNTS_JSON", raising=False)
    monkeypatch.setattr(auth_service, "BACKEND_ENV_FILE", env_path)

    accounts = auth_service._load_private_seeded_accounts()

    assert len(accounts) == 1
    assert accounts[0]["username"] == "local.dev@example.com"
    assert accounts[0]["is_developer"] is True
    assert accounts[0]["live_session_limit"] is None


def test_health_route() -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["simulation_only"] is True
    assert payload["ai_provider"] == settings.ai_provider
    assert payload["ai_ready"] is True
    assert payload["ai_coach_model"] == settings.ai_coach_model
    assert payload["transcription_ready"] is True
    assert payload["transcription_model"] == settings.transcription_model
    assert (
        payload["transcription_api_base_url"]
        == settings.transcription_api_base_url
    )


def test_demo_student_account_sign_in_and_session_refresh(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(auth_service, "AUTH_DB_PATH", tmp_path / "auth.db")

    sign_in_response = client.post(
        "/api/v1/auth/sign-in",
        json={
            "identifier": "Student_1@gmail.com",
            "password": "Qwerty@123",
            "role": "student",
        },
    )

    assert sign_in_response.status_code == 200
    signed_in = sign_in_response.json()
    assert signed_in["username"] == "student_1@gmail.com"
    assert signed_in["session_token"]
    assert signed_in["live_session_used"] == 0
    assert signed_in["live_session_remaining"] == 10

    session_response = client.get(
        "/api/v1/auth/session",
        headers=auth_headers(signed_in),
    )

    assert session_response.status_code == 200
    session_account = session_response.json()
    assert session_account["username"] == "student_1@gmail.com"
    assert session_account["role"] == "student"
    assert session_account["live_session_limit"] == 10
    assert session_account["live_session_remaining"] == 10
    assert session_account["session_token"] == signed_in["session_token"]


def test_fixed_developer_account_is_seeded_and_reserved(tmp_path, monkeypatch) -> None:
    configure_private_seed_accounts(monkeypatch)
    monkeypatch.setattr(auth_service, "AUTH_DB_PATH", tmp_path / "auth.db")

    sign_in_response = client.post(
        "/api/v1/auth/sign-in",
        json={
            "identifier": "developer@gmail.com",
            "password": "Qwerty@123",
        },
    )

    assert sign_in_response.status_code == 200
    signed_in = sign_in_response.json()
    assert signed_in["is_developer"] is True

    session_response = client.get(
        "/api/v1/auth/session",
        headers=auth_headers(signed_in),
    )

    assert session_response.status_code == 200
    preview = session_response.json()
    assert preview["username"] == "developer@gmail.com"
    assert preview["role"] == "admin"
    assert preview["is_developer"] is True
    assert preview["live_session_limit"] is None

    create_response = client.post(
        "/api/v1/auth/accounts",
        json={
            "name": "Imposter Dev",
            "username": "developer@gmail.com",
            "password": "supersecure",
            "role": "admin",
        },
    )

    assert create_response.status_code == 409
    assert "already registered" in create_response.json()["detail"].lower()


def test_self_service_student_account_can_be_created_and_signed_in(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(auth_service, "AUTH_DB_PATH", tmp_path / "auth.db")

    create_response = client.post(
        "/api/v1/auth/accounts",
        json={
            "name": "Student Prime",
            "username": "student.prime",
            "password": "supersecure",
            "role": "student",
        },
    )

    assert create_response.status_code == 201
    created = create_response.json()
    assert created["username"] == "student.prime"
    assert created["role"] == "student"
    assert created["is_seeded"] is False
    assert created["session_token"]
    assert created["live_session_limit"] == 10
    assert created["live_session_remaining"] == 10

    session_response = client.get(
        "/api/v1/auth/session",
        headers=auth_headers(created),
    )
    assert session_response.status_code == 200
    assert session_response.json()["username"] == "student.prime"

    sign_in_response = client.post(
        "/api/v1/auth/sign-in",
        json={
            "identifier": "student.prime",
            "password": "supersecure",
            "role": "student",
        },
    )

    assert sign_in_response.status_code == 200
    signed_in = sign_in_response.json()
    assert signed_in["username"] == "student.prime"
    assert signed_in["session_token"]


def test_self_service_account_creation_rejects_duplicate_username_variants(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(auth_service, "AUTH_DB_PATH", tmp_path / "auth.db")

    first_create_response = client.post(
        "/api/v1/auth/accounts",
        json={
            "name": "Student Prime",
            "username": "Student.Prime",
            "password": "supersecure",
            "role": "student",
        },
    )

    assert first_create_response.status_code == 201
    assert first_create_response.json()["username"] == "student.prime"

    duplicate_create_response = client.post(
        "/api/v1/auth/accounts",
        json={
            "name": "Student Prime Two",
            "username": "  student.prime  ",
            "password": "supersecure",
            "role": "student",
        },
    )

    assert duplicate_create_response.status_code == 409
    assert (
        duplicate_create_response.json()["detail"]
        == "That username is already registered. Sign in instead."
    )


def test_self_service_admin_request_starts_pending_and_student_scoped(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(auth_service, "AUTH_DB_PATH", tmp_path / "auth.db")

    create_response = client.post(
        "/api/v1/auth/accounts",
        json={
            "name": "Faculty Reviewer",
            "username": "faculty.reviewer",
            "password": "supersecure",
            "role": "admin",
        },
    )

    assert create_response.status_code == 201
    created = create_response.json()
    assert created["username"] == "faculty.reviewer"
    assert created["role"] == "student"
    assert created["requested_role"] == "admin"
    assert created["admin_approval_status"] == "pending"

    admin_sign_in_response = client.post(
        "/api/v1/auth/sign-in",
        json={
            "identifier": "faculty.reviewer",
            "password": "supersecure",
            "role": "admin",
        },
    )

    assert admin_sign_in_response.status_code == 409
    assert "pending" in admin_sign_in_response.json()["detail"].lower()

    student_sign_in_response = client.post(
        "/api/v1/auth/sign-in",
        json={
            "identifier": "faculty.reviewer",
            "password": "supersecure",
            "role": "student",
        },
    )

    assert student_sign_in_response.status_code == 200
    assert student_sign_in_response.json()["requested_role"] == "admin"
    assert student_sign_in_response.json()["admin_approval_status"] == "pending"


def test_internal_admin_account_is_seeded_and_can_sign_in(tmp_path, monkeypatch) -> None:
    configure_private_seed_accounts(monkeypatch)
    monkeypatch.setattr(auth_service, "AUTH_DB_PATH", tmp_path / "auth.db")

    sign_in_response = client.post(
        "/api/v1/auth/sign-in",
        json={
            "identifier": "tanmay@gmail.com",
            "password": "QwertY@123",
            "role": "admin",
        },
    )

    assert sign_in_response.status_code == 200
    signed_in = sign_in_response.json()
    assert signed_in["username"] == "tanmay@gmail.com"
    assert signed_in["session_token"]

    session_response = client.get(
        "/api/v1/auth/session",
        headers=auth_headers(signed_in),
    )

    assert session_response.status_code == 200
    preview = session_response.json()
    assert preview["role"] == "admin"
    assert preview["live_session_limit"] == 10


def test_live_session_limit_can_be_consumed_and_reset_by_admin(tmp_path, monkeypatch) -> None:
    configure_private_seed_accounts(monkeypatch)
    monkeypatch.setattr(auth_service, "AUTH_DB_PATH", tmp_path / "auth.db")

    student_sign_in = client.post(
        "/api/v1/auth/sign-in",
        json={
            "identifier": "student_1@gmail.com",
            "password": "Qwerty@123",
            "role": "student",
        },
    )
    assert student_sign_in.status_code == 200
    student = student_sign_in.json()

    consume_response = client.post(
        "/api/v1/auth/live-sessions/consume",
        json={
            "account_id": student["id"],
            "session_token": student["session_token"],
        },
    )
    assert consume_response.status_code == 200
    assert consume_response.json()["live_session_remaining"] == 9

    admin_sign_in = client.post(
        "/api/v1/auth/sign-in",
        json={
            "identifier": "tanmay@gmail.com",
            "password": "QwertY@123",
            "role": "admin",
        },
    )
    assert admin_sign_in.status_code == 200
    admin = admin_sign_in.json()

    list_response = client.get(
        "/api/v1/auth/demo-accounts",
        headers=auth_headers(admin),
    )
    assert list_response.status_code == 200
    listed_student = next(
        entry
        for entry in list_response.json()
        if entry["username"] == "student_1@gmail.com"
    )
    assert listed_student["live_session_remaining"] == 9

    reset_response = client.post(
        f"/api/v1/auth/accounts/{student['id']}/reset-live-sessions",
        json={
            "actor_account_id": admin["id"],
            "actor_session_token": admin["session_token"],
        },
    )
    assert reset_response.status_code == 200
    assert reset_response.json()["live_session_remaining"] == 10


def test_authenticated_preview_only_allows_the_signed_in_account(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(auth_service, "AUTH_DB_PATH", tmp_path / "auth.db")
    sign_in_response = client.post(
        "/api/v1/auth/sign-in",
        json={
            "identifier": "student_1@gmail.com",
            "password": "Qwerty@123",
            "role": "student",
        },
    )
    assert sign_in_response.status_code == 200
    student = sign_in_response.json()

    own_preview_response = client.get(
        "/api/v1/auth/accounts/preview",
        params={"identifier": "student_1@gmail.com"},
        headers=auth_headers(student),
    )

    assert own_preview_response.status_code == 200
    assert own_preview_response.json()["username"] == "student_1@gmail.com"

    other_preview_response = client.get(
        "/api/v1/auth/accounts/preview",
        params={"identifier": "student_2@gmail.com"},
        headers=auth_headers(student),
    )

    assert other_preview_response.status_code == 403
    assert "only preview the signed-in account" in other_preview_response.json()[
        "detail"
    ].lower()


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
                is_seeded,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                1,
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


def test_auth_update_account_changes_profile_and_password(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "auth.db"
    monkeypatch.setattr(auth_service, "AUTH_DB_PATH", db_path)

    auth_service._ensure_store()
    password_salt = auth_service._generate_password_salt()
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
                is_seeded,
                live_session_limit,
                live_session_used,
                session_token,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "account-manual-student",
                "Student One",
                "student01",
                "student one",
                auth_service._hash_password(
                    password="supersecure",
                    salt=password_salt,
                    scheme=auth_service.CURRENT_PASSWORD_SCHEME,
                ),
                password_salt,
                auth_service.CURRENT_PASSWORD_SCHEME,
                "student",
                0,
                10,
                0,
                "session-token-before-change",
                "2026-03-21T00:00:00+00:00",
            ),
        )

    account_id = "account-manual-student"

    update_response = client.put(
        f"/api/v1/auth/accounts/{account_id}",
        json={
            "name": "Student Prime",
            "username": "student.prime",
            "current_password": "supersecure",
            "new_password": "newsupersecure",
        },
    )

    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["name"] == "Student Prime"
    assert updated["username"] == "student.prime"
    assert updated["session_token"]
    assert updated["session_token"] != "session-token-before-change"

    old_sign_in = client.post(
        "/api/v1/auth/sign-in",
        json={
            "identifier": "student01",
            "password": "supersecure",
            "role": "student",
        },
    )
    assert old_sign_in.status_code == 404

    old_session_response = client.get(
        "/api/v1/auth/session",
        headers={
            "X-Account-Id": account_id,
            "X-Session-Token": "session-token-before-change",
        },
    )
    assert old_session_response.status_code == 403

    new_session_response = client.get(
        "/api/v1/auth/session",
        headers={
            "X-Account-Id": account_id,
            "X-Session-Token": updated["session_token"],
        },
    )
    assert new_session_response.status_code == 200
    assert new_session_response.json()["username"] == "student.prime"

    with sqlite3.connect(db_path) as connection:
        row = connection.execute(
            """
            SELECT name, username, password_scheme
            FROM auth_accounts
            WHERE id = ?
            """,
            (account_id,),
        ).fetchone()

    assert row is not None
    assert row[0] == "Student Prime"
    assert row[1] == "student.prime"
    assert row[2] == auth_service.CURRENT_PASSWORD_SCHEME


def test_learning_state_round_trip_persists_sessions_and_progress(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(auth_service, "AUTH_DB_PATH", tmp_path / "auth.db")
    monkeypatch.setattr(
        learning_state_service,
        "LEARNING_DB_PATH",
        tmp_path / "learning_state.db",
    )

    sign_in_response = client.post(
        "/api/v1/auth/sign-in",
        json={
            "identifier": "Student_1@gmail.com",
            "password": "Qwerty@123",
            "role": "student",
        },
    )
    assert sign_in_response.status_code == 200
    student = sign_in_response.json()

    session_payload = {
        "id": "session-demo-1",
        "procedureId": "simple-interrupted-suture",
        "ownerUsername": "someone-else@example.com",
        "skillLevel": "beginner",
        "practiceSurface": "foam pad",
        "simulationConfirmed": True,
        "learnerFocus": "needle entry consistency",
        "calibration": {
            "tl": {"x": 0, "y": 0},
            "tr": {"x": 1, "y": 0},
            "br": {"x": 1, "y": 1},
            "bl": {"x": 0, "y": 1},
        },
        "equityMode": {
            "enabled": False,
            "feedbackLanguage": "en",
            "audioCoaching": True,
            "coachVoice": "guide_female",
            "lowBandwidthMode": False,
            "cheapPhoneMode": False,
            "offlinePracticeLogging": True,
        },
        "events": [],
        "offlinePracticeLogs": [],
        "createdAt": "2026-03-21T00:00:00.000Z",
        "updatedAt": "2026-03-21T00:05:00.000Z",
    }

    session_response = client.put(
        "/api/v1/learning-state/sessions/session-demo-1",
        json={
            "account_id": student["id"],
            "session_token": student["session_token"],
            "session": session_payload,
            "make_active": True,
        },
    )
    assert session_response.status_code == 200
    assert session_response.json()["ownerUsername"] == "student_1@gmail.com"

    progress_response = client.put(
        "/api/v1/learning-state/knowledge-progress",
        json={
            "account_id": student["id"],
            "session_token": student["session_token"],
            "progress": {
                "answeredCount": 8,
                "completedQuizRounds": 2,
                "correctCount": 6,
                "flashcardsMastered": 4,
                "perfectRounds": 1,
                "rapidfireBestStreak": 5,
                "totalPoints": 120,
                "recentQuestionPrompts": [
                    "What matters most in needle entry?"
                ],
                "recentFlashcardFronts": [
                    "Needle Entry"
                ],
            },
        },
    )
    assert progress_response.status_code == 200
    assert progress_response.json()["totalPoints"] == 120
    assert progress_response.json()["recentQuestionPrompts"] == [
        "What matters most in needle entry?"
    ]

    snapshot_response = client.get(
        "/api/v1/learning-state",
        headers=auth_headers(student),
    )
    assert snapshot_response.status_code == 200
    snapshot = snapshot_response.json()
    assert snapshot["active_session_ids"] == {
        "simple-interrupted-suture": "session-demo-1"
    }
    assert snapshot["knowledge_progress"]["rapidfireBestStreak"] == 5
    assert snapshot["knowledge_progress"]["recentFlashcardFronts"] == ["Needle Entry"]
    assert len(snapshot["sessions"]) == 1
    assert snapshot["sessions"][0]["id"] == "session-demo-1"
    assert snapshot["sessions"][0]["ownerUsername"] == "student_1@gmail.com"


def test_learning_state_rejects_cross_account_session_id_takeover(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(auth_service, "AUTH_DB_PATH", tmp_path / "auth.db")
    monkeypatch.setattr(
        learning_state_service,
        "LEARNING_DB_PATH",
        tmp_path / "learning_state.db",
    )

    student_one_sign_in = client.post(
        "/api/v1/auth/sign-in",
        json={
            "identifier": "Student_1@gmail.com",
            "password": "Qwerty@123",
            "role": "student",
        },
    )
    assert student_one_sign_in.status_code == 200
    student_one = student_one_sign_in.json()

    student_two_sign_in = client.post(
        "/api/v1/auth/sign-in",
        json={
            "identifier": "Student_2@gmail.com",
            "password": "Qwerty@123",
            "role": "student",
        },
    )
    assert student_two_sign_in.status_code == 200
    student_two = student_two_sign_in.json()

    create_response = client.put(
        "/api/v1/learning-state/sessions/session-shared-id",
        json={
            "account_id": student_one["id"],
            "session_token": student_one["session_token"],
            "session": {
                "id": "session-shared-id",
                "procedureId": "simple-interrupted-suture",
                "skillLevel": "beginner",
                "calibration": {
                    "tl": {"x": 0, "y": 0},
                    "tr": {"x": 1, "y": 0},
                    "br": {"x": 1, "y": 1},
                    "bl": {"x": 0, "y": 1},
                },
                "equityMode": {
                    "enabled": False,
                    "feedbackLanguage": "en",
                    "audioCoaching": True,
                    "coachVoice": "guide_female",
                    "lowBandwidthMode": False,
                    "cheapPhoneMode": False,
                    "offlinePracticeLogging": True,
                },
                "events": [],
                "offlinePracticeLogs": [],
                "createdAt": "2026-03-21T00:00:00.000Z",
                "updatedAt": "2026-03-21T00:05:00.000Z",
            },
            "make_active": True,
        },
    )
    assert create_response.status_code == 200

    takeover_response = client.put(
        "/api/v1/learning-state/sessions/session-shared-id",
        json={
            "account_id": student_two["id"],
            "session_token": student_two["session_token"],
            "session": {
                "id": "session-shared-id",
                "procedureId": "simple-interrupted-suture",
                "skillLevel": "intermediate",
                "calibration": {
                    "tl": {"x": 0, "y": 0},
                    "tr": {"x": 1, "y": 0},
                    "br": {"x": 1, "y": 1},
                    "bl": {"x": 0, "y": 1},
                },
                "equityMode": {
                    "enabled": False,
                    "feedbackLanguage": "en",
                    "audioCoaching": True,
                    "coachVoice": "guide_female",
                    "lowBandwidthMode": False,
                    "cheapPhoneMode": False,
                    "offlinePracticeLogging": True,
                },
                "events": [],
                "offlinePracticeLogs": [],
                "createdAt": "2026-03-21T00:10:00.000Z",
                "updatedAt": "2026-03-21T00:15:00.000Z",
            },
            "make_active": True,
        },
    )
    assert takeover_response.status_code == 403


def test_learning_state_make_active_must_be_explicit(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(auth_service, "AUTH_DB_PATH", tmp_path / "auth.db")
    monkeypatch.setattr(
        learning_state_service,
        "LEARNING_DB_PATH",
        tmp_path / "learning_state.db",
    )

    sign_in_response = client.post(
        "/api/v1/auth/sign-in",
        json={
            "identifier": "Student_1@gmail.com",
            "password": "Qwerty@123",
            "role": "student",
        },
    )
    assert sign_in_response.status_code == 200
    student = sign_in_response.json()

    first_session_response = client.put(
        "/api/v1/learning-state/sessions/session-active-one",
        json={
            "account_id": student["id"],
            "session_token": student["session_token"],
            "session": {
                "id": "session-active-one",
                "procedureId": "simple-interrupted-suture",
                "skillLevel": "beginner",
                "calibration": {
                    "tl": {"x": 0, "y": 0},
                    "tr": {"x": 1, "y": 0},
                    "br": {"x": 1, "y": 1},
                    "bl": {"x": 0, "y": 1},
                },
                "equityMode": {
                    "enabled": False,
                    "feedbackLanguage": "en",
                    "audioCoaching": True,
                    "coachVoice": "guide_female",
                    "lowBandwidthMode": False,
                    "cheapPhoneMode": False,
                    "offlinePracticeLogging": True,
                },
                "events": [],
                "offlinePracticeLogs": [],
                "createdAt": "2026-03-21T00:00:00.000Z",
                "updatedAt": "2026-03-21T00:05:00.000Z",
            },
            "make_active": True,
        },
    )
    assert first_session_response.status_code == 200

    second_session_response = client.put(
        "/api/v1/learning-state/sessions/session-active-two",
        json={
            "account_id": student["id"],
            "session_token": student["session_token"],
            "session": {
                "id": "session-active-two",
                "procedureId": "simple-interrupted-suture",
                "skillLevel": "beginner",
                "calibration": {
                    "tl": {"x": 0, "y": 0},
                    "tr": {"x": 1, "y": 0},
                    "br": {"x": 1, "y": 1},
                    "bl": {"x": 0, "y": 1},
                },
                "equityMode": {
                    "enabled": False,
                    "feedbackLanguage": "en",
                    "audioCoaching": True,
                    "coachVoice": "guide_female",
                    "lowBandwidthMode": False,
                    "cheapPhoneMode": False,
                    "offlinePracticeLogging": True,
                },
                "events": [],
                "offlinePracticeLogs": [],
                "createdAt": "2026-03-21T00:10:00.000Z",
                "updatedAt": "2026-03-21T00:15:00.000Z",
            },
        },
    )
    assert second_session_response.status_code == 200

    snapshot_response = client.get(
        "/api/v1/learning-state",
        headers=auth_headers(student),
    )
    assert snapshot_response.status_code == 200
    assert snapshot_response.json()["active_session_ids"] == {
        "simple-interrupted-suture": "session-active-one"
    }


def test_learning_state_snapshot_normalizes_stale_stored_username(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(auth_service, "AUTH_DB_PATH", tmp_path / "auth.db")
    monkeypatch.setattr(
        learning_state_service,
        "LEARNING_DB_PATH",
        tmp_path / "learning_state.db",
    )

    sign_in_response = client.post(
        "/api/v1/auth/sign-in",
        json={
            "identifier": "Student_1@gmail.com",
            "password": "Qwerty@123",
            "role": "student",
        },
    )
    assert sign_in_response.status_code == 200
    student = sign_in_response.json()

    session_response = client.put(
        "/api/v1/learning-state/sessions/session-stale-username",
        json={
            "account_id": student["id"],
            "session_token": student["session_token"],
            "session": {
                "id": "session-stale-username",
                "procedureId": "simple-interrupted-suture",
                "ownerUsername": "student_1@gmail.com",
                "skillLevel": "beginner",
                "calibration": {
                    "tl": {"x": 0, "y": 0},
                    "tr": {"x": 1, "y": 0},
                    "br": {"x": 1, "y": 1},
                    "bl": {"x": 0, "y": 1},
                },
                "equityMode": {
                    "enabled": False,
                    "feedbackLanguage": "en",
                    "audioCoaching": True,
                    "coachVoice": "guide_female",
                    "lowBandwidthMode": False,
                    "cheapPhoneMode": False,
                    "offlinePracticeLogging": True,
                },
                "events": [],
                "offlinePracticeLogs": [],
                "createdAt": "2026-03-21T00:00:00.000Z",
                "updatedAt": "2026-03-21T00:05:00.000Z",
            },
        },
    )
    assert session_response.status_code == 200

    with sqlite3.connect(learning_state_service.LEARNING_DB_PATH) as connection:
        row = connection.execute(
            """
            SELECT payload_json
            FROM learning_sessions
            WHERE id = ?
            """,
            ("session-stale-username",),
        ).fetchone()
        assert row is not None
        payload = json.loads(row[0])
        payload["ownerUsername"] = "stale-user@example.com"
        connection.execute(
            """
            UPDATE learning_sessions
            SET payload_json = ?
            WHERE id = ?
            """,
            (json.dumps(payload), "session-stale-username"),
        )

    snapshot_response = client.get(
        "/api/v1/learning-state",
        headers=auth_headers(student),
    )
    assert snapshot_response.status_code == 200
    snapshot = snapshot_response.json()
    assert snapshot["sessions"][0]["ownerUsername"] == "student_1@gmail.com"


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


def test_knowledge_pack_route_returns_gamified_study_pack(monkeypatch) -> None:
    def fake_generate_knowledge_pack(_payload):
        return KnowledgePackResponse(
            study_mode="related_topics",
            topic_title="Needle Angle",
            title="Needle Entry Sprint",
            summary="A quick study pack for sharpening stage knowledge before practice.",
            recommended_focus="needle entry consistency",
            celebration_line="Strong round. Take that focus back into the trainer.",
            topic_suggestions=[
                {
                    "id": "needle-angle",
                    "label": "Needle Angle",
                    "description": "Practice confident entry and exit angles that stay visible.",
                    "study_mode": "related_topics",
                }
            ]
            * 6,
            rapidfire_rounds=[
                KnowledgeMultipleChoiceQuestion(
                    id="rapid-1",
                    stage_id="needle_entry",
                    prompt="What is the main goal of Needle Entry?",
                    choices=[
                        "Approach at a confident entry angle",
                        "Skip directly to knot tie",
                        "Hide the entry point",
                        "Ignore the practice line",
                    ],
                    correct_index=0,
                    explanation="The trainer wants a confident, visible first bite.",
                    point_value=10,
                    difficulty="warmup",
                )
            ]
            * 5,
            quiz_questions=[
                KnowledgeMultipleChoiceQuestion(
                    id="quiz-1",
                    stage_id="needle_exit",
                    prompt="Which cue belongs to Needle Exit?",
                    choices=[
                        "Arc completed across the wound line",
                        "Thread twisting during tie",
                        "Knot centered",
                        "Surface missing from frame",
                    ],
                    correct_index=0,
                    explanation="Needle Exit checks the far-side completion of the arc.",
                    point_value=18,
                    difficulty="core",
                )
            ]
            * 5,
            flashcards=[
                KnowledgeFlashcard(
                    id="flash-1",
                    stage_id="needle_entry",
                    front="Needle Entry",
                    back="Keep the entry point visible and the angle confident.",
                    memory_tip="Slow the first bite down until the angle looks repeatable.",
                    point_value=10,
                )
            ]
            * 6,
        )

    monkeypatch.setattr(
        knowledge_route.knowledge_service,
        "generate_knowledge_pack",
        fake_generate_knowledge_pack,
    )

    response = client.post(
        "/api/v1/knowledge-pack",
        json={
            "procedure_id": "simple-interrupted-suture",
            "skill_level": "beginner",
            "feedback_language": "en",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["study_mode"] == "related_topics"
    assert data["topic_title"] == "Needle Angle"
    assert data["title"] == "Needle Entry Sprint"
    assert len(data["topic_suggestions"]) == 6
    assert len(data["rapidfire_rounds"]) == 5
    assert len(data["quiz_questions"]) == 5
    assert len(data["flashcards"]) == 6


def test_tts_route_returns_audio_payload(monkeypatch) -> None:
    monkeypatch.setattr(
        tts_route.tts_service,
        "synthesize_speech",
        lambda _payload: tts_route.tts_service.SynthesizedSpeechAudio(
            audio_bytes=b"fake-mp3",
            media_type="audio/mpeg",
        ),
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
    assert response.headers["content-type"].startswith("audio/mpeg")
    assert response.content == b"fake-mp3"


def test_transcription_test_route_returns_transcript_and_latency(monkeypatch) -> None:
    monkeypatch.setattr(
        transcription_route.transcription_service,
        "transcribe_audio_clip",
        lambda **_kwargs: "Needle entry looks centered.",
    )

    response = client.post(
        "/api/v1/transcription/test",
        json={
            "audio_base64": "ZmFrZS13YXY=",
            "audio_format": "wav",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["transcript"] == "Needle entry looks centered."
    assert isinstance(payload["latency_ms"], int)
    assert payload["latency_ms"] >= 0
    assert payload["transcription_model"] == settings.transcription_model
    assert (
        payload["transcription_api_base_url"]
        == settings.transcription_api_base_url
    )
    assert payload["transcription_provider"]


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
        student_username="student.user",
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
    assert data[0]["student_username"] == "student.user"

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

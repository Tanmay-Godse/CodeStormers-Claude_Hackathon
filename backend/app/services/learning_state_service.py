import json
import sqlite3
from datetime import datetime, timezone
from typing import Any

from app.core.storage_paths import runtime_data_path
from app.schemas.learning_state import LearningStateSnapshot
from app.services import auth_service
from app.services.auth_service import (
    AuthAccountPreview,
    AuthPermissionError,
)

LEARNING_DB_PATH = runtime_data_path("learning_state.db")

DEFAULT_KNOWLEDGE_PROGRESS = {
    "answeredCount": 0,
    "completedQuizRounds": 0,
    "correctCount": 0,
    "flashcardsMastered": 0,
    "perfectRounds": 0,
    "rapidfireBestStreak": 0,
    "totalPoints": 0,
    "recentQuestionPrompts": [],
    "recentFlashcardFronts": [],
}


class LearningStateValidationError(ValueError):
    pass


def get_learning_state(
    *,
    account_id: str,
    session_token: str,
) -> LearningStateSnapshot:
    account = _authenticate_account(account_id=account_id, session_token=session_token)

    with _connect() as connection:
        session_rows = connection.execute(
            """
            SELECT payload_json
            FROM learning_sessions
            WHERE account_id = ?
            ORDER BY updated_at DESC, created_at DESC, id DESC
            """,
            (account.id,),
        ).fetchall()
        active_rows = connection.execute(
            """
            SELECT procedure_id, session_id
            FROM learning_active_sessions
            WHERE account_id = ?
            """,
            (account.id,),
        ).fetchall()
        progress_row = connection.execute(
            """
            SELECT payload_json
            FROM learning_knowledge_progress
            WHERE account_id = ?
            """,
            (account.id,),
        ).fetchone()

    sessions: list[dict[str, Any]] = []
    known_session_ids: set[str] = set()

    for row in session_rows:
        raw_payload = _loads_json(str(row["payload_json"]))
        normalized_session = _normalize_session_payload(
            session_id=str(raw_payload.get("id") or ""),
            session=raw_payload,
            owner_username=account.username,
        )
        sessions.append(normalized_session)
        known_session_ids.add(str(normalized_session["id"]))

    active_session_ids: dict[str, str] = {}
    for row in active_rows:
        session_id = str(row["session_id"])
        if session_id not in known_session_ids:
            continue
        active_session_ids[str(row["procedure_id"])] = session_id

    knowledge_progress = _normalize_knowledge_progress(
        _loads_json(str(progress_row["payload_json"])) if progress_row else None
    )

    return LearningStateSnapshot(
        sessions=sessions,
        active_session_ids=active_session_ids,
        knowledge_progress=knowledge_progress,
    )


def upsert_learning_session(
    *,
    session_id: str,
    account_id: str,
    session_token: str,
    session: dict[str, Any],
    make_active: bool = True,
) -> dict[str, Any]:
    account = _authenticate_account(account_id=account_id, session_token=session_token)
    normalized_session = _normalize_session_payload(
        session_id=session_id,
        session=session,
        owner_username=account.username,
    )
    normalized_updated_at = str(normalized_session["updatedAt"])

    with _connect() as connection:
        existing_row = connection.execute(
            """
            SELECT account_id, payload_json, updated_at
            FROM learning_sessions
            WHERE id = ?
            """,
            (session_id,),
        ).fetchone()

        if existing_row is not None and str(existing_row["account_id"]) != account.id:
            raise AuthPermissionError("This session belongs to another account.")

        if existing_row is not None and _compare_timestamps(
            str(existing_row["updated_at"]),
            normalized_updated_at,
        ) > 0:
            normalized_session = _normalize_session_payload(
                session_id=session_id,
                session=_loads_json(str(existing_row["payload_json"])),
                owner_username=account.username,
            )
        else:
            connection.execute(
                """
                INSERT INTO learning_sessions (
                    id,
                    account_id,
                    procedure_id,
                    payload_json,
                    created_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    account_id = excluded.account_id,
                    procedure_id = excluded.procedure_id,
                    payload_json = excluded.payload_json,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at
                """,
                (
                    session_id,
                    account.id,
                    str(normalized_session["procedureId"]),
                    json.dumps(normalized_session),
                    str(normalized_session["createdAt"]),
                    normalized_updated_at,
                ),
            )

        if make_active:
            connection.execute(
                """
                INSERT INTO learning_active_sessions (
                    account_id,
                    procedure_id,
                    session_id,
                    updated_at
                ) VALUES (?, ?, ?, ?)
                ON CONFLICT(account_id, procedure_id) DO UPDATE SET
                    session_id = excluded.session_id,
                    updated_at = excluded.updated_at
                """,
                (
                    account.id,
                    str(normalized_session["procedureId"]),
                    session_id,
                    normalized_updated_at,
                ),
            )

    return normalized_session


def upsert_knowledge_progress(
    *,
    account_id: str,
    session_token: str,
    progress: dict[str, Any],
) -> dict[str, Any]:
    account = _authenticate_account(account_id=account_id, session_token=session_token)
    normalized_progress = _normalize_knowledge_progress(progress)
    updated_at = _now_iso()

    with _connect() as connection:
        connection.execute(
            """
            INSERT INTO learning_knowledge_progress (
                account_id,
                payload_json,
                updated_at
            ) VALUES (?, ?, ?)
            ON CONFLICT(account_id) DO UPDATE SET
                payload_json = excluded.payload_json,
                updated_at = excluded.updated_at
            """,
            (
                account.id,
                json.dumps(normalized_progress),
                updated_at,
            ),
        )

    return normalized_progress


def _authenticate_account(*, account_id: str, session_token: str) -> AuthAccountPreview:
    account = auth_service._authenticate_actor(
        actor_account_id=account_id,
        actor_session_token=session_token,
        allow_any_signed_in=True,
    )
    if account.id != account_id:
        raise AuthPermissionError("You can only access your own learning state.")
    return account


def _normalize_session_payload(
    *,
    session_id: str,
    session: dict[str, Any],
    owner_username: str,
) -> dict[str, Any]:
    if not session_id or not isinstance(session_id, str):
        raise LearningStateValidationError("A valid session id is required.")
    if not isinstance(session, dict):
        raise LearningStateValidationError("Session payload must be an object.")

    procedure_id = session.get("procedureId")
    if not isinstance(procedure_id, str) or not procedure_id.strip():
        raise LearningStateValidationError("Session payload is missing procedureId.")

    skill_level = session.get("skillLevel")
    if skill_level not in {"beginner", "intermediate"}:
        raise LearningStateValidationError("Session payload is missing a valid skillLevel.")

    events = session.get("events")
    if not isinstance(events, list):
        raise LearningStateValidationError("Session payload is missing events.")

    created_at = session.get("createdAt")
    updated_at = session.get("updatedAt")
    if not isinstance(created_at, str) or not created_at.strip():
        raise LearningStateValidationError("Session payload is missing createdAt.")
    if not isinstance(updated_at, str) or not updated_at.strip():
        raise LearningStateValidationError("Session payload is missing updatedAt.")

    normalized_session = dict(session)
    normalized_session["id"] = session_id
    normalized_session["procedureId"] = procedure_id.strip()
    normalized_session["skillLevel"] = skill_level
    normalized_session["events"] = events
    normalized_session["createdAt"] = created_at
    normalized_session["updatedAt"] = updated_at
    normalized_session["ownerUsername"] = auth_service._normalize_username(owner_username)
    return normalized_session


def _normalize_knowledge_progress(progress: Any) -> dict[str, Any]:
    if progress is None:
        return dict(DEFAULT_KNOWLEDGE_PROGRESS)
    if not isinstance(progress, dict):
        raise LearningStateValidationError("Knowledge progress payload must be an object.")

    normalized_progress: dict[str, Any] = {}
    for key, default_value in DEFAULT_KNOWLEDGE_PROGRESS.items():
        value = progress.get(key, default_value)
        if isinstance(default_value, list):
            if not isinstance(value, list):
                normalized_progress[key] = list(default_value)
                continue
            cleaned_values: list[str] = []
            for item in value:
                if not isinstance(item, str):
                    continue
                cleaned = item.strip()
                if not cleaned or cleaned in cleaned_values:
                    continue
                cleaned_values.append(cleaned)
            normalized_progress[key] = cleaned_values[-80:]
            continue
        if not isinstance(value, int) or value < 0:
            normalized_progress[key] = default_value
            continue
        normalized_progress[key] = value
    return normalized_progress


def _loads_json(raw_value: str) -> dict[str, Any]:
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise LearningStateValidationError("Stored learning state is not valid JSON.") from exc

    if not isinstance(parsed, dict):
        raise LearningStateValidationError("Stored learning state must be an object.")
    return parsed


def _compare_timestamps(left_raw: str, right_raw: str) -> int:
    left = _parse_timestamp(left_raw)
    right = _parse_timestamp(right_raw)
    if left < right:
        return -1
    if left > right:
        return 1
    return 0


def _parse_timestamp(raw_value: str) -> datetime:
    normalized = raw_value.strip()
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"

    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise LearningStateValidationError(
            f"Timestamp '{raw_value}' is not a valid ISO-8601 datetime."
        ) from exc

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _connect() -> sqlite3.Connection:
    _ensure_store()
    connection = sqlite3.connect(LEARNING_DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def _ensure_store() -> None:
    LEARNING_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(LEARNING_DB_PATH) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS learning_sessions (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                procedure_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_learning_sessions_account_updated
            ON learning_sessions(account_id, updated_at DESC)
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS learning_active_sessions (
                account_id TEXT NOT NULL,
                procedure_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (account_id, procedure_id)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS learning_knowledge_progress (
                account_id TEXT PRIMARY KEY,
                payload_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

import hashlib
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.schemas.auth import (
    AuthAccountPreview,
    CreateAuthAccountRequest,
    SignInAuthRequest,
)

AUTH_DB_PATH = Path(__file__).resolve().parents[1] / "data" / "auth.db"
CURRENT_PASSWORD_SCHEME = "pbkdf2_sha256"
PASSWORD_SALT_BYTES = 16
PASSWORD_PBKDF2_ITERATIONS = 310_000


class AuthValidationError(ValueError):
    pass


class AuthAccountNotFoundError(LookupError):
    pass


class AuthAccountConflictError(RuntimeError):
    pass


class AuthDuplicateDisplayNameError(RuntimeError):
    pass


def preview_auth_account(identifier: str) -> AuthAccountPreview:
    _validate_identifier(identifier)

    account = _resolve_account(identifier)
    if account is None:
        raise AuthAccountNotFoundError(
            "No account was found for that username or display name."
        )

    return account


def create_auth_account(payload: CreateAuthAccountRequest) -> AuthAccountPreview:
    name = payload.name.strip()
    if not name:
        raise AuthValidationError("Display name is required.")

    username = _validate_username(payload.username)
    password = _validate_password(payload.password)
    created_at = _now_iso()
    account_id = f"account-{uuid4()}"
    normalized_display_name = _normalize_display_name(name)

    with _connect() as connection:
        try:
            password_salt = _generate_password_salt()
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
                    account_id,
                    name,
                    username,
                    normalized_display_name,
                    _hash_password(
                        password=password,
                        salt=password_salt,
                        scheme=CURRENT_PASSWORD_SCHEME,
                    ),
                    password_salt,
                    CURRENT_PASSWORD_SCHEME,
                    payload.role,
                    created_at,
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise AuthAccountConflictError(
                "That username is already registered. Sign in instead."
            ) from exc

    return AuthAccountPreview(
        id=account_id,
        name=name,
        username=username,
        role=payload.role,
        created_at=created_at,
    )


def sign_in_auth_user(payload: SignInAuthRequest) -> AuthAccountPreview:
    _validate_identifier(payload.identifier)
    password = _validate_password(payload.password)
    account = _resolve_account(payload.identifier)

    if account is None:
        raise AuthAccountNotFoundError(
            "No account was found for that username or display name."
        )

    password_state = _read_password_state(account.id)
    if not _verify_password(
        password=password,
        password_hash=str(password_state["password_hash"]),
        password_salt=(
            str(password_state["password_salt"])
            if password_state["password_salt"] is not None
            else None
        ),
        password_scheme=(
            str(password_state["password_scheme"])
            if password_state["password_scheme"] is not None
            else None
        ),
    ):
        raise AuthValidationError("Incorrect password. Try again.")

    if str(password_state["password_scheme"] or "sha256") != CURRENT_PASSWORD_SCHEME:
        _upgrade_password_hash(account.id, password)

    if payload.role and account.role != payload.role:
        raise AuthAccountConflictError(
            f"This account is registered as {account.role}. Switch roles or use a different account."
        )

    return account


def _resolve_account(identifier: str) -> AuthAccountPreview | None:
    normalized_identifier = _normalize_username(identifier)
    normalized_display_name = _normalize_display_name(identifier)

    with _connect() as connection:
        username_match = connection.execute(
            """
            SELECT id, name, username, role, created_at
            FROM auth_accounts
            WHERE username = ?
            """,
            (normalized_identifier,),
        ).fetchone()

        display_name_matches = connection.execute(
            """
            SELECT id, name, username, role, created_at
            FROM auth_accounts
            WHERE normalized_display_name = ?
            ORDER BY created_at ASC
            """,
            (normalized_display_name,),
        ).fetchall()

    if username_match is None and len(display_name_matches) > 1:
        raise AuthDuplicateDisplayNameError(
            "More than one workspace account uses that display name. Sign in with the username instead."
        )

    row = username_match or (display_name_matches[0] if display_name_matches else None)
    if row is None:
        return None

    return _row_to_preview(row)


def _read_password_state(account_id: str) -> sqlite3.Row:
    with _connect() as connection:
        row = connection.execute(
            """
            SELECT password_hash, password_salt, password_scheme
            FROM auth_accounts
            WHERE id = ?
            """,
            (account_id,),
        ).fetchone()

    if row is None:
        raise AuthAccountNotFoundError(f"Account '{account_id}' was not found.")

    return row


def _upgrade_password_hash(account_id: str, password: str) -> None:
    password_salt = _generate_password_salt()

    with _connect() as connection:
        connection.execute(
            """
            UPDATE auth_accounts
            SET password_hash = ?, password_salt = ?, password_scheme = ?
            WHERE id = ?
            """,
            (
                _hash_password(
                    password=password,
                    salt=password_salt,
                    scheme=CURRENT_PASSWORD_SCHEME,
                ),
                password_salt,
                CURRENT_PASSWORD_SCHEME,
                account_id,
            ),
        )


def _connect() -> sqlite3.Connection:
    _ensure_store()
    connection = sqlite3.connect(AUTH_DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def _ensure_store() -> None:
    AUTH_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(AUTH_DB_PATH) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS auth_accounts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                username TEXT NOT NULL UNIQUE,
                normalized_display_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                password_salt TEXT,
                password_scheme TEXT NOT NULL DEFAULT 'pbkdf2_sha256',
                role TEXT NOT NULL CHECK(role IN ('student', 'admin')),
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_auth_accounts_display_name
            ON auth_accounts(normalized_display_name)
            """
        )
        existing_columns = {
            str(row[1]) for row in connection.execute("PRAGMA table_info(auth_accounts)")
        }
        if "password_salt" not in existing_columns:
            connection.execute(
                "ALTER TABLE auth_accounts ADD COLUMN password_salt TEXT"
            )
        if "password_scheme" not in existing_columns:
            connection.execute(
                "ALTER TABLE auth_accounts ADD COLUMN password_scheme TEXT NOT NULL DEFAULT 'sha256'"
            )


def _row_to_preview(row: sqlite3.Row) -> AuthAccountPreview:
    return AuthAccountPreview(
        id=str(row["id"]),
        name=str(row["name"]),
        username=str(row["username"]),
        role=str(row["role"]),
        created_at=str(row["created_at"]),
    )


def _normalize_username(username: str) -> str:
    return username.strip().lower()


def _normalize_display_name(name: str) -> str:
    return " ".join(name.strip().lower().split())


def _validate_identifier(identifier: str) -> str:
    trimmed = identifier.strip()
    if len(trimmed) < 3:
        raise AuthValidationError(
            "Enter the username or display name for this workspace account."
        )
    return trimmed


def _validate_username(username: str) -> str:
    normalized = _normalize_username(username)
    if len(normalized) < 3:
        raise AuthValidationError("Username must be at least 3 characters.")
    if not all(character.isalnum() or character in "._@-" for character in normalized):
        raise AuthValidationError(
            "Username can use letters, numbers, periods, underscores, hyphens, and @."
        )
    return normalized


def _validate_password(password: str) -> str:
    if len(password) < 8:
        raise AuthValidationError("Password must be at least 8 characters.")
    return password


def _generate_password_salt() -> str:
    return secrets.token_hex(PASSWORD_SALT_BYTES)


def _hash_password(
    *,
    password: str,
    salt: str | None,
    scheme: str,
) -> str:
    if scheme == "sha256":
        return hashlib.sha256(password.encode("utf-8")).hexdigest()

    if scheme == CURRENT_PASSWORD_SCHEME:
        if not salt:
            raise AuthValidationError("The stored password salt is missing.")
        return hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            bytes.fromhex(salt),
            PASSWORD_PBKDF2_ITERATIONS,
        ).hex()

    raise AuthValidationError("The stored password scheme is not supported.")


def _verify_password(
    *,
    password: str,
    password_hash: str,
    password_salt: str | None,
    password_scheme: str | None,
) -> bool:
    normalized_scheme = (password_scheme or "sha256").strip().lower()
    candidate_hash = _hash_password(
        password=password,
        salt=password_salt,
        scheme=normalized_scheme,
    )
    return secrets.compare_digest(password_hash, candidate_hash)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

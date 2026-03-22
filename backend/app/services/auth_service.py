import hashlib
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from app.schemas.auth import (
    AuthAccountPreview,
    ConsumeLiveSessionRequest,
    CreateAuthAccountRequest,
    ResetLiveSessionLimitRequest,
    ResolveAdminRequest,
    SignInAuthRequest,
    UpdateAuthAccountRequest,
)

AUTH_DB_PATH = Path(__file__).resolve().parents[1] / "data" / "auth.db"
CURRENT_PASSWORD_SCHEME = "pbkdf2_sha256"
PASSWORD_SALT_BYTES = 16
PASSWORD_PBKDF2_ITERATIONS = 310_000
DEFAULT_LIVE_SESSION_LIMIT = 10

DEVELOPER_ACCOUNT_ID = "account-developer-team"
DEVELOPER_ACCOUNT_NAME = "Developer Team"
DEVELOPER_ACCOUNT_USERNAME = "developer@gmail.com"
DEVELOPER_ACCOUNT_PASSWORD = "Qwerty@123"

ADMIN_APPROVAL_PENDING = "pending"
ADMIN_APPROVAL_NONE = "none"
ADMIN_APPROVAL_REJECTED = "rejected"

PUBLIC_DEMO_ACCOUNTS: tuple[dict[str, object], ...] = (
    {
        "id": "account-demo-student-1",
        "name": "Student 1",
        "username": "student_1@gmail.com",
        "password": "Codestormers",
        "role": "student",
        "is_developer": False,
        "live_session_limit": DEFAULT_LIVE_SESSION_LIMIT,
    },
    {
        "id": "account-demo-student-2",
        "name": "Student 2",
        "username": "student_2@gmail.com",
        "password": "Codestormers",
        "role": "student",
        "is_developer": False,
        "live_session_limit": DEFAULT_LIVE_SESSION_LIMIT,
    },
    {
        "id": "account-demo-student-3",
        "name": "Student 3",
        "username": "student_3@gmail.com",
        "password": "Codestormers",
        "role": "student",
        "is_developer": False,
        "live_session_limit": DEFAULT_LIVE_SESSION_LIMIT,
    },
    {
        "id": "account-demo-student-4",
        "name": "Student 4",
        "username": "student_4@gmail.com",
        "password": "Codestormers",
        "role": "student",
        "is_developer": False,
        "live_session_limit": DEFAULT_LIVE_SESSION_LIMIT,
    },
)

INTERNAL_TEAM_ACCOUNTS: tuple[dict[str, object], ...] = (
    {
        "id": "account-team-tanmay",
        "name": "Tanmay",
        "username": "tanmay@gmail.com",
        "password": "QwertY@123",
        "role": "admin",
        "is_developer": False,
        "live_session_limit": DEFAULT_LIVE_SESSION_LIMIT,
    },
    {
        "id": "account-team-tanay",
        "name": "Tanay",
        "username": "tanay@gmail.com",
        "password": "QwertY@123",
        "role": "admin",
        "is_developer": False,
        "live_session_limit": DEFAULT_LIVE_SESSION_LIMIT,
    },
    {
        "id": "account-team-khyati",
        "name": "Khyati",
        "username": "khyati@gmail.com",
        "password": "QwertY@123",
        "role": "admin",
        "is_developer": False,
        "live_session_limit": DEFAULT_LIVE_SESSION_LIMIT,
    },
    {
        "id": "account-team-amitesh",
        "name": "Amitesh",
        "username": "amitesh@gmail.com",
        "password": "QwertY@123",
        "role": "admin",
        "is_developer": False,
        "live_session_limit": DEFAULT_LIVE_SESSION_LIMIT,
    },
)


class AuthValidationError(ValueError):
    pass


class AuthAccountNotFoundError(LookupError):
    pass


class AuthAccountConflictError(RuntimeError):
    pass


class AuthDuplicateDisplayNameError(RuntimeError):
    pass


class AuthPermissionError(PermissionError):
    pass


def preview_auth_account(identifier: str) -> AuthAccountPreview:
    normalized_identifier = _validate_identifier(identifier)
    account = _resolve_account_by_username(normalized_identifier)

    if account is None:
        raise AuthAccountNotFoundError(
            "That username is not available in this demo. Please contact the developers for a fixed demo email."
        )

    return account


def create_auth_account(_payload: CreateAuthAccountRequest) -> AuthAccountPreview:
    raise AuthPermissionError(
        "Self-service account creation is disabled for this demo. Please contact the developers for a fixed demo email."
    )


def sign_in_auth_user(payload: SignInAuthRequest) -> AuthAccountPreview:
    identifier = _validate_identifier(payload.identifier)
    password = _validate_password(payload.password)
    account = _resolve_account_by_username(identifier)

    if account is None:
        raise AuthAccountNotFoundError(
            "That username is not available in this demo. Please contact the developers for a fixed demo email."
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
            f"This account is registered as {account.role}. Use the matching workspace."
        )

    session_token = _issue_session_token(account.id)
    refreshed_account = _resolve_account_by_id(
        account.id,
        include_session_token=True,
    )
    if refreshed_account is None:
        raise AuthAccountNotFoundError(f"Account '{account.id}' was not found.")

    if not refreshed_account.session_token:
        refreshed_account = refreshed_account.model_copy(
            update={"session_token": session_token}
        )

    return refreshed_account


def list_pending_admin_requests(
    developer_account_id: str,
    developer_session_token: str,
) -> list[AuthAccountPreview]:
    developer = _authenticate_actor(
        actor_account_id=developer_account_id,
        actor_session_token=developer_session_token,
        developer_only=True,
    )

    with _connect() as connection:
        rows = connection.execute(
            """
            SELECT id, name, username, role, is_developer, is_seeded, requested_role,
                   admin_approval_status, live_session_limit, live_session_used,
                   created_at, session_token
            FROM auth_accounts
            WHERE requested_role = 'admin' AND admin_approval_status = 'pending'
            ORDER BY created_at ASC
            """
        ).fetchall()

    return [_row_to_preview(row) for row in rows if not developer.id == str(row["id"])]


def resolve_admin_request(
    *,
    target_account_id: str,
    payload: ResolveAdminRequest,
    approved: bool,
) -> AuthAccountPreview:
    _authenticate_actor(
        actor_account_id=payload.developer_account_id,
        actor_session_token=payload.developer_session_token,
        developer_only=True,
    )

    target_account = _resolve_account_by_id(target_account_id)
    if target_account is None:
        raise AuthAccountNotFoundError(f"Account '{target_account_id}' was not found.")
    if target_account.is_developer:
        raise AuthPermissionError("The fixed developer account cannot be changed here.")
    if target_account.requested_role != "admin":
        raise AuthValidationError("That account does not have an admin access request.")

    next_role = "admin" if approved else "student"
    next_requested_role = None if approved else "admin"
    next_status = ADMIN_APPROVAL_NONE if approved else ADMIN_APPROVAL_REJECTED

    with _connect() as connection:
        connection.execute(
            """
            UPDATE auth_accounts
            SET role = ?, requested_role = ?, admin_approval_status = ?
            WHERE id = ?
            """,
            (next_role, next_requested_role, next_status, target_account_id),
        )

    updated = _resolve_account_by_id(target_account_id)
    if updated is None:
        raise AuthAccountNotFoundError(f"Account '{target_account_id}' was not found.")
    return updated


def update_auth_account(
    account_id: str,
    payload: UpdateAuthAccountRequest,
) -> AuthAccountPreview:
    account = _resolve_account_by_id(account_id, include_session_token=True)
    if account is None:
        raise AuthAccountNotFoundError(f"Account '{account_id}' was not found.")
    if account.is_developer or account.is_seeded:
        raise AuthPermissionError(
            "This fixed demo account is managed by the developer team and cannot be edited from the profile page."
        )

    name = payload.name.strip()
    if not name:
        raise AuthValidationError("Display name is required.")

    username = _validate_username(payload.username)
    if username == DEVELOPER_ACCOUNT_USERNAME:
        raise AuthAccountConflictError(
            "That developer account email is reserved and cannot be assigned here."
        )
    current_password = _validate_password(payload.current_password)
    new_password = (
        _validate_password(payload.new_password)
        if payload.new_password is not None and payload.new_password.strip()
        else None
    )

    password_state = _read_password_state(account.id)
    if not _verify_password(
        password=current_password,
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
        raise AuthValidationError("Current password is incorrect.")

    password_salt = None
    password_hash = None
    password_scheme = None
    if new_password is not None:
        password_salt = _generate_password_salt()
        password_hash = _hash_password(
            password=new_password,
            salt=password_salt,
            scheme=CURRENT_PASSWORD_SCHEME,
        )
        password_scheme = CURRENT_PASSWORD_SCHEME

    with _connect() as connection:
        try:
            if new_password is not None:
                connection.execute(
                    """
                    UPDATE auth_accounts
                    SET name = ?, username = ?, normalized_display_name = ?,
                        password_hash = ?, password_salt = ?, password_scheme = ?
                    WHERE id = ?
                    """,
                    (
                        name,
                        username,
                        _normalize_display_name(name),
                        password_hash,
                        password_salt,
                        password_scheme,
                        account_id,
                    ),
                )
            else:
                connection.execute(
                    """
                    UPDATE auth_accounts
                    SET name = ?, username = ?, normalized_display_name = ?
                    WHERE id = ?
                    """,
                    (
                        name,
                        username,
                        _normalize_display_name(name),
                        account_id,
                    ),
                )
        except sqlite3.IntegrityError as exc:
            raise AuthAccountConflictError(
                "That username is already registered. Choose a different username."
            ) from exc

    updated = _resolve_account_by_id(account_id, include_session_token=True)
    if updated is None:
        raise AuthAccountNotFoundError(f"Account '{account_id}' was not found.")
    return updated


def list_live_session_accounts(
    actor_account_id: str,
    actor_session_token: str,
) -> list[AuthAccountPreview]:
    _authenticate_actor(
        actor_account_id=actor_account_id,
        actor_session_token=actor_session_token,
        allowed_roles={"admin"},
        allow_developer=True,
    )

    with _connect() as connection:
        rows = connection.execute(
            """
            SELECT id, name, username, role, is_developer, is_seeded, requested_role,
                   admin_approval_status, live_session_limit, live_session_used,
                   created_at, session_token
            FROM auth_accounts
            WHERE is_seeded = 1 AND is_developer = 0
            ORDER BY CASE role WHEN 'student' THEN 0 ELSE 1 END, username ASC
            """
        ).fetchall()

    return [_row_to_preview(row) for row in rows]


def consume_live_session(payload: ConsumeLiveSessionRequest) -> AuthAccountPreview:
    account = _authenticate_actor(
        actor_account_id=payload.account_id,
        actor_session_token=payload.session_token,
        allow_any_signed_in=True,
    )

    if account.live_session_limit is None:
        return account

    if account.live_session_remaining is not None and account.live_session_remaining <= 0:
        raise AuthPermissionError(
            "This demo account has reached its live-session limit. Please contact an admin or developer to reset it."
        )

    with _connect() as connection:
        connection.execute(
            """
            UPDATE auth_accounts
            SET live_session_used = live_session_used + 1
            WHERE id = ?
            """,
            (account.id,),
        )

    updated = _resolve_account_by_id(account.id, include_session_token=True)
    if updated is None:
        raise AuthAccountNotFoundError(f"Account '{account.id}' was not found.")
    return updated


def reset_live_session_limit(
    target_account_id: str,
    payload: ResetLiveSessionLimitRequest,
) -> AuthAccountPreview:
    _authenticate_actor(
        actor_account_id=payload.actor_account_id,
        actor_session_token=payload.actor_session_token,
        allowed_roles={"admin"},
        allow_developer=True,
    )

    target_account = _resolve_account_by_id(target_account_id)
    if target_account is None:
        raise AuthAccountNotFoundError(f"Account '{target_account_id}' was not found.")
    if target_account.live_session_limit is None:
        raise AuthValidationError("This account does not use a capped live-session limit.")

    with _connect() as connection:
        connection.execute(
            """
            UPDATE auth_accounts
            SET live_session_used = 0
            WHERE id = ?
            """,
            (target_account_id,),
        )

    updated = _resolve_account_by_id(target_account_id)
    if updated is None:
        raise AuthAccountNotFoundError(f"Account '{target_account_id}' was not found.")
    return updated


def _resolve_account_by_username(
    username: str,
    *,
    seeded_only: bool = True,
    include_session_token: bool = False,
) -> AuthAccountPreview | None:
    normalized_username = _normalize_username(username)

    with _connect() as connection:
        if seeded_only:
            row = connection.execute(
                """
                SELECT id, name, username, role, is_developer, is_seeded, requested_role,
                       admin_approval_status, live_session_limit, live_session_used,
                       created_at, session_token
                FROM auth_accounts
                WHERE username = ? AND (is_seeded = 1 OR is_developer = 1)
                """,
                (normalized_username,),
            ).fetchone()
        else:
            row = connection.execute(
                """
                SELECT id, name, username, role, is_developer, is_seeded, requested_role,
                       admin_approval_status, live_session_limit, live_session_used,
                       created_at, session_token
                FROM auth_accounts
                WHERE username = ?
                """,
                (normalized_username,),
            ).fetchone()

    if row is None:
        return None

    return _row_to_preview(row, include_session_token=include_session_token)


def _resolve_account_by_id(
    account_id: str,
    *,
    include_session_token: bool = False,
) -> AuthAccountPreview | None:
    with _connect() as connection:
        row = connection.execute(
            """
            SELECT id, name, username, role, is_developer, is_seeded, requested_role,
                   admin_approval_status, live_session_limit, live_session_used,
                   created_at, session_token
            FROM auth_accounts
            WHERE id = ?
            """,
            (account_id,),
        ).fetchone()

    if row is None:
        return None

    return _row_to_preview(row, include_session_token=include_session_token)


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


def _issue_session_token(account_id: str) -> str:
    session_token = secrets.token_urlsafe(32)

    with _connect() as connection:
        connection.execute(
            """
            UPDATE auth_accounts
            SET session_token = ?
            WHERE id = ?
            """,
            (session_token, account_id),
        )

    return session_token


def _authenticate_actor(
    *,
    actor_account_id: str,
    actor_session_token: str,
    allowed_roles: set[str] | None = None,
    allow_developer: bool = False,
    developer_only: bool = False,
    allow_any_signed_in: bool = False,
) -> AuthAccountPreview:
    account = _resolve_account_by_id(actor_account_id, include_session_token=True)
    if account is None:
        raise AuthAccountNotFoundError(f"Account '{actor_account_id}' was not found.")

    if not account.session_token or not secrets.compare_digest(
        account.session_token,
        actor_session_token,
    ):
        raise AuthPermissionError("Sign in again before performing this action.")

    if allow_any_signed_in:
        return account

    if developer_only:
        if not account.is_developer:
            raise AuthPermissionError(
                "Only the fixed developer account can perform this action."
            )
        return account

    if account.is_developer and allow_developer:
        return account

    if allowed_roles and account.role in allowed_roles:
        return account

    raise AuthPermissionError("This account does not have access to that action.")


def _connect() -> sqlite3.Connection:
    _ensure_store()
    connection = sqlite3.connect(AUTH_DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def _ensure_store() -> None:
    AUTH_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(AUTH_DB_PATH) as connection:
        connection.row_factory = sqlite3.Row
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
        if "is_developer" not in existing_columns:
            connection.execute(
                "ALTER TABLE auth_accounts ADD COLUMN is_developer INTEGER NOT NULL DEFAULT 0"
            )
        if "is_seeded" not in existing_columns:
            connection.execute(
                "ALTER TABLE auth_accounts ADD COLUMN is_seeded INTEGER NOT NULL DEFAULT 0"
            )
        if "requested_role" not in existing_columns:
            connection.execute(
                "ALTER TABLE auth_accounts ADD COLUMN requested_role TEXT"
            )
        if "admin_approval_status" not in existing_columns:
            connection.execute(
                f"ALTER TABLE auth_accounts ADD COLUMN admin_approval_status TEXT NOT NULL DEFAULT '{ADMIN_APPROVAL_NONE}'"
            )
        if "live_session_limit" not in existing_columns:
            connection.execute(
                "ALTER TABLE auth_accounts ADD COLUMN live_session_limit INTEGER"
            )
        if "live_session_used" not in existing_columns:
            connection.execute(
                "ALTER TABLE auth_accounts ADD COLUMN live_session_used INTEGER NOT NULL DEFAULT 0"
            )
        if "session_token" not in existing_columns:
            connection.execute(
                "ALTER TABLE auth_accounts ADD COLUMN session_token TEXT"
            )

        _ensure_seeded_accounts(connection)


def _ensure_seeded_accounts(connection: sqlite3.Connection) -> None:
    seeded_accounts = (
        {
            "id": DEVELOPER_ACCOUNT_ID,
            "name": DEVELOPER_ACCOUNT_NAME,
            "username": DEVELOPER_ACCOUNT_USERNAME,
            "password": DEVELOPER_ACCOUNT_PASSWORD,
            "role": "admin",
            "is_developer": True,
            "live_session_limit": None,
        },
        *PUBLIC_DEMO_ACCOUNTS,
        *INTERNAL_TEAM_ACCOUNTS,
    )

    for seed in seeded_accounts:
        _upsert_seeded_account(connection, seed)


def _upsert_seeded_account(
    connection: sqlite3.Connection,
    seed: dict[str, object],
) -> None:
    username = _normalize_username(str(seed["username"]))
    account_id = str(seed["id"])
    existing = connection.execute(
        """
        SELECT id, created_at
        FROM auth_accounts
        WHERE username = ? OR id = ?
        ORDER BY CASE WHEN username = ? THEN 0 ELSE 1 END
        LIMIT 1
        """,
        (username, account_id, username),
    ).fetchone()

    password_salt = _generate_password_salt()
    password_hash = _hash_password(
        password=str(seed["password"]),
        salt=password_salt,
        scheme=CURRENT_PASSWORD_SCHEME,
    )
    created_at = str(existing["created_at"]) if existing is not None else _now_iso()

    if existing is None:
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
                is_developer,
                is_seeded,
                requested_role,
                admin_approval_status,
                live_session_limit,
                live_session_used,
                session_token,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                account_id,
                str(seed["name"]),
                username,
                _normalize_display_name(str(seed["name"])),
                password_hash,
                password_salt,
                CURRENT_PASSWORD_SCHEME,
                str(seed["role"]),
                1 if bool(seed["is_developer"]) else 0,
                1,
                None,
                ADMIN_APPROVAL_NONE,
                seed["live_session_limit"],
                0,
                None,
                created_at,
            ),
        )
        return

    connection.execute(
        """
        UPDATE auth_accounts
        SET id = ?, name = ?, username = ?, normalized_display_name = ?,
            password_hash = ?, password_salt = ?, password_scheme = ?, role = ?,
            is_developer = ?, is_seeded = 1, requested_role = NULL,
            admin_approval_status = ?, live_session_limit = ?
        WHERE id = ?
        """,
        (
            account_id,
            str(seed["name"]),
            username,
            _normalize_display_name(str(seed["name"])),
            password_hash,
            password_salt,
            CURRENT_PASSWORD_SCHEME,
            str(seed["role"]),
            1 if bool(seed["is_developer"]) else 0,
            ADMIN_APPROVAL_NONE,
            seed["live_session_limit"],
            str(existing["id"]),
        ),
    )


def _row_to_preview(
    row: sqlite3.Row,
    *,
    include_session_token: bool = False,
) -> AuthAccountPreview:
    live_session_limit = (
        int(row["live_session_limit"])
        if row["live_session_limit"] is not None
        else None
    )
    live_session_used = int(row["live_session_used"] or 0)
    live_session_remaining = (
        max(live_session_limit - live_session_used, 0)
        if live_session_limit is not None
        else None
    )

    return AuthAccountPreview(
        id=str(row["id"]),
        name=str(row["name"]),
        username=str(row["username"]),
        role=str(row["role"]),
        is_developer=bool(row["is_developer"]),
        is_seeded=bool(row["is_seeded"]),
        requested_role=(
            str(row["requested_role"]) if row["requested_role"] is not None else None
        ),
        admin_approval_status=str(row["admin_approval_status"] or ADMIN_APPROVAL_NONE),
        live_session_limit=live_session_limit,
        live_session_used=live_session_used,
        live_session_remaining=live_session_remaining,
        session_token=(
            str(row["session_token"]) if include_session_token and row["session_token"] else None
        ),
        created_at=str(row["created_at"]),
    )


def _normalize_username(username: str) -> str:
    return username.strip().lower()


def _normalize_display_name(name: str) -> str:
    return " ".join(name.strip().lower().split())


def _validate_identifier(identifier: str) -> str:
    trimmed = _normalize_username(identifier)
    if len(trimmed) < 3:
        raise AuthValidationError("Enter the username for this workspace account.")
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

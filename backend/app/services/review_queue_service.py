import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.schemas.analyze import SafetyGateResult
from app.schemas.review import HumanReviewCase, ResolveReviewCaseRequest

REVIEW_CASES_PATH = Path(__file__).resolve().parents[1] / "data" / "review_cases.json"


class ReviewCaseNotFoundError(LookupError):
    pass


def list_review_cases(
    *,
    status: str | None = None,
    session_id: str | None = None,
) -> list[HumanReviewCase]:
    cases = _load_cases()

    if status:
        cases = [case for case in cases if case.status == status]
    if session_id:
        cases = [case for case in cases if case.session_id == session_id]

    return sorted(cases, key=lambda case: case.created_at, reverse=True)


def create_review_case(
    *,
    source: str,
    session_id: str | None,
    procedure_id: str,
    stage_id: str,
    skill_level: str,
    student_name: str | None,
    trigger_reason: str,
    analysis_blocked: bool,
    initial_step_status: str | None,
    confidence: float | None,
    coaching_message: str | None,
    safety_gate: SafetyGateResult,
) -> HumanReviewCase:
    case = HumanReviewCase(
        id=f"review-{uuid4()}",
        status="pending",
        source=source,
        session_id=session_id,
        procedure_id=procedure_id,
        stage_id=stage_id,
        skill_level=skill_level,
        student_name=student_name,
        created_at=_now_iso(),
        trigger_reason=trigger_reason,
        analysis_blocked=analysis_blocked,
        initial_step_status=initial_step_status,
        confidence=confidence,
        coaching_message=coaching_message,
        safety_gate=safety_gate,
    )

    cases = _load_cases()
    cases.append(case)
    _save_cases(cases)
    return case


def resolve_review_case(
    case_id: str,
    payload: ResolveReviewCaseRequest,
) -> HumanReviewCase:
    cases = _load_cases()

    for index, case in enumerate(cases):
        if case.id != case_id:
            continue

        updated_case = case.model_copy(
            update={
                "status": "resolved",
                "reviewer_name": payload.reviewer_name.strip(),
                "reviewer_notes": payload.reviewer_notes.strip(),
                "corrected_step_status": payload.corrected_step_status,
                "corrected_coaching_message": _strip_optional(
                    payload.corrected_coaching_message
                ),
                "rubric_feedback": _strip_optional(payload.rubric_feedback),
                "resolved_at": _now_iso(),
            }
        )
        cases[index] = updated_case
        _save_cases(cases)
        return updated_case

    raise ReviewCaseNotFoundError(f"Review case '{case_id}' was not found.")


def _load_cases() -> list[HumanReviewCase]:
    _ensure_store()
    raw = REVIEW_CASES_PATH.read_text(encoding="utf-8")
    data = json.loads(raw)
    return [HumanReviewCase.model_validate(item) for item in data]


def _save_cases(cases: list[HumanReviewCase]) -> None:
    _ensure_store()
    payload = [case.model_dump(mode="json") for case in cases]
    REVIEW_CASES_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _ensure_store() -> None:
    REVIEW_CASES_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not REVIEW_CASES_PATH.exists():
        REVIEW_CASES_PATH.write_text("[]", encoding="utf-8")


def _strip_optional(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

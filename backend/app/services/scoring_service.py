from app.schemas.analyze import Issue
from app.schemas.procedure import ProcedureStage

SEVERITY_PENALTY = {"low": 1, "medium": 2, "high": 4}
UNCLEAR_IMAGE_PENALTY = 3


class InvalidOverlayTargetError(ValueError):
    pass


def validate_overlay_target_ids(
    stage: ProcedureStage,
    overlay_target_ids: list[str],
) -> list[str]:
    allowed_targets = set(stage.overlay_targets)
    unknown_targets = [
        target_id for target_id in overlay_target_ids if target_id not in allowed_targets
    ]

    if unknown_targets:
        joined_targets = ", ".join(sorted(set(unknown_targets)))
        raise InvalidOverlayTargetError(
            f"The model server returned overlay target ids that are not allowed for stage '{stage.id}': {joined_targets}."
        )

    deduped_targets: list[str] = []
    for target_id in overlay_target_ids:
        if target_id not in deduped_targets:
            deduped_targets.append(target_id)

    return deduped_targets


def compute_score_delta(
    stage: ProcedureStage,
    step_status: str,
    issues: list[Issue],
) -> int:
    if step_status == "unsafe":
        return 0

    base_score = stage.score_weight
    if step_status == "unclear":
        base_score = max(0, base_score - UNCLEAR_IMAGE_PENALTY)

    issue_penalty = sum(SEVERITY_PENALTY.get(issue.severity, 0) for issue in issues)
    return max(0, base_score - issue_penalty)

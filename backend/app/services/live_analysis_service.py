from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from threading import Lock
from time import time

from app.schemas.analyze import (
    AnalyzeFrameRequest,
    AnalyzeFrameResponse,
    AnalyzeLiveFrameRequest,
    TemporalAnalysisState,
)
from app.services import analysis_service

LIVE_ANALYSIS_STATE_TTL_MS = 30_000
# Keep enough recent samples to preserve a full smoothing window at ~600 ms cadence.
MAX_RECENT_ANALYSES = 10


@dataclass
class TimedAnalysisResult:
    analyzed_at_ms: int
    response: AnalyzeFrameResponse


@dataclass
class LiveAnalysisState:
    last_seen_at_ms: int
    last_analysis_at_ms: int | None = None
    recent_results: deque[TimedAnalysisResult] = field(
        default_factory=lambda: deque(maxlen=MAX_RECENT_ANALYSES)
    )


_STATE_LOCK = Lock()
_LIVE_ANALYSIS_STATES: dict[str, LiveAnalysisState] = {}


def analyze_live_frame_payload(payload: AnalyzeLiveFrameRequest) -> AnalyzeFrameResponse:
    now_ms = _now_ms()
    base_payload = AnalyzeFrameRequest.model_validate(
        payload.model_dump(
            mode="json",
            exclude={"force_refresh", "min_analysis_interval_ms", "state_window_ms"},
        )
    )
    state_key = _build_state_key(payload)

    with _STATE_LOCK:
        _cleanup_expired_states(now_ms)
        state = _LIVE_ANALYSIS_STATES.setdefault(
            state_key,
            LiveAnalysisState(last_seen_at_ms=now_ms),
        )
        state.last_seen_at_ms = now_ms
        _trim_recent_results(state, now_ms, payload.state_window_ms)
        should_refresh = (
            payload.force_refresh
            or not state.recent_results
            or state.last_analysis_at_ms is None
            or now_ms - state.last_analysis_at_ms >= payload.min_analysis_interval_ms
        )
        cached_results = list(state.recent_results)

    if should_refresh:
        fresh_response = analysis_service.analyze_frame_payload(
            base_payload,
            monitoring_only=True,
        )
        fresh_response = fresh_response.model_copy(update={"temporal_state": None})

        with _STATE_LOCK:
            state = _LIVE_ANALYSIS_STATES.setdefault(
                state_key,
                LiveAnalysisState(last_seen_at_ms=now_ms),
            )
            state.last_seen_at_ms = now_ms
            state.last_analysis_at_ms = now_ms
            _trim_recent_results(state, now_ms, payload.state_window_ms)
            state.recent_results.append(
                TimedAnalysisResult(
                    analyzed_at_ms=now_ms,
                    response=fresh_response,
                )
            )
            cached_results = list(state.recent_results)

    if not cached_results:
        fallback_response = analysis_service.analyze_frame_payload(
            base_payload,
            monitoring_only=True,
        )
        return _attach_temporal_state(
            response=fallback_response,
            temporal_state=TemporalAnalysisState(
                analysis_source="fresh",
                dominant_step_status=fallback_response.step_status,
                recent_analysis_count=1,
                stability=1.0,
                analysis_window_ms=0,
                next_recommended_check_ms=payload.min_analysis_interval_ms,
            ),
        )

    return _build_temporal_response(
        results=cached_results,
        now_ms=now_ms,
        request=payload,
        ran_fresh_analysis=should_refresh,
    )


def clear_live_analysis_states() -> None:
    with _STATE_LOCK:
        _LIVE_ANALYSIS_STATES.clear()


def _now_ms() -> int:
    return int(time() * 1000)


def _build_state_key(payload: AnalyzeLiveFrameRequest) -> str:
    session_key = (
        payload.session_id
        or payload.student_username
        or payload.student_name
        or "anonymous-live-session"
    )
    return f"{session_key}:{payload.procedure_id}:{payload.stage_id}"


def _cleanup_expired_states(now_ms: int) -> None:
    expired_keys = [
        key
        for key, state in _LIVE_ANALYSIS_STATES.items()
        if now_ms - state.last_seen_at_ms > LIVE_ANALYSIS_STATE_TTL_MS
    ]
    for key in expired_keys:
        _LIVE_ANALYSIS_STATES.pop(key, None)


def _trim_recent_results(
    state: LiveAnalysisState,
    now_ms: int,
    state_window_ms: int,
) -> None:
    while state.recent_results:
        oldest = state.recent_results[0]
        if now_ms - oldest.analyzed_at_ms <= state_window_ms:
            break
        state.recent_results.popleft()


def _build_temporal_response(
    *,
    results: list[TimedAnalysisResult],
    now_ms: int,
    request: AnalyzeLiveFrameRequest,
    ran_fresh_analysis: bool,
) -> AnalyzeFrameResponse:
    latest = results[-1]
    weighted_scores = _build_weighted_status_scores(
        results=results,
        now_ms=now_ms,
        state_window_ms=request.state_window_ms,
    )
    dominant_step_status = max(
        weighted_scores,
        key=lambda status: (
            weighted_scores[status],
            1 if status == latest.response.step_status else 0,
        ),
    )
    total_weight = sum(weighted_scores.values()) or 1.0
    stability = max(0.0, min(1.0, weighted_scores[dominant_step_status] / total_weight))
    dominant_candidates = [
        result
        for result in results
        if result.response.step_status == dominant_step_status
    ]
    dominant = max(
        dominant_candidates,
        key=lambda result: (result.response.confidence, result.analyzed_at_ms),
    )

    if len(results) == 1:
        analysis_source = "fresh" if ran_fresh_analysis else "cached"
        response = latest.response
    elif latest.response.step_status == dominant_step_status and stability >= 0.72:
        analysis_source = "fresh" if ran_fresh_analysis else "cached"
        response = latest.response
    else:
        analysis_source = "smoothed"
        response = dominant.response.model_copy(
            update={
                "visible_observations": _merge_visible_observations(results),
                "issues": dominant.response.issues,
                "confidence": _average_confidence(results, dominant_step_status),
                "grading_decision": (
                    dominant.response.grading_decision
                    if stability >= 0.8
                    else "not_graded"
                ),
                "grading_reason": (
                    dominant.response.grading_reason
                    if stability >= 0.8
                    else "The live monitor is blending recent frames before grading a stable state."
                ),
                "score_delta": (
                    dominant.response.score_delta
                    if stability >= 0.8
                    else 0
                ),
            }
        )

    next_recommended_check_ms = max(
        0,
        request.min_analysis_interval_ms - max(0, now_ms - latest.analyzed_at_ms),
    )
    temporal_state = TemporalAnalysisState(
        analysis_source=analysis_source,
        dominant_step_status=dominant_step_status,
        recent_analysis_count=len(results),
        stability=round(stability, 3),
        analysis_window_ms=(
            max(0, latest.analyzed_at_ms - results[0].analyzed_at_ms)
            if len(results) > 1
            else 0
        ),
        next_recommended_check_ms=next_recommended_check_ms,
    )
    return _attach_temporal_state(response=response, temporal_state=temporal_state)


def _build_weighted_status_scores(
    *,
    results: list[TimedAnalysisResult],
    now_ms: int,
    state_window_ms: int,
) -> dict[str, float]:
    scores = {
        "pass": 0.0,
        "retry": 0.0,
        "unclear": 0.0,
        "unsafe": 0.0,
    }

    safe_window_ms = max(1, state_window_ms)
    for result in results:
        age_ms = max(0, now_ms - result.analyzed_at_ms)
        age_ratio = min(1.0, age_ms / safe_window_ms)
        recency_weight = max(0.4, 1.0 - (age_ratio * 0.5))
        confidence_weight = max(0.25, result.response.confidence)
        scores[result.response.step_status] += recency_weight * confidence_weight

    return scores


def _average_confidence(
    results: list[TimedAnalysisResult],
    step_status: str,
) -> float:
    matching = [
        result.response.confidence
        for result in results
        if result.response.step_status == step_status
    ]
    if not matching:
        return results[-1].response.confidence
    return round(sum(matching) / len(matching), 3)


def _merge_visible_observations(results: list[TimedAnalysisResult]) -> list[str]:
    merged: list[str] = []
    for result in reversed(results):
        for item in result.response.visible_observations:
            candidate = item.strip()
            if candidate and candidate not in merged:
                merged.append(candidate)
            if len(merged) >= 4:
                return merged
    return merged


def _attach_temporal_state(
    *,
    response: AnalyzeFrameResponse,
    temporal_state: TemporalAnalysisState,
) -> AnalyzeFrameResponse:
    return response.model_copy(update={"temporal_state": temporal_state})

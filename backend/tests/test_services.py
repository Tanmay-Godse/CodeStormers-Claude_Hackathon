import pytest

from app.schemas.analyze import AnalyzeFrameRequest, SafetyGateResult
from app.schemas.coach import CoachChatMessage, CoachChatRequest
from app.schemas.debrief import DebriefRequest, DebriefEvent
from app.schemas.knowledge import KnowledgePackRequest
from app.schemas.review import ResolveReviewCaseRequest
from app.services import analysis_service, coach_service, debrief_service, knowledge_service
from app.services.ai_client import AIRequestError, AIResponseError
from app.services import review_queue_service, safety_service


def make_cleared_safety_gate() -> SafetyGateResult:
    return SafetyGateResult(
        status="cleared",
        confidence=0.97,
        reason="The image cleared the simulation-only safety screen.",
        refusal_message=None,
    )


def test_analysis_service_rejects_unknown_overlay_targets(monkeypatch) -> None:
    monkeypatch.setattr(
        safety_service,
        "evaluate_safety_gate",
        lambda **_: make_cleared_safety_gate(),
    )
    monkeypatch.setattr(
        analysis_service,
        "send_json_message",
        lambda **_: {
            "step_status": "retry",
            "confidence": 0.82,
            "visible_observations": [
                "entry zone is visible",
                "needle angle looks shallow",
            ],
            "issues": [
                {
                    "code": "angle_shallow",
                    "severity": "medium",
                    "message": "The angle is too shallow.",
                }
            ],
            "coaching_message": "Rotate upward before retrying.",
            "next_action": "Capture a second attempt.",
            "overlay_target_ids": ["not_a_real_target"],
        },
    )

    payload = AnalyzeFrameRequest(
        procedure_id="simple-interrupted-suture",
        stage_id="needle_entry",
        skill_level="beginner",
        image_base64="ZmFrZQ==",
        simulation_confirmation=True,
    )

    with pytest.raises(AIResponseError, match="not allowed for stage 'needle_entry'"):
        analysis_service.analyze_frame_payload(payload)


def test_debrief_service_returns_local_fallback_for_empty_session() -> None:
    response = debrief_service.generate_session_debrief(
        DebriefRequest(
            session_id="session-123",
            procedure_id="simple-interrupted-suture",
            skill_level="beginner",
            events=[],
        )
    )

    assert len(response.strengths) == 3
    assert len(response.improvement_areas) == 3
    assert len(response.practice_plan) == 3
    assert len(response.equity_support_plan) == 3
    assert response.audio_script
    assert len(response.quiz) == 3


def test_analysis_service_backfills_trimmed_response_fields(monkeypatch) -> None:
    monkeypatch.setattr(
        safety_service,
        "evaluate_safety_gate",
        lambda **_: make_cleared_safety_gate(),
    )
    monkeypatch.setattr(
        analysis_service,
        "send_json_message",
        lambda **_: {
            "step_status": "retry",
            "confidence": 0.82,
            "visible_observations": [
                "  ",
                "needle angle looks shallow",
            ],
            "issues": [],
            "coaching_message": "   ",
            "next_action": "   ",
            "overlay_target_ids": [],
        },
    )

    payload = AnalyzeFrameRequest(
        procedure_id="simple-interrupted-suture",
        stage_id="needle_entry",
        skill_level="beginner",
        image_base64="ZmFrZQ==",
        simulation_confirmation=True,
    )

    response = analysis_service.analyze_frame_payload(payload)

    assert len(response.visible_observations) >= 2
    assert all(item.strip() for item in response.visible_observations)
    assert response.coaching_message
    assert response.next_action


def test_analysis_service_accepts_setup_when_simulation_surface_is_cleared(monkeypatch) -> None:
    monkeypatch.setattr(
        safety_service,
        "evaluate_safety_gate",
        lambda **_: make_cleared_safety_gate(),
    )
    monkeypatch.setattr(
        analysis_service,
        "send_json_message",
        lambda **_: {
            "step_status": "retry",
            "confidence": 0.61,
            "visible_observations": [
                "orange practice surface is visible",
                "needle driver is partly visible",
            ],
            "issues": [
                {
                    "code": "tool_partial",
                    "severity": "low",
                    "message": "The tool is only partly visible.",
                }
            ],
            "coaching_message": "Bring the tool slightly higher in frame.",
            "next_action": "Capture another setup frame.",
            "overlay_target_ids": ["surface_center"],
        },
    )

    response = analysis_service.analyze_frame_payload(
        AnalyzeFrameRequest(
            procedure_id="simple-interrupted-suture",
            stage_id="setup",
            skill_level="beginner",
            image_base64="ZmFrZQ==",
            simulation_confirmation=True,
            practice_surface="Any fruit or foam pad",
        )
    )

    assert response.step_status == "pass"
    assert response.grading_decision == "graded"
    assert response.issues == []
    assert response.overlay_target_ids == ["surface_center"]
    assert "setup looks ready" in response.coaching_message.lower()


def test_debrief_service_falls_back_when_ai_request_fails(monkeypatch) -> None:
    monkeypatch.setattr(
        debrief_service,
        "send_json_message",
        lambda **_: (_ for _ in ()).throw(AIRequestError("boom")),
    )

    response = debrief_service.generate_session_debrief(
        DebriefRequest(
            session_id="session-123",
            procedure_id="simple-interrupted-suture",
            skill_level="beginner",
            events=[
                DebriefEvent(
                    stage_id="needle_entry",
                    attempt=1,
                    step_status="retry",
                    issues=[],
                    score_delta=8,
                    coaching_message="Rotate upward before retrying.",
                    overlay_target_ids=["entry_point"],
                    visible_observations=["entry zone is visible"],
                    next_action="Capture a second attempt.",
                    confidence=0.84,
                    created_at="2026-03-20T17:10:00.000Z",
                )
            ],
        )
    )

    assert len(response.strengths) == 3
    assert len(response.practice_plan) == 3
    assert len(response.equity_support_plan) == 3
    assert response.audio_script
    assert len(response.quiz) == 3
    assert "needle entry" in response.practice_plan[0].lower()


def test_debrief_service_backfills_quiz_when_ai_payload_is_partial(monkeypatch) -> None:
    monkeypatch.setattr(
        debrief_service,
        "send_json_message",
        lambda **_: {
            "strengths": [
                "You kept the field centered.",
                "Your tool stayed visible.",
                "You logged a useful retry.",
            ],
            "improvement_areas": [
                "Improve the angle.",
                "Keep the arc smoother.",
                "Retake any blurry frame.",
            ],
            "practice_plan": [
                "Retry the entry stage once.",
                "Use the overlay before advancing.",
                "Reopen review after the retry.",
            ],
            "equity_support_plan": [
                "Use low-bandwidth mode when needed.",
                "Replay audio coaching for accessibility.",
                "Keep logging attempts offline if the network drops.",
            ],
            "audio_script": "Quick recap. Retry the entry stage once.",
            "quiz": [
                {
                    "question": "   ",
                    "answer": "",
                }
            ],
        },
    )

    response = debrief_service.generate_session_debrief(
        DebriefRequest(
            session_id="session-123",
            procedure_id="simple-interrupted-suture",
            skill_level="beginner",
            events=[
                DebriefEvent(
                    stage_id="needle_entry",
                    attempt=1,
                    step_status="retry",
                    issues=[],
                    score_delta=8,
                    coaching_message="Rotate upward before retrying.",
                    overlay_target_ids=["entry_point"],
                    visible_observations=["entry zone is visible"],
                    next_action="Capture a second attempt.",
                    confidence=0.84,
                    created_at="2026-03-20T17:10:00.000Z",
                )
            ],
        )
    )

    assert response.strengths[0] == "You kept the field centered."
    assert response.audio_script == "Quick recap. Retry the entry stage once."
    assert len(response.quiz) == 3


def test_debrief_service_localizes_fallback_response() -> None:
    response = debrief_service.generate_session_debrief(
        DebriefRequest(
            session_id="session-456",
            procedure_id="simple-interrupted-suture",
            skill_level="beginner",
            feedback_language="es",
            events=[],
        )
    )

    assert response.feedback_language == "es"
    assert "simulacion" in response.strengths[0].lower()
    assert "coaching" in response.audio_script.lower() or "resumen" in response.audio_script.lower()


def test_knowledge_service_falls_back_when_ai_request_fails(monkeypatch) -> None:
    monkeypatch.setattr(
        knowledge_service,
        "send_json_message",
        lambda **_: (_ for _ in ()).throw(AIRequestError("boom")),
    )

    response = knowledge_service.generate_knowledge_pack(
        KnowledgePackRequest(
            procedure_id="simple-interrupted-suture",
            skill_level="beginner",
            feedback_language="en",
            focus_area="needle entry consistency",
            recent_issue_labels=["angle too shallow"],
        )
    )

    assert "knowledge lab" in response.title.lower()
    assert response.study_mode == "current_procedure"
    assert response.topic_title
    assert len(response.topic_suggestions) >= 4
    assert len(response.rapidfire_rounds) == 5
    assert len(response.quiz_questions) == 5
    assert len(response.flashcards) == 6
    assert response.recommended_focus == "needle entry consistency"


def test_knowledge_service_backfills_partial_ai_payload(monkeypatch) -> None:
    monkeypatch.setattr(
        knowledge_service,
        "send_json_message",
        lambda **_: {
            "study_mode": "related_topics",
            "topic_title": "Needle Angle",
            "title": "Needle Entry Sprint",
            "summary": "Quick review pack.",
            "recommended_focus": "entry angle",
            "celebration_line": "Nice round.",
            "topic_suggestions": [
                {
                    "id": "needle-angle",
                    "label": "Needle Angle",
                    "description": "Practice confident entry and exit angles that stay visible.",
                    "study_mode": "related_topics",
                }
            ],
            "rapidfire_rounds": [
                {
                    "id": "rapid-1",
                    "stage_id": "needle_entry",
                    "prompt": "What matters most in needle entry?",
                    "choices": [
                        "Angle control",
                        "Ignore framing",
                        "Skip setup",
                        "Tie immediately",
                    ],
                    "correct_index": 0,
                    "explanation": "Entry angle affects the first bite.",
                    "point_value": 12,
                    "difficulty": "warmup",
                }
            ],
            "quiz_questions": [],
            "flashcards": [
                {
                    "id": "flash-1",
                    "stage_id": "needle_entry",
                    "front": "Needle Entry",
                    "back": "Keep the entry point visible.",
                    "memory_tip": "Slow down before the bite.",
                    "point_value": 10,
                }
            ],
        },
    )

    response = knowledge_service.generate_knowledge_pack(
        KnowledgePackRequest(
            procedure_id="simple-interrupted-suture",
            skill_level="beginner",
        )
    )

    assert response.title == "Needle Entry Sprint"
    assert response.study_mode == "related_topics"
    assert response.topic_title == "Needle Angle"
    assert response.summary == "Quick review pack."
    assert len(response.topic_suggestions) >= 4
    assert len(response.rapidfire_rounds) == 5
    assert len(response.quiz_questions) == 5
    assert len(response.flashcards) == 6
    assert response.rapidfire_rounds[0].prompt == "What matters most in needle entry?"


def test_knowledge_service_passes_seen_history_to_model(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_send_json_message(**kwargs):
        captured["request"] = kwargs
        return {
            "study_mode": "current_procedure",
            "topic_title": "Procedure Overview",
            "title": "Fresh Suturing Round",
            "summary": "Brand-new study prompts.",
            "recommended_focus": "needle entry consistency",
            "celebration_line": "New round ready.",
            "topic_suggestions": [],
            "rapidfire_rounds": [],
            "quiz_questions": [],
            "flashcards": [],
        }

    monkeypatch.setattr(
        knowledge_service,
        "send_json_message",
        fake_send_json_message,
    )

    knowledge_service.generate_knowledge_pack(
        KnowledgePackRequest(
            procedure_id="simple-interrupted-suture",
            skill_level="beginner",
            avoid_question_prompts=["What matters most in needle entry?"],
            avoid_flashcard_fronts=["Needle Entry"],
            generation_nonce="round-42",
        )
    )

    request = captured["request"]
    assert isinstance(request, dict)
    user_content = request["user_content"]
    assert isinstance(user_content, list)
    text_block = user_content[0]
    assert isinstance(text_block, dict)
    assert "What matters most in needle entry?" in text_block["text"]
    assert "Needle Entry" in text_block["text"]
    assert "round-42" in text_block["text"]


def test_knowledge_service_freshens_repeated_prompt_from_history(monkeypatch) -> None:
    monkeypatch.setattr(
        knowledge_service,
        "send_json_message",
        lambda **_: {
            "study_mode": "current_procedure",
            "topic_title": "Procedure Overview",
            "title": "Procedure Overview knowledge lab",
            "summary": "A new round.",
            "recommended_focus": "needle entry consistency",
            "celebration_line": "Fresh round.",
            "topic_suggestions": [],
            "rapidfire_rounds": [
                {
                    "id": "rapid-1",
                    "stage_id": "needle_entry",
                    "prompt": "What is the main goal of the Needle Entry stage?",
                    "choices": [
                        "Approach at a confident entry angle",
                        "Skip directly to knot tie",
                        "Hide the entry point",
                        "Ignore the practice line",
                    ],
                    "correct_index": 0,
                    "explanation": "The trainer wants a confident, visible first bite.",
                    "point_value": 10,
                    "difficulty": "warmup",
                }
            ]
            * 5,
            "quiz_questions": [],
            "flashcards": [],
        },
    )

    response = knowledge_service.generate_knowledge_pack(
        KnowledgePackRequest(
            procedure_id="simple-interrupted-suture",
            skill_level="beginner",
            avoid_question_prompts=[
                "What is the main goal of the Needle Entry stage?"
            ],
        )
    )

    assert response.rapidfire_rounds[0].prompt != "What is the main goal of the Needle Entry stage?"


def test_coach_service_transcribes_audio_before_sending_to_model(monkeypatch) -> None:
    captured = {}

    def fake_send_json_message(**kwargs):
        captured["request"] = kwargs
        return {
            "conversation_stage": "planning",
            "coach_message": "Thanks. We will work on entry angle first.",
            "plan_summary": "Plan: focus on entry angle and steady framing.",
            "suggested_next_step": "Center the field and take one slow attempt.",
            "camera_observations": [],
            "stage_focus": ["Needle Entry"],
            "learner_goal_summary": "Improve my entry angle",
        }

    monkeypatch.setattr(
        coach_service,
        "send_json_message",
        fake_send_json_message,
    )
    monkeypatch.setattr(
        coach_service.transcription_service,
        "transcribe_audio_clip",
        lambda **_: "Improve my entry angle",
    )

    response = coach_service.generate_coach_turn(
        CoachChatRequest(
            procedure_id="simple-interrupted-suture",
            stage_id="needle_entry",
            skill_level="beginner",
            audio_base64="UklGRg==",
            audio_format="wav",
            messages=[],
        )
    )

    assert response.learner_goal_summary == "Improve my entry angle"
    assert response.learner_transcript == "Improve my entry angle"
    assert len(captured["request"]["user_content"]) == 1
    assert captured["request"]["user_content"][0]["type"] == "text"
    assert "Improve my entry angle" in captured["request"]["user_content"][0]["text"]

def test_coach_service_blocks_when_transcription_fails(monkeypatch) -> None:
    monkeypatch.setattr(
        coach_service.transcription_service,
        "transcribe_audio_clip",
        lambda **_: (_ for _ in ()).throw(
            AIRequestError("The transcription endpoint returned an empty transcript.")
        ),
    )

    response = coach_service.generate_coach_turn(
        CoachChatRequest(
            procedure_id="simple-interrupted-suture",
            stage_id="needle_entry",
            skill_level="beginner",
            audio_base64="UklGRg==",
            audio_format="wav",
            messages=[],
        )
    )

    assert response.conversation_stage == "blocked"
    assert "transcribe" in response.coach_message.lower()
    assert "empty transcript" in response.coach_message.lower()
    assert "type" in response.plan_summary.lower()
    assert response.learner_goal_summary == ""
    assert response.learner_transcript == ""


def test_coach_service_fallback_waits_for_learner_after_assistant_turn() -> None:
    response = coach_service._build_fallback_response(
        payload=CoachChatRequest(
            procedure_id="simple-interrupted-suture",
            stage_id="needle_entry",
            skill_level="beginner",
            simulation_confirmation=True,
            messages=[
                CoachChatMessage(
                    role="assistant",
                    content="Tilt the needle slightly left and show the entry point again.",
                )
            ],
        ),
        procedure=coach_service.load_procedure("simple-interrupted-suture"),
        stage=coach_service.load_stage(
            coach_service.load_procedure("simple-interrupted-suture"),
            "needle_entry",
        ),
    )

    assert response.conversation_stage == "guiding"
    assert "show the" in response.coach_message.lower()
    assert "when you are ready" in response.coach_message.lower()
    assert "wait for the learner" in response.plan_summary.lower()


def test_coach_service_fallback_uses_learner_focus_when_no_new_user_message() -> None:
    response = coach_service._build_fallback_response(
        payload=CoachChatRequest(
            procedure_id="simple-interrupted-suture",
            stage_id="needle_entry",
            skill_level="beginner",
            simulation_confirmation=True,
            learner_focus="needle entry consistency",
            messages=[],
        ),
        procedure=coach_service.load_procedure("simple-interrupted-suture"),
        stage=coach_service.load_stage(
            coach_service.load_procedure("simple-interrupted-suture"),
            "needle_entry",
        ),
    )

    assert response.conversation_stage == "guiding"
    assert "needle entry consistency" in response.coach_message.lower()
    assert "needle entry consistency" in response.plan_summary.lower()
    assert response.learner_goal_summary == "needle entry consistency"
    assert response.learner_transcript == ""


def test_coach_service_fallback_answers_latest_learner_question() -> None:
    response = coach_service._build_fallback_response(
        payload=CoachChatRequest(
            procedure_id="simple-interrupted-suture",
            stage_id="needle_entry",
            skill_level="beginner",
            simulation_confirmation=True,
            image_base64="ZmFrZQ==",
            messages=[
                CoachChatMessage(
                    role="user",
                    content="Am I too shallow on the entry?",
                )
            ],
        ),
        procedure=coach_service.load_procedure("simple-interrupted-suture"),
        stage=coach_service.load_stage(
            coach_service.load_procedure("simple-interrupted-suture"),
            "needle_entry",
        ),
    )

    assert response.conversation_stage == "guiding"
    assert "good question" in response.coach_message.lower()
    assert "real time" in response.coach_message.lower()
    assert "show" in response.suggested_next_step.lower()
    assert response.learner_goal_summary == "Needle Entry guidance"
    assert response.learner_transcript == "Am I too shallow on the entry?"


def test_safety_service_blocks_without_simulation_confirmation() -> None:
    payload = AnalyzeFrameRequest(
        procedure_id="simple-interrupted-suture",
        stage_id="needle_entry",
        skill_level="beginner",
        image_base64="ZmFrZQ==",
        simulation_confirmation=False,
    )

    procedure = analysis_service.load_procedure("simple-interrupted-suture")
    stage = analysis_service.load_stage(procedure, "needle_entry")
    result = safety_service.evaluate_safety_gate(
        payload=payload,
        procedure=procedure,
        stage=stage,
    )

    assert result.status == "blocked"
    assert "confirmation" in result.reason.lower()


def test_safety_service_allows_visible_learner_in_nonclinical_scene(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        safety_service,
        "send_json_message",
        lambda **_: {
            "status": "blocked",
            "confidence": 0.94,
            "reason": (
                "The image shows a person with a real human face and upper body in a casual indoor environment. "
                "No orange, banana, foam pad, or tools are visible yet."
            ),
            "refusal_message": (
                "Analysis was blocked because the image may depict a real patient or live clinical scene."
            ),
        },
    )

    payload = AnalyzeFrameRequest(
        procedure_id="simple-interrupted-suture",
        stage_id="needle_entry",
        skill_level="beginner",
        image_base64="ZmFrZQ==",
        simulation_confirmation=True,
    )

    procedure = analysis_service.load_procedure("simple-interrupted-suture")
    stage = analysis_service.load_stage(procedure, "needle_entry")
    result = safety_service.evaluate_safety_gate(
        payload=payload,
        procedure=procedure,
        stage=stage,
    )

    assert result.status == "cleared"
    assert "learner or bystander" in result.reason.lower()
    assert result.refusal_message is None


def test_safety_service_does_not_block_benign_or_word_in_student_question(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        safety_service,
        "send_json_message",
        lambda **_: {
            "status": "cleared",
            "confidence": 0.91,
            "reason": "The image appears to be a simulation-only practice scene.",
            "refusal_message": None,
        },
    )

    payload = AnalyzeFrameRequest(
        procedure_id="simple-interrupted-suture",
        stage_id="needle_entry",
        skill_level="beginner",
        image_base64="ZmFrZQ==",
        student_question="Should I enter closer to the center or the edge?",
        simulation_confirmation=True,
    )

    procedure = analysis_service.load_procedure("simple-interrupted-suture")
    stage = analysis_service.load_stage(procedure, "needle_entry")
    result = safety_service.evaluate_safety_gate(
        payload=payload,
        procedure=procedure,
        stage=stage,
    )

    assert result.status == "cleared"


def test_safety_service_clears_setup_when_classifier_fails(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        safety_service,
        "send_json_message",
        lambda **_: (_ for _ in ()).throw(AIRequestError("boom")),
    )

    payload = AnalyzeFrameRequest(
        procedure_id="simple-interrupted-suture",
        stage_id="setup",
        skill_level="beginner",
        image_base64="ZmFrZQ==",
        simulation_confirmation=True,
        practice_surface="Any fruit or foam pad",
    )

    procedure = analysis_service.load_procedure("simple-interrupted-suture")
    stage = analysis_service.load_stage(procedure, "setup")
    result = safety_service.evaluate_safety_gate(
        payload=payload,
        procedure=procedure,
        stage=stage,
    )

    assert result.status == "cleared"
    assert "setup stage was allowed" in result.reason.lower()
    assert result.refusal_message is None


def test_review_queue_service_resolves_case(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(
        review_queue_service,
        "REVIEW_CASES_PATH",
        tmp_path / "review_cases.json",
    )

    created_case = review_queue_service.create_review_case(
        source="safety_gate",
        session_id="session-123",
        procedure_id="simple-interrupted-suture",
        stage_id="needle_entry",
        skill_level="beginner",
        student_name="Student User",
        student_username="student.user",
        trigger_reason="The scene may depict a live clinical setting.",
        analysis_blocked=True,
        initial_step_status="unsafe",
        confidence=0.94,
        coaching_message="Analysis was blocked.",
        safety_gate=SafetyGateResult(
          status="blocked",
          confidence=0.94,
          reason="The scene may depict a live clinical setting.",
          refusal_message="Analysis was blocked.",
        ),
    )

    resolved_case = review_queue_service.resolve_review_case(
        created_case.id,
        payload=ResolveReviewCaseRequest(
            reviewer_name="Faculty Reviewer",
            reviewer_notes="Good block. Keep the safety gate strict.",
            corrected_step_status="unsafe",
            corrected_coaching_message="Do not analyze real-patient imagery.",
            rubric_feedback="Preserve this refusal pattern.",
        ),
    )

    assert resolved_case.status == "resolved"
    assert resolved_case.reviewer_name == "Faculty Reviewer"
    assert resolved_case.student_username == "student.user"

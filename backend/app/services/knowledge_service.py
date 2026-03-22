import json
from typing import Any

from app.core.config import settings
from app.schemas.knowledge import (
    KnowledgeFlashcard,
    KnowledgeMultipleChoiceQuestion,
    KnowledgePackRequest,
    KnowledgePackResponse,
    KnowledgeStudyMode,
    KnowledgeTopicSuggestion,
)
from app.schemas.procedure import ProcedureDefinition, ProcedureStage
from app.services.ai_client import (
    AIConfigurationError,
    AIRequestError,
    AIResponseError,
    send_json_message,
)
from app.services.procedure_loader import load_procedure


def generate_knowledge_pack(payload: KnowledgePackRequest) -> KnowledgePackResponse:
    procedure = load_procedure(payload.procedure_id)
    fallback_response = _build_fallback_knowledge_pack(payload, procedure)

    try:
        response_data = send_json_message(
            model=settings.ai_learning_model,
            max_tokens=settings.ai_learning_max_tokens,
            system_prompt=_build_knowledge_system_prompt(payload, procedure),
            user_content=_build_knowledge_user_content(payload, procedure),
            output_schema=KnowledgePackResponse.model_json_schema(),
        )
    except (AIConfigurationError, AIRequestError, AIResponseError):
        return fallback_response

    return _normalize_knowledge_pack(response_data, fallback_response)


def _build_knowledge_system_prompt(
    payload: KnowledgePackRequest,
    procedure: ProcedureDefinition,
) -> str:
    selected_topic = _clean_text(payload.selected_topic)
    topic_instruction = (
        f"Center the pack on the selected topic '{selected_topic}'. "
        if selected_topic
        else ""
    )
    return (
        "You are an engaging clinical skills study coach. "
        f"Generate a compact, gamified knowledge pack for the simulation-only procedure '{procedure.title}'. "
        f"Return every learner-facing field in the requested language '{payload.feedback_language}'. "
        f"The current study mode is '{payload.study_mode}'. "
        f"{topic_instruction}"
        "Keep the content educational, concise, motivating, and student-friendly for a hackathon demo. "
        "The pack must include a rapidfire round, a deeper quiz, flashcards, and topic suggestions. "
        "Current procedure mode should stay close to the stage rubric. "
        "Related topics mode may branch into adjacent concepts like instrument handling, framing, spacing, and error recognition, while still staying relevant to the procedure. "
        "Common mistakes mode should help the learner recognize repeated misses and how to reset. "
        "Use only simulation-safe teaching points from the procedure rubric. "
        "Do not provide patient-care instructions, diagnoses, or live-clinical guidance. "
        "Prefer clear, concrete technique cues over trivia."
    )


def _build_knowledge_user_content(
    payload: KnowledgePackRequest,
    procedure: ProcedureDefinition,
) -> list[dict[str, Any]]:
    suggestions = _build_topic_suggestions(payload, procedure)
    summary = {
        "procedure_id": procedure.id,
        "procedure_title": procedure.title,
        "practice_surface": procedure.practice_surface,
        "skill_level": payload.skill_level,
        "feedback_language": payload.feedback_language,
        "learner_name": payload.learner_name,
        "focus_area": payload.focus_area,
        "study_mode": payload.study_mode,
        "selected_topic": payload.selected_topic,
        "recent_issue_labels": payload.recent_issue_labels,
        "topic_suggestions": [topic.model_dump(mode="json") for topic in suggestions],
        "stages": [stage.model_dump(mode="json") for stage in procedure.stages],
        "overlay_targets": [
            target.model_dump(mode="json") for target in procedure.named_overlay_targets
        ],
        "requirements": {
            "rapidfire_rounds": 5,
            "quiz_questions": 5,
            "flashcards": 6,
            "topic_suggestions": 6,
        },
    }

    return [
        {
            "type": "text",
            "text": (
                "Build a gamified study pack that helps the learner review stage goals, "
                "related technique concepts, and common misses in a student-friendly way. "
                "Use short answer options, stage-aware explanations, flashcards that are easy to remember, "
                "and practical topic suggestions the learner could choose next.\n\n"
                f"{json.dumps(summary, indent=2)}"
            ),
        }
    ]


def _build_fallback_knowledge_pack(
    payload: KnowledgePackRequest,
    procedure: ProcedureDefinition,
) -> KnowledgePackResponse:
    suggestions = _build_topic_suggestions(payload, procedure)
    selected_topic = _resolve_selected_topic(payload, suggestions)
    focus_area = _clean_text(payload.focus_area) or selected_topic.label

    rapidfire = _build_fallback_rapidfire(procedure, payload.study_mode, selected_topic)
    quiz = _build_fallback_quiz(procedure, payload.study_mode, selected_topic)
    flashcards = _build_fallback_flashcards(procedure, payload.study_mode, selected_topic)

    return KnowledgePackResponse(
        study_mode=payload.study_mode,
        topic_title=selected_topic.label,
        title=f"{selected_topic.label} knowledge lab",
        summary=_fallback_summary(payload.study_mode, procedure.title, selected_topic.label),
        recommended_focus=focus_area,
        celebration_line=_fallback_celebration_line(payload.study_mode),
        topic_suggestions=suggestions,
        rapidfire_rounds=rapidfire,
        quiz_questions=quiz,
        flashcards=flashcards,
    )


def _fallback_summary(
    study_mode: KnowledgeStudyMode,
    procedure_title: str,
    topic_label: str,
) -> str:
    if study_mode == "related_topics":
        return (
            f"Branch out from {procedure_title} and study '{topic_label}' with quick prompts that still support the next live session."
        )
    if study_mode == "common_mistakes":
        return (
            f"Use '{topic_label}' to practice spotting repeated misses before you go back into the trainer."
        )
    return (
        f"Stay close to the live {procedure_title} rubric and review '{topic_label}' before the next rep."
    )


def _fallback_celebration_line(study_mode: KnowledgeStudyMode) -> str:
    if study_mode == "related_topics":
        return "Nice round. Bring one of these supporting concepts back into the next live rep."
    if study_mode == "common_mistakes":
        return "Good catch. Spotting misses earlier is how the next rep gets cleaner."
    return "Strong round. Keep the next session focused on one visible correction at a time."


def _build_fallback_rapidfire(
    procedure: ProcedureDefinition,
    study_mode: KnowledgeStudyMode,
    selected_topic: KnowledgeTopicSuggestion,
) -> list[KnowledgeMultipleChoiceQuestion]:
    if study_mode == "related_topics":
        return _build_related_topic_rapidfire(procedure, selected_topic)
    if study_mode == "common_mistakes":
        return _build_common_mistake_rapidfire(procedure, selected_topic)
    return _build_current_procedure_rapidfire(procedure, selected_topic)


def _build_fallback_quiz(
    procedure: ProcedureDefinition,
    study_mode: KnowledgeStudyMode,
    selected_topic: KnowledgeTopicSuggestion,
) -> list[KnowledgeMultipleChoiceQuestion]:
    if study_mode == "related_topics":
        return _build_related_topic_quiz(procedure, selected_topic)
    if study_mode == "common_mistakes":
        return _build_common_mistake_quiz(procedure, selected_topic)
    return _build_current_procedure_quiz(procedure, selected_topic)


def _build_fallback_flashcards(
    procedure: ProcedureDefinition,
    study_mode: KnowledgeStudyMode,
    selected_topic: KnowledgeTopicSuggestion,
) -> list[KnowledgeFlashcard]:
    if study_mode == "related_topics":
        return _build_related_topic_flashcards(procedure, selected_topic)
    if study_mode == "common_mistakes":
        return _build_common_mistake_flashcards(procedure, selected_topic)
    return _build_current_procedure_flashcards(procedure, selected_topic)


def _build_current_procedure_rapidfire(
    procedure: ProcedureDefinition,
    selected_topic: KnowledgeTopicSuggestion,
) -> list[KnowledgeMultipleChoiceQuestion]:
    questions: list[KnowledgeMultipleChoiceQuestion] = []
    objectives = [stage.objective for stage in procedure.stages]

    for index, stage in enumerate(procedure.stages[:5]):
        correct = stage.objective
        distractors = [item for item in objectives if item != correct]
        choices, correct_index = _build_choices(correct, distractors, seed=index)
        questions.append(
            KnowledgeMultipleChoiceQuestion(
                id=f"rapidfire-{stage.id}",
                stage_id=stage.id,
                prompt=f"What is the main goal of the {stage.title} stage?",
                choices=choices,
                correct_index=correct_index,
                explanation=(
                    f"The {stage.title} stage is scored on whether the trainer can clearly see the step objective: {stage.objective}."
                ),
                point_value=10,
                difficulty="warmup" if index < 2 else "core",
            )
        )

    return questions


def _build_current_procedure_quiz(
    procedure: ProcedureDefinition,
    selected_topic: KnowledgeTopicSuggestion,
) -> list[KnowledgeMultipleChoiceQuestion]:
    del selected_topic
    questions: list[KnowledgeMultipleChoiceQuestion] = []
    common_errors = _unique_items(
        error for stage in procedure.stages for error in stage.common_errors
    )
    visible_checks = _unique_items(
        check for stage in procedure.stages for check in stage.visible_checks
    )

    for index, stage in enumerate(procedure.stages[:5]):
        if index % 2 == 0:
            correct = stage.common_errors[0] if stage.common_errors else stage.objective
            distractors = [item for item in common_errors if item != correct]
            prompt = f"Which issue is most associated with the {stage.title} stage?"
        else:
            correct = stage.visible_checks[0] if stage.visible_checks else stage.objective
            distractors = [item for item in visible_checks if item != correct]
            prompt = f"Which cue should stay visible for a strong {stage.title} rep?"

        choices, correct_index = _build_choices(correct, distractors, seed=index + 9)
        explanation = (
            f"In {stage.title}, the trainer is checking for {stage.visible_checks[0] if stage.visible_checks else stage.objective}. "
            f"A common miss is {stage.common_errors[0] if stage.common_errors else 'losing the main objective in frame'}."
        )
        questions.append(
            KnowledgeMultipleChoiceQuestion(
                id=f"quiz-{stage.id}",
                stage_id=stage.id,
                prompt=prompt,
                choices=choices,
                correct_index=correct_index,
                explanation=explanation,
                point_value=18,
                difficulty="core" if index < 3 else "challenge",
            )
        )

    return questions


def _build_current_procedure_flashcards(
    procedure: ProcedureDefinition,
    selected_topic: KnowledgeTopicSuggestion,
) -> list[KnowledgeFlashcard]:
    del selected_topic
    cards: list[KnowledgeFlashcard] = []

    for stage in procedure.stages[:5]:
        cards.append(
            KnowledgeFlashcard(
                id=f"flash-stage-{stage.id}",
                stage_id=stage.id,
                front=f"{stage.title}: what should the learner remember?",
                back=(
                    f"Goal: {stage.objective}. Watch for {stage.visible_checks[0] if stage.visible_checks else 'a clear, reviewable frame'}."
                ),
                memory_tip=(
                    f"If this stage fails, first check for {stage.common_errors[0] if stage.common_errors else 'framing drift'}."
                ),
                point_value=12,
            )
        )

    for target in procedure.named_overlay_targets[:1]:
        cards.append(
            KnowledgeFlashcard(
                id=f"flash-target-{target.id}",
                stage_id="setup",
                front=f"Visual checkpoint: {target.label}",
                back=target.description,
                memory_tip="Use visual checkpoints as anchors for a cleaner rep.",
                point_value=10,
            )
        )

    return cards


def _build_related_topic_rapidfire(
    procedure: ProcedureDefinition,
    selected_topic: KnowledgeTopicSuggestion,
) -> list[KnowledgeMultipleChoiceQuestion]:
    questions: list[KnowledgeMultipleChoiceQuestion] = []
    concept_answers = _related_topic_answer_bank(selected_topic.label)

    for index, stage in enumerate(procedure.stages[:5]):
        correct = concept_answers[index % len(concept_answers)]
        distractors = [
            answer
            for answer in _unique_items(
                item
                for suggestion in _base_topic_suggestions(procedure)
                for item in [suggestion.label, suggestion.description]
            )
            if answer != correct
        ]
        choices, correct_index = _build_choices(correct, distractors, seed=index + 21)
        questions.append(
            KnowledgeMultipleChoiceQuestion(
                id=f"related-rapid-{stage.id}",
                stage_id=stage.id,
                prompt=f"Which idea best supports {selected_topic.label.lower()} during {stage.title}?",
                choices=choices,
                correct_index=correct_index,
                explanation=(
                    f"In {stage.title}, {selected_topic.label.lower()} supports the trainer’s goal of {stage.objective.lower()}."
                ),
                point_value=10,
                difficulty="warmup" if index < 2 else "core",
            )
        )

    return questions


def _build_related_topic_quiz(
    procedure: ProcedureDefinition,
    selected_topic: KnowledgeTopicSuggestion,
) -> list[KnowledgeMultipleChoiceQuestion]:
    questions: list[KnowledgeMultipleChoiceQuestion] = []
    common_errors = _unique_items(
        error for stage in procedure.stages for error in stage.common_errors
    )

    for index, stage in enumerate(procedure.stages[:5]):
        correct = stage.common_errors[0] if stage.common_errors else "The rep gets harder to judge clearly."
        distractors = [item for item in common_errors if item != correct]
        choices, correct_index = _build_choices(correct, distractors, seed=index + 41)
        questions.append(
            KnowledgeMultipleChoiceQuestion(
                id=f"related-quiz-{stage.id}",
                stage_id=stage.id,
                prompt=f"What tends to break down first when {selected_topic.label.lower()} is weak in {stage.title}?",
                choices=choices,
                correct_index=correct_index,
                explanation=(
                    f"If {selected_topic.label.lower()} slips in {stage.title}, the trainer often starts catching issues like {correct.lower()}."
                ),
                point_value=18,
                difficulty="core" if index < 3 else "challenge",
            )
        )

    return questions


def _build_related_topic_flashcards(
    procedure: ProcedureDefinition,
    selected_topic: KnowledgeTopicSuggestion,
) -> list[KnowledgeFlashcard]:
    cards: list[KnowledgeFlashcard] = []
    stages = procedure.stages[:4]

    for stage in stages:
        cards.append(
            KnowledgeFlashcard(
                id=f"related-flash-{stage.id}",
                stage_id=stage.id,
                front=f"{selected_topic.label}: why does it matter in {stage.title}?",
                back=f"It supports {stage.objective.lower()} and keeps the step easier for the trainer to judge.",
                memory_tip=f"Use {selected_topic.label.lower()} as a repeatable habit, not a one-off correction.",
                point_value=12,
            )
        )

    cards.append(
        KnowledgeFlashcard(
            id="related-flash-reset",
            stage_id="setup",
            front=f"{selected_topic.label}: best reset",
            back="Slow down, recenter the field, and make the next rep visibly deliberate.",
            memory_tip="Cleaner habits beat faster habits in reviewable practice.",
            point_value=10,
        )
    )
    cards.append(
        KnowledgeFlashcard(
            id="related-flash-carryover",
            stage_id="setup",
            front=f"How do you carry {selected_topic.label.lower()} into live practice?",
            back="Pick one visible cue, say it aloud, and look for it in the next coached rep.",
            memory_tip="One cue per round keeps the learning transfer clear.",
            point_value=10,
        )
    )

    return cards


def _build_common_mistake_rapidfire(
    procedure: ProcedureDefinition,
    selected_topic: KnowledgeTopicSuggestion,
) -> list[KnowledgeMultipleChoiceQuestion]:
    questions: list[KnowledgeMultipleChoiceQuestion] = []
    common_errors = _unique_items(
        error for stage in procedure.stages for error in stage.common_errors
    )

    for index, stage in enumerate(procedure.stages[:5]):
        correct = stage.common_errors[0] if stage.common_errors else selected_topic.label
        distractors = [item for item in common_errors if item != correct]
        choices, correct_index = _build_choices(correct, distractors, seed=index + 61)
        questions.append(
            KnowledgeMultipleChoiceQuestion(
                id=f"mistake-rapid-{stage.id}",
                stage_id=stage.id,
                prompt=f"Which miss should you watch for first in {stage.title}?",
                choices=choices,
                correct_index=correct_index,
                explanation=(
                    f"In {stage.title}, a common review cue is {correct.lower()}. Spotting it early makes the next correction faster."
                ),
                point_value=10,
                difficulty="warmup" if index < 2 else "core",
            )
        )

    return questions


def _build_common_mistake_quiz(
    procedure: ProcedureDefinition,
    selected_topic: KnowledgeTopicSuggestion,
) -> list[KnowledgeMultipleChoiceQuestion]:
    questions: list[KnowledgeMultipleChoiceQuestion] = []
    visible_checks = _unique_items(
        check for stage in procedure.stages for check in stage.visible_checks
    )

    for index, stage in enumerate(procedure.stages[:5]):
        correct = stage.visible_checks[0] if stage.visible_checks else stage.objective
        distractors = [item for item in visible_checks if item != correct]
        choices, correct_index = _build_choices(correct, distractors, seed=index + 81)
        questions.append(
            KnowledgeMultipleChoiceQuestion(
                id=f"mistake-quiz-{stage.id}",
                stage_id=stage.id,
                prompt=f"What is the best reset when you notice {selected_topic.label.lower()} in {stage.title}?",
                choices=choices,
                correct_index=correct_index,
                explanation=(
                    f"The safest reset is to re-center on a visible cue like {correct.lower()} before you speed back up."
                ),
                point_value=18,
                difficulty="core" if index < 3 else "challenge",
            )
        )

    return questions


def _build_common_mistake_flashcards(
    procedure: ProcedureDefinition,
    selected_topic: KnowledgeTopicSuggestion,
) -> list[KnowledgeFlashcard]:
    cards: list[KnowledgeFlashcard] = []

    for stage in procedure.stages[:4]:
        likely_miss = stage.common_errors[0] if stage.common_errors else selected_topic.label
        cards.append(
            KnowledgeFlashcard(
                id=f"mistake-flash-{stage.id}",
                stage_id=stage.id,
                front=f"Mistake check: {stage.title}",
                back=f"Watch for {likely_miss.lower()}, then reset toward {stage.visible_checks[0] if stage.visible_checks else stage.objective}.",
                memory_tip="Call out the miss you see before deciding on the fix.",
                point_value=12,
            )
        )

    cards.append(
        KnowledgeFlashcard(
            id="mistake-flash-pattern",
            stage_id="setup",
            front=f"Repeated miss: {selected_topic.label}",
            back="A repeated miss is a study target, not a failure. Turn it into one clear correction for the next session.",
            memory_tip="Name the pattern, then choose one cue to change.",
            point_value=10,
        )
    )
    cards.append(
        KnowledgeFlashcard(
            id="mistake-flash-review",
            stage_id="setup",
            front="What should you review after a miss?",
            back="Look at the frame, the visible cue that disappeared, and the simplest step that would make the next rep easier to judge.",
            memory_tip="Reviewable practice is about visible corrections, not vague effort.",
            point_value=10,
        )
    )

    return cards


def _related_topic_answer_bank(topic_label: str) -> list[str]:
    lowered = topic_label.lower()
    if "angle" in lowered or "entry" in lowered:
        return [
            "A confident entry angle that stays easy to see.",
            "A slow first bite that looks repeatable on camera.",
            "A smooth arc instead of a rushed poke.",
            "A clear view of where the needle starts and exits.",
            "Controlled hand motion instead of speed.",
        ]
    if "grip" in lowered or "instrument" in lowered:
        return [
            "A stable needle-driver grip before entry.",
            "Consistent hand control during pull-through.",
            "Less wobble before the first bite.",
            "A cleaner hand position the camera can still judge.",
            "Steady tension instead of squeezing harder.",
        ]
    if "knot" in lowered:
        return [
            "Centered knot placement over the practice line.",
            "Even tension before tightening.",
            "A clean thread path instead of crossed loops.",
            "Finishing only after the knot stays visible.",
            "Small corrections before the final tie.",
        ]
    if "frame" in lowered or "camera" in lowered:
        return [
            "A centered practice field that stays in view.",
            "Visible entry and exit landmarks.",
            "Enough distance to judge the whole action.",
            "Less camera drift during the rep.",
            "A frame that captures the correction clearly.",
        ]
    return [
        "A clear visible cue you can repeat.",
        "A slower rep that stays reviewable.",
        "A single correction carried through the whole step.",
        "Less drift in the camera or hand position.",
        "A stronger reset before the next bite.",
    ]


def _build_topic_suggestions(
    payload: KnowledgePackRequest,
    procedure: ProcedureDefinition,
) -> list[KnowledgeTopicSuggestion]:
    suggestions = _base_topic_suggestions(procedure)

    for index, issue in enumerate(_unique_items(payload.recent_issue_labels)[:2]):
        suggestions.insert(
            index,
            KnowledgeTopicSuggestion(
                id=f"recent-miss-{index + 1}",
                label=_to_title(issue),
                description="Review a repeated miss from your recent practice before the next session.",
                study_mode="common_mistakes",
            ),
        )

    unique_suggestions: list[KnowledgeTopicSuggestion] = []
    seen_labels = set()
    for suggestion in suggestions:
        normalized_label = suggestion.label.lower()
        if normalized_label in seen_labels:
            continue
        seen_labels.add(normalized_label)
        unique_suggestions.append(suggestion)
        if len(unique_suggestions) == 6:
            break

    return unique_suggestions


def _base_topic_suggestions(
    procedure: ProcedureDefinition,
) -> list[KnowledgeTopicSuggestion]:
    return [
        KnowledgeTopicSuggestion(
            id="procedure-overview",
            label="Procedure Overview",
            description=f"Review how {procedure.title} flows from setup to final check.",
            study_mode="current_procedure",
        ),
        KnowledgeTopicSuggestion(
            id="stage-goals",
            label="Stage Goals",
            description="Learn what each stage is scored on before you start the next live rep.",
            study_mode="current_procedure",
        ),
        KnowledgeTopicSuggestion(
            id="instrument-grip",
            label="Instrument Grip",
            description="Study steady hand position and control before entry and pull-through.",
            study_mode="related_topics",
        ),
        KnowledgeTopicSuggestion(
            id="needle-angle",
            label="Needle Angle",
            description="Practice spotting confident entry and exit angles that stay easy to judge.",
            study_mode="related_topics",
        ),
        KnowledgeTopicSuggestion(
            id="camera-framing",
            label="Camera Framing",
            description="Learn how to keep the practice field centered, visible, and reviewable.",
            study_mode="related_topics",
        ),
        KnowledgeTopicSuggestion(
            id="knot-security",
            label="Knot Security",
            description="Review centered finish, thread path, and tension control.",
            study_mode="related_topics",
        ),
        KnowledgeTopicSuggestion(
            id="error-spotting",
            label="Error Spotting",
            description="Train yourself to recognize common misses before they repeat.",
            study_mode="common_mistakes",
        ),
        KnowledgeTopicSuggestion(
            id="frame-clarity",
            label="Frame Clarity",
            description="Practice recognizing when the trainer cannot judge the rep clearly enough.",
            study_mode="common_mistakes",
        ),
    ]


def _resolve_selected_topic(
    payload: KnowledgePackRequest,
    suggestions: list[KnowledgeTopicSuggestion],
) -> KnowledgeTopicSuggestion:
    requested = _clean_text(payload.selected_topic)
    if requested:
        requested_lower = requested.lower()
        for suggestion in suggestions:
            if requested_lower in {
                suggestion.id.lower(),
                suggestion.label.lower(),
            }:
                return suggestion

    for suggestion in suggestions:
        if suggestion.study_mode == payload.study_mode:
            return suggestion

    return suggestions[0]


def _normalize_knowledge_pack(
    response_data: dict[str, Any],
    fallback_response: KnowledgePackResponse,
) -> KnowledgePackResponse:
    study_mode = _coerce_study_mode(response_data.get("study_mode")) or fallback_response.study_mode
    topic_title = _clean_text(response_data.get("topic_title")) or fallback_response.topic_title
    title = _clean_text(response_data.get("title")) or fallback_response.title
    summary = _clean_text(response_data.get("summary")) or fallback_response.summary
    recommended_focus = (
        _clean_text(response_data.get("recommended_focus"))
        or fallback_response.recommended_focus
    )
    celebration_line = (
        _clean_text(response_data.get("celebration_line"))
        or fallback_response.celebration_line
    )
    topic_suggestions = _normalize_topic_suggestion_list(
        response_data.get("topic_suggestions"),
        fallback_response.topic_suggestions,
    )

    rapidfire = _normalize_mcq_list(
        response_data.get("rapidfire_rounds"),
        fallback_response.rapidfire_rounds,
    )
    quiz = _normalize_mcq_list(
        response_data.get("quiz_questions"),
        fallback_response.quiz_questions,
    )
    flashcards = _normalize_flashcard_list(
        response_data.get("flashcards"),
        fallback_response.flashcards,
    )

    return KnowledgePackResponse(
        study_mode=study_mode,
        topic_title=topic_title,
        title=title,
        summary=summary,
        recommended_focus=recommended_focus,
        celebration_line=celebration_line,
        topic_suggestions=topic_suggestions,
        rapidfire_rounds=rapidfire,
        quiz_questions=quiz,
        flashcards=flashcards,
    )


def _normalize_topic_suggestion_list(
    items: Any,
    fallback_items: list[KnowledgeTopicSuggestion],
) -> list[KnowledgeTopicSuggestion]:
    normalized: list[KnowledgeTopicSuggestion] = []
    source_items = items if isinstance(items, list) else []

    for index, fallback in enumerate(fallback_items):
        candidate = source_items[index] if index < len(source_items) else {}
        if not isinstance(candidate, dict):
            candidate = {}

        normalized.append(
            KnowledgeTopicSuggestion(
                id=_clean_text(candidate.get("id")) or fallback.id,
                label=_clean_text(candidate.get("label")) or fallback.label,
                description=_clean_text(candidate.get("description")) or fallback.description,
                study_mode=_coerce_study_mode(candidate.get("study_mode")) or fallback.study_mode,
            )
        )

    return normalized


def _normalize_mcq_list(
    items: Any,
    fallback_items: list[KnowledgeMultipleChoiceQuestion],
) -> list[KnowledgeMultipleChoiceQuestion]:
    normalized: list[KnowledgeMultipleChoiceQuestion] = []
    source_items = items if isinstance(items, list) else []

    for index, fallback in enumerate(fallback_items):
        candidate = source_items[index] if index < len(source_items) else {}
        if not isinstance(candidate, dict):
            candidate = {}

        raw_choices = (
            [
                _clean_text(choice)
                for choice in candidate.get("choices")
                if isinstance(choice, str) and _clean_text(choice)
            ]
            if isinstance(candidate.get("choices"), list)
            else []
        )
        unique_choices = _unique_items(raw_choices)
        if len(unique_choices) != 4:
            unique_choices = fallback.choices

        correct_index = candidate.get("correct_index")
        if not isinstance(correct_index, int) or not (0 <= correct_index < len(unique_choices)):
            correct_index = fallback.correct_index

        point_value = candidate.get("point_value")
        if not isinstance(point_value, int) or point_value < 5 or point_value > 40:
            point_value = fallback.point_value

        difficulty = candidate.get("difficulty")
        if difficulty not in {"warmup", "core", "challenge"}:
            difficulty = fallback.difficulty

        normalized.append(
            KnowledgeMultipleChoiceQuestion(
                id=_clean_text(candidate.get("id")) or fallback.id,
                stage_id=_clean_text(candidate.get("stage_id")) or fallback.stage_id,
                prompt=_clean_text(candidate.get("prompt")) or fallback.prompt,
                choices=unique_choices,
                correct_index=correct_index,
                explanation=_clean_text(candidate.get("explanation")) or fallback.explanation,
                point_value=point_value,
                difficulty=difficulty,
            )
        )

    return normalized


def _normalize_flashcard_list(
    items: Any,
    fallback_items: list[KnowledgeFlashcard],
) -> list[KnowledgeFlashcard]:
    normalized: list[KnowledgeFlashcard] = []
    source_items = items if isinstance(items, list) else []

    for index, fallback in enumerate(fallback_items):
        candidate = source_items[index] if index < len(source_items) else {}
        if not isinstance(candidate, dict):
            candidate = {}

        point_value = candidate.get("point_value")
        if not isinstance(point_value, int) or point_value < 5 or point_value > 25:
            point_value = fallback.point_value

        normalized.append(
            KnowledgeFlashcard(
                id=_clean_text(candidate.get("id")) or fallback.id,
                stage_id=_clean_text(candidate.get("stage_id")) or fallback.stage_id,
                front=_clean_text(candidate.get("front")) or fallback.front,
                back=_clean_text(candidate.get("back")) or fallback.back,
                memory_tip=_clean_text(candidate.get("memory_tip")) or fallback.memory_tip,
                point_value=point_value,
            )
        )

    return normalized


def _build_choices(
    correct: str,
    distractors: list[str],
    *,
    seed: int,
) -> tuple[list[str], int]:
    clean_correct = _clean_text(correct) or "Correct answer"
    clean_distractors = [
        item
        for item in _unique_items(_clean_text(choice) for choice in distractors)
        if item != clean_correct
    ]
    fallback_fillers = [
        "Focus only on speed and ignore framing.",
        "Skip the camera check and move to the next stage.",
        "Treat every blurry frame as a pass.",
        "Ignore the visible objective and tie immediately.",
    ]

    pool = clean_distractors + [item for item in fallback_fillers if item != clean_correct]
    selected = pool[:3]
    while len(selected) < 3:
        selected.append(fallback_fillers[len(selected)])

    insert_index = seed % 4
    choices = selected.copy()
    choices.insert(insert_index, clean_correct)
    return choices, insert_index


def _unique_items(values: Any) -> list[str]:
    items: list[str] = []
    for value in values:
        cleaned = _clean_text(value)
        if cleaned and cleaned not in items:
            items.append(cleaned)
    return items


def _clean_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split()).strip()


def _coerce_study_mode(value: Any) -> KnowledgeStudyMode | None:
    if value in {"current_procedure", "related_topics", "common_mistakes"}:
        return value
    return None


def _to_title(value: str) -> str:
    cleaned = _clean_text(value)
    if not cleaned:
        return "Common Mistake"
    return cleaned[:1].upper() + cleaned[1:]

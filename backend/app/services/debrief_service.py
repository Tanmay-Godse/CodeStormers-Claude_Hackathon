import json
from typing import Any

from app.core.config import settings
from app.schemas.analyze import FeedbackLanguage
from app.schemas.debrief import (
    AdaptiveDrill,
    DebriefRequest,
    DebriefResponse,
    ErrorFingerprintItem,
    QuizQuestion,
)
from app.services.ai_client import (
    AIConfigurationError,
    AIRequestError,
    AIResponseError,
    send_json_message,
)
from app.services.procedure_loader import load_procedure

LOCALIZED_COPY: dict[FeedbackLanguage, dict[str, str]] = {
    "en": {
        "empty_strength_1": "You opened the trainer and set up a simulation-only practice session.",
        "empty_strength_2": "The review workflow is ready once you capture a scored attempt.",
        "empty_strength_3": "Your session record is already structured for stage-by-stage coaching.",
        "empty_improvement_1": "Capture at least one analyzed frame to unlock personalized technique feedback.",
        "empty_improvement_2": "Log a full attempt on the current stage so the debrief can compare progress.",
        "empty_improvement_3": "Use the trainer camera to keep the practice surface centered and visible.",
        "empty_plan_1": "Start with the setup stage and capture a clear frame with the instrument visible.",
        "empty_plan_2": "Ask one focused question during analysis so the coaching stays targeted.",
        "empty_plan_3": "Return to review after the first scored attempt to generate the AI debrief.",
        "strength_logged_attempts": "You logged {count} coached attempt(s), which is enough to compare progress across the session.",
        "strength_passes": "You finished {count} stage attempt(s) with a pass, showing that parts of the technique are already repeatable.",
        "strength_no_passes": "You completed the full capture-and-review loop, which gives the coach something concrete to analyze.",
        "strength_latest_observation": "Your latest frame still preserved a useful visual cue: {observation}",
        "strength_session_structure": "Your session history is structured well enough to turn each retry into a focused next attempt.",
        "improvement_latest_stage": "Revisit the {stage} stage and focus on the latest coaching cue before advancing.",
        "improvement_unclear": "Improve framing, lighting, and tool visibility when a frame is marked as unclear.",
        "improvement_steady_frame": "Keep the camera framing steady so each retry is easy to judge against the stage rubric.",
        "improvement_unsafe": "Slow down and reset technique before the next capture whenever a step feels unsafe, even on a practice surface.",
        "improvement_issue": "The most common correction in this session was: {issue}",
        "improvement_general": "Use the highlighted overlays to correct one visible issue at a time instead of changing everything at once.",
        "plan_repeat_stage": "Repeat the {stage} stage once with the main objective clearly visible in frame.",
        "plan_issue": "Use this exact coaching point on the next capture: {issue}",
        "plan_focus_question": "Ask one short question during the next analysis so the coaching stays focused on the correction you care about most.",
        "plan_compare_review": "After one cleaner retry, reopen the review page and compare the new coaching with the earlier attempt.",
        "equity_offline": "Offline-first logging is available, so you can keep documenting practice attempts even when the network drops.",
        "equity_low_bandwidth": "Low-bandwidth mode keeps image uploads smaller so the trainer still works on slower connections.",
        "equity_audio": "Audio coaching can read the main debrief aloud, which helps when learners prefer listening over reading.",
        "equity_cheap_phone": "Cheap-phone mode reduces camera demand so older devices can still participate in practice sessions.",
        "equity_general": "Keep using short, focused questions so the feedback stays clear even in constrained practice setups.",
        "audio_prefix": "Quick coaching recap.",
        "audio_next": "Next practice step: {step}",
        "audio_equity": "Access tip: {tip}",
        "quiz_goal": "What is the goal of the {stage} stage?",
        "quiz_goal_answer": "It is to complete the stage objective cleanly enough that the coach can mark the step as visible and controlled.",
        "quiz_blur": "What should you do when a frame is blurry or the tool is partly out of view?",
        "quiz_blur_answer": "Retake the frame with steadier lighting and better visibility so the coaching stays reliable.",
        "quiz_issue": "What is the next correction you should prioritize from this session?",
        "quiz_issue_answer": "Use the latest coaching message and overlay targets to improve one visible issue before changing anything else.",
        "quiz_default_1_q": "Why does the trainer ask for a clear view of the practice surface?",
        "quiz_default_1_a": "A clear view makes it easier to judge technique, framing, and target alignment.",
        "quiz_default_2_q": "What should you do if the frame is blurry or the tool is out of view?",
        "quiz_default_2_a": "Retake the frame so the analyzer can judge the step more reliably.",
        "quiz_default_3_q": "What is the first goal of the setup stage?",
        "quiz_default_3_a": "Center the simulation surface and keep the tools visible before advancing.",
    },
    "es": {
        "empty_strength_1": "Abriste el entrenador y configuraste una sesion de practica solo de simulacion.",
        "empty_strength_2": "El flujo de revision ya esta listo en cuanto captures un intento con puntaje.",
        "empty_strength_3": "Tu registro de sesion ya tiene estructura para coaching por etapas.",
        "empty_improvement_1": "Captura al menos un cuadro analizado para desbloquear retroalimentacion tecnica personalizada.",
        "empty_improvement_2": "Registra un intento completo de la etapa actual para que la revision pueda comparar tu progreso.",
        "empty_improvement_3": "Usa la camara del entrenador para mantener la superficie de practica centrada y visible.",
        "empty_plan_1": "Empieza con la etapa de preparacion y captura un cuadro claro con el instrumento visible.",
        "empty_plan_2": "Haz una pregunta concreta durante el analisis para que la retroalimentacion sea mas precisa.",
        "empty_plan_3": "Vuelve a la revision despues del primer intento con puntaje para generar el informe de IA.",
        "strength_logged_attempts": "Registraste {count} intento(s) guiado(s), suficiente para comparar progreso durante la sesion.",
        "strength_passes": "Terminaste {count} intento(s) de etapa con resultado aprobado, lo que muestra partes de la tecnica repetibles.",
        "strength_no_passes": "Completaste el ciclo completo de captura y revision, lo que da una base concreta para el coaching.",
        "strength_latest_observation": "Tu cuadro mas reciente aun conserva una pista visual util: {observation}",
        "strength_session_structure": "Tu historial de sesion ya esta lo bastante ordenado para convertir cada reintento en una correccion puntual.",
        "improvement_latest_stage": "Vuelve a la etapa {stage} y enfocate en la ultima indicacion antes de avanzar.",
        "improvement_unclear": "Mejora el encuadre, la iluminacion y la visibilidad del instrumento cuando una imagen se marque como poco clara.",
        "improvement_steady_frame": "Mantén el encuadre estable para que cada reintento sea facil de comparar con la rubrica.",
        "improvement_unsafe": "Reduce la velocidad y reinicia la tecnica antes de la siguiente captura cuando un paso se sienta inseguro, incluso en practica.",
        "improvement_issue": "La correccion mas comun en esta sesion fue: {issue}",
        "improvement_general": "Usa las superposiciones destacadas para corregir un problema visible a la vez en lugar de cambiar todo.",
        "plan_repeat_stage": "Repite una vez la etapa {stage} con el objetivo principal claramente visible en la imagen.",
        "plan_issue": "Usa esta correccion exacta en la siguiente captura: {issue}",
        "plan_focus_question": "Haz una pregunta corta en el siguiente analisis para que la retroalimentacion se concentre en tu prioridad.",
        "plan_compare_review": "Despues de un reintento mas limpio, abre la revision otra vez y compara el nuevo coaching con el anterior.",
        "equity_offline": "El registro sin conexion te permite seguir documentando intentos de practica aunque falle la red.",
        "equity_low_bandwidth": "El modo de bajo ancho de banda reduce el tamano de las imagenes para conexiones lentas.",
        "equity_audio": "El coaching por audio puede leer el informe principal en voz alta cuando sea mas facil escuchar que leer.",
        "equity_cheap_phone": "El modo de telefono economico reduce la exigencia de la camara para dispositivos mas antiguos.",
        "equity_general": "Sigue usando preguntas breves y enfocadas para mantener la retroalimentacion clara en entornos con menos recursos.",
        "audio_prefix": "Resumen rapido de coaching.",
        "audio_next": "Siguiente paso de practica: {step}",
        "audio_equity": "Consejo de acceso: {tip}",
        "quiz_goal": "Cual es el objetivo de la etapa {stage}?",
        "quiz_goal_answer": "Es completar el objetivo de la etapa con suficiente claridad para que el coach marque el paso como visible y controlado.",
        "quiz_blur": "Que debes hacer cuando una imagen sale borrosa o el instrumento queda parcialmente fuera de vista?",
        "quiz_blur_answer": "Vuelve a tomar la imagen con mejor estabilidad e iluminacion para que el coaching sea confiable.",
        "quiz_issue": "Cual es la siguiente correccion que deberias priorizar en esta sesion?",
        "quiz_issue_answer": "Usa el ultimo mensaje de coaching y las superposiciones para mejorar un problema visible antes de cambiar otra cosa.",
        "quiz_default_1_q": "Por que el entrenador pide una vista clara de la superficie de practica?",
        "quiz_default_1_a": "Una vista clara facilita juzgar la tecnica, el encuadre y la alineacion de objetivos.",
        "quiz_default_2_q": "Que debes hacer si la imagen esta borrosa o la herramienta queda fuera de vista?",
        "quiz_default_2_a": "Vuelve a capturar la imagen para que el analizador pueda juzgar mejor el paso.",
        "quiz_default_3_q": "Cual es la primera meta de la etapa de preparacion?",
        "quiz_default_3_a": "Centrar la superficie de simulacion y mantener visibles las herramientas antes de avanzar.",
    },
    "fr": {
        "empty_strength_1": "Vous avez ouvert le simulateur et prepare une session d entrainement uniquement en simulation.",
        "empty_strength_2": "Le flux de revision est pret des que vous capturez une tentative notee.",
        "empty_strength_3": "Votre session est deja structuree pour un coaching etape par etape.",
        "empty_improvement_1": "Capturez au moins une image analysee pour debloquer un retour technique personnalise.",
        "empty_improvement_2": "Enregistrez une tentative complete sur l etape en cours afin que la revision puisse comparer vos progres.",
        "empty_improvement_3": "Utilisez la camera du simulateur pour garder la surface de pratique centree et visible.",
        "empty_plan_1": "Commencez par l etape de preparation et capturez une image nette avec l instrument visible.",
        "empty_plan_2": "Posez une question ciblee pendant l analyse pour garder le coaching precis.",
        "empty_plan_3": "Revenez a la page de revision apres la premiere tentative notee pour generer le debrief IA.",
        "strength_logged_attempts": "Vous avez enregistre {count} tentative(s) guidee(s), ce qui suffit pour comparer les progres pendant la session.",
        "strength_passes": "Vous avez valide {count} tentative(s) d etape, ce qui montre que certains gestes deviennent repetables.",
        "strength_no_passes": "Vous avez complete le cycle capture puis revision, ce qui donne une base concrete pour le coaching.",
        "strength_latest_observation": "Votre image la plus recente conserve encore un indice visuel utile : {observation}",
        "strength_session_structure": "Votre historique est assez structure pour transformer chaque reprise en correction ciblee.",
        "improvement_latest_stage": "Revenez a l etape {stage} et concentrez-vous sur la derniere consigne avant d avancer.",
        "improvement_unclear": "Ameliorez le cadrage, la lumiere et la visibilite de l instrument quand une image est jugee peu claire.",
        "improvement_steady_frame": "Gardez un cadrage stable pour que chaque nouvelle tentative soit facile a comparer a la grille.",
        "improvement_unsafe": "Ralentissez et reinitialisez la technique avant la capture suivante lorsqu un geste parait peu sur, meme en simulation.",
        "improvement_issue": "La correction la plus frequente pendant cette session etait : {issue}",
        "improvement_general": "Utilisez les reperes visuels pour corriger un probleme visible a la fois plutot que tout changer d un coup.",
        "plan_repeat_stage": "Refaites une fois l etape {stage} avec l objectif principal clairement visible dans l image.",
        "plan_issue": "Utilisez exactement cette correction lors de la prochaine capture : {issue}",
        "plan_focus_question": "Posez une question courte lors de la prochaine analyse pour concentrer le coaching sur votre priorite.",
        "plan_compare_review": "Apres une reprise plus propre, ouvrez a nouveau la revision et comparez le nouveau coaching avec l ancien.",
        "equity_offline": "Le journal hors ligne vous permet de continuer a documenter vos essais meme si la connexion tombe.",
        "equity_low_bandwidth": "Le mode faible bande passante reduit la taille des images pour les connexions plus lentes.",
        "equity_audio": "Le coaching audio peut lire le debrief principal a voix haute lorsque l ecoute est plus pratique que la lecture.",
        "equity_cheap_phone": "Le mode telephone modeste reduit la charge camera pour les appareils plus anciens.",
        "equity_general": "Continuez a poser des questions courtes et ciblees pour garder un retour clair dans des contextes limites.",
        "audio_prefix": "Recapitulatif rapide du coaching.",
        "audio_next": "Prochaine etape de pratique : {step}",
        "audio_equity": "Conseil d acces : {tip}",
        "quiz_goal": "Quel est l objectif de l etape {stage} ?",
        "quiz_goal_answer": "Il s agit d accomplir l objectif de l etape assez proprement pour que le coach puisse juger le geste visible et controle.",
        "quiz_blur": "Que faut-il faire quand l image est floue ou que l instrument sort partiellement du cadre ?",
        "quiz_blur_answer": "Reprenez l image avec une meilleure stabilite et une meilleure visibilite pour garder un coaching fiable.",
        "quiz_issue": "Quelle correction devez-vous prioriser ensuite dans cette session ?",
        "quiz_issue_answer": "Utilisez le dernier message de coaching et les reperes visuels pour ameliorer un seul probleme visible avant d en changer un autre.",
        "quiz_default_1_q": "Pourquoi le simulateur demande-t-il une vue claire de la surface de pratique ?",
        "quiz_default_1_a": "Une vue claire facilite l evaluation de la technique, du cadrage et de l alignement des reperes.",
        "quiz_default_2_q": "Que faut-il faire si l image est floue ou si l outil sort du cadre ?",
        "quiz_default_2_a": "Reprenez l image pour que l analyse puisse juger le geste plus fiablement.",
        "quiz_default_3_q": "Quel est le premier objectif de l etape de preparation ?",
        "quiz_default_3_a": "Centrer la surface de simulation et garder les outils visibles avant d avancer.",
    },
    "hi": {
        "empty_strength_1": "Aapne trainer khola aur sirf simulation wali practice session taiyar ki.",
        "empty_strength_2": "Jaise hi aap ek scored attempt capture karenge, review flow taiyar hai.",
        "empty_strength_3": "Aapka session record pehle se stage-by-stage coaching ke liye structured hai.",
        "empty_improvement_1": "Vyaktigat technique feedback ke liye kam se kam ek analyzed frame capture kijiye.",
        "empty_improvement_2": "Current stage par ek poora attempt log kijiye taki review aapki progress compare kar sake.",
        "empty_improvement_3": "Practice surface ko center aur visible rakhne ke liye trainer camera ka use kijiye.",
        "empty_plan_1": "Setup stage se shuru kijiye aur instrument dikhte hue ek clear frame capture kijiye.",
        "empty_plan_2": "Analysis ke dauran ek focused sawal poochhiye taki coaching targeted rahe.",
        "empty_plan_3": "Pehle scored attempt ke baad review par laut kar AI debrief generate kijiye.",
        "strength_logged_attempts": "Aapne {count} coached attempt log kiye, jo session ke dauran progress compare karne ke liye kaafi hain.",
        "strength_passes": "Aapne {count} stage attempt pass kiye, jo dikhata hai ki technique ke kuch hisson ko aap repeat kar pa rahe hain.",
        "strength_no_passes": "Aapne poora capture aur review loop complete kiya, jis se coach ko analyze karne ke liye concrete data mila.",
        "strength_latest_observation": "Aapke latest frame me abhi bhi ek upyogi visual cue bana raha: {observation}",
        "strength_session_structure": "Aapka session history itna structured hai ki har retry ko focused next attempt me badla ja sakta hai.",
        "improvement_latest_stage": "Aage badhne se pehle {stage} stage par wapas jaiye aur latest coaching cue par dhyan dijiye.",
        "improvement_unclear": "Jab frame unclear ho to framing, lighting, aur tool visibility ko sudhariye.",
        "improvement_steady_frame": "Har retry ko rubric ke against asani se judge karne ke liye camera framing ko stable rakhiye.",
        "improvement_unsafe": "Agar koi step unsafe lage to agle capture se pehle speed kam kijiye aur technique reset kijiye, chahe surface practice hi kyon na ho.",
        "improvement_issue": "Is session me sabse common correction yeh tha: {issue}",
        "improvement_general": "Ek waqt par ek visible issue ko theek karne ke liye highlighted overlays ka use kijiye.",
        "plan_repeat_stage": "Main objective ko clear frame me dikhate hue {stage} stage ko ek baar phir repeat kijiye.",
        "plan_issue": "Agli capture me isi correction par focus kijiye: {issue}",
        "plan_focus_question": "Agli analysis me ek chhota sawal poochhiye taki coaching aapki sabse zaruri correction par rahe.",
        "plan_compare_review": "Ek cleaner retry ke baad review page dobara kholiye aur naye coaching ko purane attempt se compare kijiye.",
        "equity_offline": "Offline-first logging ki wajah se network girne par bhi aap practice attempts record kar sakte hain.",
        "equity_low_bandwidth": "Low-bandwidth mode image upload chhota rakhta hai taki dheeme connection par bhi trainer kaam kare.",
        "equity_audio": "Audio coaching main debrief ko zor se padh sakta hai jab padhna mushkil ho ya sunna behtar lage.",
        "equity_cheap_phone": "Cheap-phone mode camera load kam karta hai taki purane device bhi practice me kaam aa saken.",
        "equity_general": "Chhote aur focused sawal poochte rahiye taki limited setup me bhi feedback clear rahe.",
        "audio_prefix": "Tez coaching recap.",
        "audio_next": "Agla practice step: {step}",
        "audio_equity": "Access tip: {tip}",
        "quiz_goal": "{stage} stage ka goal kya hai?",
        "quiz_goal_answer": "Is stage ka goal step objective ko itni safai se complete karna hai ki coach ise visible aur controlled mark kar sake.",
        "quiz_blur": "Jab frame blurry ho ya tool aadha bahar ho to aapko kya karna chahiye?",
        "quiz_blur_answer": "Feedback ko reliable rakhne ke liye better stability aur visibility ke saath frame dobara lijiye.",
        "quiz_issue": "Is session me agla sabse important correction kya hona chahiye?",
        "quiz_issue_answer": "Latest coaching message aur overlay targets ka use karke pehle ek visible issue ko sudhariye.",
        "quiz_default_1_q": "Trainer practice surface ka clear view kyon maangta hai?",
        "quiz_default_1_a": "Clear view se technique, framing, aur target alignment ko judge karna asan hota hai.",
        "quiz_default_2_q": "Agar frame blurry ho ya tool view se bahar ho to kya karna chahiye?",
        "quiz_default_2_a": "Frame dobara lijiye taki analyzer step ko zyada bharose se judge kar sake.",
        "quiz_default_3_q": "Setup stage ka pehla goal kya hai?",
        "quiz_default_3_a": "Simulation surface ko center me rakhna aur tools ko visible rakhna, phir aage badhna.",
    },
}


def generate_session_debrief(payload: DebriefRequest) -> DebriefResponse:
    procedure = load_procedure(payload.procedure_id)
    fallback_response = _build_fallback_debrief(payload)

    if not payload.events:
        return fallback_response

    try:
        response_data = send_json_message(
            model=settings.ai_debrief_model,
            max_tokens=settings.ai_debrief_max_tokens,
            system_prompt=_build_debrief_system_prompt(payload),
            user_content=_build_debrief_user_content(
                payload=payload,
                procedure_title=procedure.title,
                practice_surface=procedure.practice_surface,
            ),
            output_schema=DebriefResponse.model_json_schema(),
            model_role="debrief",
        )
    except (AIConfigurationError, AIRequestError, AIResponseError):
        return fallback_response

    return _normalize_debrief_response(response_data, fallback_response)


def _build_debrief_system_prompt(payload: DebriefRequest) -> str:
    return (
        "You are an AI clinical skills coach writing a brief review for a simulation-only suturing practice session. "
        "The learner is practicing a simple interrupted suture on a safe practice surface, not a patient. "
        f"Return every learner-facing field in the requested language '{payload.feedback_language}'. "
        "Use the recorded stage events and learner_profile to identify strengths, improvement areas, a three-step practice plan, "
        "a three-item equity_support_plan, a short audio_script for read-aloud coaching, a personal error_fingerprint, "
        "one adaptive_drill, graded_attempt_count, not_graded_attempt_count, and a three-question quiz. "
        "Keep the tone encouraging, specific, educational, and easy to understand. "
        "Only present a hard-scored summary when the graded_attempt_count supports it; not_graded attempts should be framed as retakes rather than performance failures. "
        "When equity_mode is enabled, use plain-language phrasing and keep instructions concise for low-resource practice settings. "
        "Do not invent patient-care claims or high-stakes medical advice."
    )


def _build_debrief_user_content(
    *,
    payload: DebriefRequest,
    procedure_title: str,
    practice_surface: str,
) -> list[dict[str, Any]]:
    session_summary: dict[str, Any] = {
        "session_id": payload.session_id,
        "procedure_title": procedure_title,
        "practice_surface": practice_surface,
        "skill_level": payload.skill_level,
        "feedback_language": payload.feedback_language,
        "equity_mode": payload.equity_mode.model_dump(mode="json"),
        "learner_profile": (
            payload.learner_profile.model_dump(mode="json")
            if payload.learner_profile
            else None
        ),
        "attempt_count": len(payload.events),
        "total_score": sum(event.score_delta for event in payload.events),
        "events": [event.model_dump(mode="json") for event in payload.events],
    }

    return [
        {
            "type": "text",
            "text": (
                "Generate a concise debrief for this stored suturing session. "
                "The response must match the JSON schema exactly.\n\n"
                f"{json.dumps(session_summary, indent=2)}"
            ),
        }
    ]


def _build_fallback_debrief(payload: DebriefRequest) -> DebriefResponse:
    copy = _localized_copy(payload.feedback_language)
    equity_support_plan = _build_equity_support_plan(payload)
    error_fingerprint = _build_error_fingerprint(payload)
    adaptive_drill = _build_adaptive_drill(
        payload.feedback_language,
        error_fingerprint,
    )
    graded_events = _graded_events(payload)
    not_graded_events = [event for event in payload.events if not _is_event_graded(event)]

    if not payload.events:
        strengths = [
            copy["empty_strength_1"],
            copy["empty_strength_2"],
            copy["empty_strength_3"],
        ]
        improvement_areas = [
            copy["empty_improvement_1"],
            copy["empty_improvement_2"],
            copy["empty_improvement_3"],
        ]
        practice_plan = [
            copy["empty_plan_1"],
            copy["empty_plan_2"],
            copy["empty_plan_3"],
        ]

        return DebriefResponse(
            feedback_language=payload.feedback_language,
            graded_attempt_count=0,
            not_graded_attempt_count=0,
            error_fingerprint=error_fingerprint,
            adaptive_drill=adaptive_drill,
            strengths=_normalize_text_items(strengths, []),
            improvement_areas=_normalize_text_items(improvement_areas, []),
            practice_plan=_normalize_text_items(practice_plan, []),
            equity_support_plan=equity_support_plan,
            audio_script=_build_audio_script(copy, strengths, practice_plan, equity_support_plan),
            quiz=_default_quiz(payload.feedback_language),
        )

    latest_event = payload.events[-1]
    pass_events = [event for event in graded_events if event.step_status == "pass"]
    unsafe_events = [event for event in graded_events if event.step_status == "unsafe"]
    issue_messages = _collect_issue_messages(payload, graded_only=True)
    latest_observation = _first_non_empty(latest_event.visible_observations)
    latest_stage = _format_stage_id(latest_event.stage_id)
    top_issue_label = error_fingerprint[0].label if error_fingerprint else None

    strengths = [
        (
            _format_graded_attempt_strength(
                payload.feedback_language,
                graded_attempt_count=len(graded_events),
                total_attempt_count=len(payload.events),
            )
            if graded_events
            else copy["strength_logged_attempts"].format(count=len(payload.events))
        ),
        (
            copy["strength_passes"].format(count=len(pass_events))
            if pass_events
            else copy["strength_no_passes"]
        ),
        (
            copy["strength_latest_observation"].format(observation=latest_observation)
            if latest_observation
            else copy["strength_session_structure"]
        ),
    ]

    improvement_areas = [
        (
            _format_not_graded_guidance(
                payload.feedback_language,
                count=len(not_graded_events),
            )
            if not_graded_events
            else copy["improvement_latest_stage"].format(stage=latest_stage)
        ),
        (
            copy["improvement_issue"].format(issue=top_issue_label)
            if top_issue_label
            else copy["improvement_steady_frame"]
        ),
        copy["improvement_unsafe"]
        if unsafe_events
        else (
            copy["improvement_issue"].format(issue=issue_messages[0])
            if issue_messages
            else copy["improvement_general"]
        ),
    ]

    practice_plan = [
        f"{copy['plan_repeat_stage'].format(stage=latest_stage)} {adaptive_drill.instructions[0]}",
        (
            copy["plan_issue"].format(issue=top_issue_label)
            if top_issue_label
            else copy["plan_focus_question"]
        ),
        adaptive_drill.instructions[2]
        if adaptive_drill.instructions
        else copy["plan_compare_review"],
    ]

    return DebriefResponse(
        feedback_language=payload.feedback_language,
        graded_attempt_count=len(graded_events),
        not_graded_attempt_count=len(not_graded_events),
        error_fingerprint=error_fingerprint,
        adaptive_drill=adaptive_drill,
        strengths=_normalize_text_items(strengths, []),
        improvement_areas=_normalize_text_items(improvement_areas, []),
        practice_plan=_normalize_text_items(practice_plan, []),
        equity_support_plan=equity_support_plan,
        audio_script=_build_audio_script(copy, strengths, practice_plan, equity_support_plan),
        quiz=_build_quiz_from_events(payload),
    )


def _normalize_debrief_response(
    response_data: dict[str, Any],
    fallback_response: DebriefResponse,
) -> DebriefResponse:
    if not isinstance(response_data, dict):
        return fallback_response

    return DebriefResponse(
        feedback_language=fallback_response.feedback_language,
        graded_attempt_count=_normalize_count(
            response_data.get("graded_attempt_count"),
            fallback_response.graded_attempt_count,
        ),
        not_graded_attempt_count=_normalize_count(
            response_data.get("not_graded_attempt_count"),
            fallback_response.not_graded_attempt_count,
        ),
        error_fingerprint=_normalize_error_fingerprint(
            response_data.get("error_fingerprint"),
            fallback_response.error_fingerprint,
        ),
        adaptive_drill=_normalize_adaptive_drill(
            response_data.get("adaptive_drill"),
            fallback_response.adaptive_drill,
        ),
        strengths=_normalize_text_items(
            response_data.get("strengths"),
            fallback_response.strengths,
        ),
        improvement_areas=_normalize_text_items(
            response_data.get("improvement_areas"),
            fallback_response.improvement_areas,
        ),
        practice_plan=_normalize_text_items(
            response_data.get("practice_plan"),
            fallback_response.practice_plan,
        ),
        equity_support_plan=_normalize_text_items(
            response_data.get("equity_support_plan"),
            fallback_response.equity_support_plan,
        ),
        audio_script=_normalize_text_value(
            response_data.get("audio_script"),
            fallback_response.audio_script,
        ),
        quiz=_normalize_quiz(
            response_data.get("quiz"),
            fallback_response.quiz,
        ),
    )


def _normalize_count(value: Any, fallback: int) -> int:
    if isinstance(value, int) and value >= 0:
        return value
    return fallback


def _normalize_error_fingerprint(
    value: Any,
    fallback: list[ErrorFingerprintItem],
) -> list[ErrorFingerprintItem]:
    cleaned: list[ErrorFingerprintItem] = []
    seen_codes: set[str] = set()

    if isinstance(value, list):
        for item in value:
            if not isinstance(item, dict):
                continue
            try:
                candidate = ErrorFingerprintItem.model_validate(item)
            except Exception:
                continue
            if candidate.code in seen_codes:
                continue
            cleaned.append(candidate)
            seen_codes.add(candidate.code)
            if len(cleaned) == 3:
                break

    for item in fallback:
        if item.code in seen_codes:
            continue
        cleaned.append(item)
        seen_codes.add(item.code)
        if len(cleaned) == 3:
            break

    return cleaned[:3]


def _normalize_adaptive_drill(value: Any, fallback: AdaptiveDrill) -> AdaptiveDrill:
    if not isinstance(value, dict):
        return fallback

    try:
        return AdaptiveDrill.model_validate(value)
    except Exception:
        return fallback


def _normalize_text_items(value: Any, fallback: list[str]) -> list[str]:
    cleaned: list[str] = []

    if isinstance(value, list):
        for item in value:
            if not isinstance(item, str):
                continue
            candidate = item.strip()
            if candidate and candidate not in cleaned:
                cleaned.append(candidate)
            if len(cleaned) == 3:
                break

    for item in fallback:
        candidate = item.strip()
        if candidate and candidate not in cleaned:
            cleaned.append(candidate)
        if len(cleaned) == 3:
            break

    return cleaned[:3]


def _normalize_text_value(value: Any, fallback: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback


def _normalize_quiz(value: Any, fallback: list[QuizQuestion]) -> list[QuizQuestion]:
    cleaned: list[QuizQuestion] = []
    seen_questions: set[str] = set()

    if isinstance(value, list):
        for item in value:
            if not isinstance(item, dict):
                continue
            question = item.get("question")
            answer = item.get("answer")
            if not isinstance(question, str) or not isinstance(answer, str):
                continue
            normalized_question = question.strip()
            normalized_answer = answer.strip()
            if (
                not normalized_question
                or not normalized_answer
                or normalized_question in seen_questions
            ):
                continue
            cleaned.append(
                QuizQuestion(
                    question=normalized_question,
                    answer=normalized_answer,
                )
            )
            seen_questions.add(normalized_question)
            if len(cleaned) == 3:
                break

    for item in fallback:
        if item.question in seen_questions:
            continue
        cleaned.append(item)
        seen_questions.add(item.question)
        if len(cleaned) == 3:
            break

    return cleaned[:3]


def _build_quiz_from_events(payload: DebriefRequest) -> list[QuizQuestion]:
    copy = _localized_copy(payload.feedback_language)
    latest_event = payload.events[-1]
    issue_messages = _collect_issue_messages(payload)

    quiz = [
        QuizQuestion(
            question=copy["quiz_goal"].format(
                stage=_format_stage_id(latest_event.stage_id)
            ),
            answer=copy["quiz_goal_answer"],
        ),
        QuizQuestion(
            question=copy["quiz_blur"],
            answer=copy["quiz_blur_answer"],
        ),
        QuizQuestion(
            question=copy["quiz_issue"],
            answer=issue_messages[0]
            if issue_messages
            else copy["quiz_issue_answer"],
        ),
    ]

    return _normalize_quiz([], quiz)


def _default_quiz(language: FeedbackLanguage) -> list[QuizQuestion]:
    copy = _localized_copy(language)
    return [
        QuizQuestion(
            question=copy["quiz_default_1_q"],
            answer=copy["quiz_default_1_a"],
        ),
        QuizQuestion(
            question=copy["quiz_default_2_q"],
            answer=copy["quiz_default_2_a"],
        ),
        QuizQuestion(
            question=copy["quiz_default_3_q"],
            answer=copy["quiz_default_3_a"],
        ),
    ]


def _build_equity_support_plan(payload: DebriefRequest) -> list[str]:
    copy = _localized_copy(payload.feedback_language)
    items: list[str] = []

    if payload.equity_mode.offline_practice_logging:
        items.append(copy["equity_offline"])
    if payload.equity_mode.low_bandwidth_mode:
        items.append(copy["equity_low_bandwidth"])
    if payload.equity_mode.audio_coaching:
        items.append(copy["equity_audio"])
    if payload.equity_mode.cheap_phone_mode:
        items.append(copy["equity_cheap_phone"])

    fallback_items = [
        copy["equity_general"],
        copy["equity_low_bandwidth"],
        copy["equity_audio"],
        copy["equity_offline"],
        copy["equity_cheap_phone"],
    ]
    return _normalize_text_items(items, fallback_items)


def _build_audio_script(
    copy: dict[str, str],
    strengths: list[str],
    practice_plan: list[str],
    equity_support_plan: list[str],
) -> str:
    parts = [copy["audio_prefix"]]

    if strengths:
        parts.append(strengths[0])
    if practice_plan:
        parts.append(copy["audio_next"].format(step=practice_plan[0]))
    if equity_support_plan:
        parts.append(copy["audio_equity"].format(tip=equity_support_plan[0]))

    return " ".join(part.strip() for part in parts if part.strip())


def _localized_copy(language: FeedbackLanguage) -> dict[str, str]:
    return LOCALIZED_COPY.get(language, LOCALIZED_COPY["en"])


def _graded_events(payload: DebriefRequest):
    return [event for event in payload.events if _is_event_graded(event)]


def _is_event_graded(event) -> bool:
    return event.analysis_mode == "coaching" and event.graded


def _build_error_fingerprint(payload: DebriefRequest) -> list[ErrorFingerprintItem]:
    if payload.learner_profile and payload.learner_profile.recurring_issues:
        return payload.learner_profile.recurring_issues[:3]

    issue_index: dict[str, ErrorFingerprintItem] = {}

    for event in _graded_events(payload):
        for issue in event.issues:
            existing = issue_index.get(issue.code)
            if existing is None:
                issue_index[issue.code] = ErrorFingerprintItem(
                    code=issue.code,
                    label=_humanize_issue_label(issue.code, issue.message),
                    count=1,
                    stage_ids=[event.stage_id],
                )
                continue

            next_stage_ids = existing.stage_ids
            if event.stage_id not in next_stage_ids and len(next_stage_ids) < 6:
                next_stage_ids = [*next_stage_ids, event.stage_id]

            issue_index[issue.code] = existing.model_copy(
                update={
                    "count": existing.count + 1,
                    "stage_ids": next_stage_ids,
                }
            )

    return sorted(
        issue_index.values(),
        key=lambda item: (-item.count, item.label.lower()),
    )[:3]


def _build_adaptive_drill(
    language: FeedbackLanguage,
    error_fingerprint: list[ErrorFingerprintItem],
) -> AdaptiveDrill:
    focus_label = error_fingerprint[0].label if error_fingerprint else _default_drill_focus(language)

    return AdaptiveDrill(
        title=_adaptive_drill_title(language, focus_label),
        focus=focus_label,
        reason=_adaptive_drill_reason(language, focus_label),
        instructions=[
            _adaptive_drill_step(language, 1, focus_label),
            _adaptive_drill_step(language, 2, focus_label),
            _adaptive_drill_step(language, 3, focus_label),
        ],
        rep_target=_adaptive_drill_rep_target(language),
    )


def _format_graded_attempt_strength(
    language: FeedbackLanguage,
    *,
    graded_attempt_count: int,
    total_attempt_count: int,
) -> str:
    if language == "es":
        return (
            f"Tienes {graded_attempt_count} intento(s) calificados de {total_attempt_count} registro(s), "
            "asi que el resumen ya se apoya en repeticiones que el sistema pudo juzgar con confianza."
        )
    if language == "fr":
        return (
            f"Vous avez {graded_attempt_count} tentative(s) notees sur {total_attempt_count} essai(s), "
            "ce qui donne deja une base suffisamment fiable pour comparer la technique."
        )
    if language == "hi":
        return (
            f"Aapke paas {total_attempt_count} logged attempts me se {graded_attempt_count} graded attempts hain, "
            "isliye summary unhi repetitions par bani hai jinhen system bharose se judge kar saka."
        )

    return (
        f"You have {graded_attempt_count} graded attempt(s) out of {total_attempt_count} logged attempt(s), "
        "so the summary is anchored to repetitions the system could judge with confidence."
    )


def _format_not_graded_guidance(language: FeedbackLanguage, *, count: int) -> str:
    if language == "es":
        return (
            f"{count} intento(s) quedaron sin calificar por baja confianza o imagen ambigua. "
            "Repitelos con un encuadre mas claro antes de usarlos como señal de progreso."
        )
    if language == "fr":
        return (
            f"{count} tentative(s) n ont pas ete notees a cause d une confiance trop basse ou d une image ambiguë. "
            "Refaites-les avec un cadrage plus net avant de les traiter comme un vrai signal de progression."
        )
    if language == "hi":
        return (
            f"{count} attempts ko grade nahi kiya gaya kyunki confidence kam tha ya frame ambiguous tha. "
            "Progress compare karne se pehle inhen clearer framing ke saath dobara lijiye."
        )

    return (
        f"{count} attempt(s) were not graded because the confidence was too low or the frame was ambiguous. "
        "Retake them with clearer framing before treating them as progress signals."
    )


def _default_drill_focus(language: FeedbackLanguage) -> str:
    if language == "es":
        return "claridad de imagen"
    if language == "fr":
        return "clarte de l image"
    if language == "hi":
        return "frame clarity"
    return "frame clarity"


def _adaptive_drill_title(language: FeedbackLanguage, focus_label: str) -> str:
    if language == "es":
        return f"Mini ejercicio: {focus_label}"
    if language == "fr":
        return f"Mini exercice : {focus_label}"
    if language == "hi":
        return f"Mini drill: {focus_label}"
    return f"{focus_label} mini drill"


def _adaptive_drill_reason(language: FeedbackLanguage, focus_label: str) -> str:
    if language == "es":
        return f"Este ejercicio apunta a la correccion que mas se repite en tus sesiones: {focus_label}."
    if language == "fr":
        return f"Cet exercice cible la correction qui revient le plus souvent dans vos sessions : {focus_label}."
    if language == "hi":
        return f"Yeh drill aapki sessions me sabse zyada repeat hone wali correction par focused hai: {focus_label}."
    return f"This drill targets the correction that shows up most often across your sessions: {focus_label}."


def _adaptive_drill_step(
    language: FeedbackLanguage,
    step_number: int,
    focus_label: str,
) -> str:
    steps = {
        "en": [
            f"Do 5 slow reps that focus only on {focus_label}, not the full stitch.",
            "Pause after each rep and check whether the correction stayed visible in frame.",
            "Finish with 1 full captured attempt and compare it against the earlier pattern.",
        ],
        "es": [
            f"Haz 5 repeticiones lentas enfocadas solo en {focus_label}, no en toda la sutura.",
            "Haz una pausa despues de cada repeticion y verifica si la correccion sigue visible en la imagen.",
            "Termina con 1 intento completo capturado y comparalo con el patron anterior.",
        ],
        "fr": [
            f"Faites 5 repetitions lentes en vous concentrant seulement sur {focus_label}, pas sur toute la suture.",
            "Marquez une pause apres chaque repetition pour verifier si la correction reste visible dans l image.",
            "Terminez par 1 tentative complete capturee puis comparez-la au motif precedent.",
        ],
        "hi": [
            f"5 slow reps kijiye jisme focus sirf {focus_label} par ho, poore stitch par nahi.",
            "Har rep ke baad ruk kar dekhiye ki correction frame me clear rahi ya nahi.",
            "Akhir me 1 full captured attempt kijiye aur use pichhle pattern se compare kijiye.",
        ],
    }
    language_key = language if language in steps else "en"
    return steps[language_key][step_number - 1]


def _adaptive_drill_rep_target(language: FeedbackLanguage) -> str:
    if language == "es":
        return "Objetivo: 5 repeticiones enfocadas y 1 captura completa."
    if language == "fr":
        return "Objectif : 5 repetitions ciblees puis 1 capture complete."
    if language == "hi":
        return "Target: 5 focused reps aur 1 full capture."
    return "Target: 5 focused reps and 1 full capture."


def _humanize_issue_label(code: str, message: str) -> str:
    cleaned_message = message.strip().rstrip(".")
    if cleaned_message:
        sentence = cleaned_message[0].upper() + cleaned_message[1:]
        if len(sentence) <= 60:
            return sentence

    return code.replace("_", " ").replace("-", " ").strip()


def _collect_issue_messages(payload: DebriefRequest, *, graded_only: bool = False) -> list[str]:
    messages: list[str] = []
    events = _graded_events(payload) if graded_only else payload.events
    for event in reversed(events):
        for issue in event.issues:
            candidate = issue.message.strip()
            if candidate and candidate not in messages:
                messages.append(candidate)
    return messages


def _first_non_empty(items: list[str]) -> str | None:
    for item in items:
        candidate = item.strip()
        if candidate:
            return candidate
    return None


def _format_stage_id(stage_id: str) -> str:
    return stage_id.replace("-", " ").replace("_", " ")

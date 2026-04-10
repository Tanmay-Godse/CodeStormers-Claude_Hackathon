"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppFrame } from "@/components/AppFrame";
import { generateKnowledgePack } from "@/lib/api";
import { buildSharedSidebarItems, DEFAULT_TRAINING_HREF } from "@/lib/appShell";
import {
  clearAuthUser,
  createDefaultKnowledgeProgress,
  getKnowledgeProgress,
  saveKnowledgeProgress,
  syncLearningStateFromBackend,
} from "@/lib/storage";
import type {
  FeedbackLanguage,
  KnowledgeProgress,
  KnowledgePackResponse,
  KnowledgeStudyMode,
  KnowledgeTopicSuggestion,
  SessionRecord,
  SkillLevel,
} from "@/lib/types";
import { useWorkspaceUser } from "@/lib/useWorkspaceUser";

const KNOWLEDGE_PROCEDURE_ID = "simple-interrupted-suture";
const RAPIDFIRE_SECONDS = 12;
const KNOWLEDGE_HISTORY_LIMIT = 48;

type KnowledgeTab = "flashcards" | "quiz" | "rapidfire";

const KNOWLEDGE_LANE_META: Record<
  KnowledgeStudyMode,
  { description: string; label: string }
> = {
  current_procedure: {
    label: "Current Procedure",
    description: "Stay close to the live suturing rubric and stage goals.",
  },
  related_topics: {
    label: "Related Topics",
    description: "Learn adjacent concepts that improve the next live rep.",
  },
  common_mistakes: {
    label: "Common Mistakes",
    description: "Practice spotting misses and the best reset for them.",
  },
};

function ratingFromPoints(points: number) {
  if (points >= 700) {
    return "Technique Coach";
  }
  if (points >= 450) {
    return "Sharp Observer";
  }
  if (points >= 250) {
    return "Steady Learner";
  }
  if (points >= 120) {
    return "Focused Starter";
  }
  return "New Challenger";
}

function deriveReviewHref(sessions: SessionRecord[]) {
  return sessions[0] ? `/review/${sessions[0].id}` : DEFAULT_TRAINING_HREF;
}

function deriveRecentIssueLabels(sessions: SessionRecord[]) {
  const issueCounts = new Map<string, number>();

  for (const session of sessions) {
    for (const event of session.events) {
      for (const issue of event.issues) {
        const label = issue.message.trim();
        if (!label) {
          continue;
        }
        issueCounts.set(label, (issueCounts.get(label) ?? 0) + 1);
      }
    }
  }

  return [...issueCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([label]) => label);
}

function deriveLatestSkillLevel(sessions: SessionRecord[]): SkillLevel {
  return sessions[0]?.skillLevel ?? "beginner";
}

function deriveLatestLanguage(sessions: SessionRecord[]): FeedbackLanguage {
  return sessions[0]?.equityMode.feedbackLanguage ?? "en";
}

function buildDefaultTopicSuggestions(
  recentIssueLabels: string[],
): KnowledgeTopicSuggestion[] {
  const suggestions: KnowledgeTopicSuggestion[] = [];

  for (const [index, label] of recentIssueLabels.slice(0, 2).entries()) {
    suggestions.push({
      id: `recent-${index + 1}`,
      label,
      description: "Review a repeated miss from recent practice before the next live run.",
      study_mode: "common_mistakes",
    });
  }

  suggestions.push(
    {
      id: "procedure-overview",
      label: "Procedure Overview",
      description: "Review how the whole rep flows from setup to final check.",
      study_mode: "current_procedure",
    },
    {
      id: "stage-goals",
      label: "Stage Goals",
      description: "Focus on what each stage is actually scored on.",
      study_mode: "current_procedure",
    },
    {
      id: "needle-angle",
      label: "Needle Angle",
      description: "Practice confident entry and exit angles that stay visible.",
      study_mode: "related_topics",
    },
    {
      id: "instrument-grip",
      label: "Instrument Grip",
      description: "Review steady handling before entry and pull-through.",
      study_mode: "related_topics",
    },
    {
      id: "camera-framing",
      label: "Camera Framing",
      description: "Keep the field centered, visible, and easy to judge.",
      study_mode: "related_topics",
    },
    {
      id: "error-spotting",
      label: "Error Spotting",
      description: "Train yourself to recognize common misses earlier.",
      study_mode: "common_mistakes",
    },
  );

  const seen = new Set<string>();
  return suggestions.filter((suggestion) => {
    const key = suggestion.label.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function resetRapidfireState() {
  return {
    bestStreak: 0,
    correct: 0,
    currentStreak: 0,
    finished: false,
    index: 0,
    selectedIndex: null as number | null,
    started: false,
    timeLeft: RAPIDFIRE_SECONDS,
  };
}

function resetQuizState() {
  return {
    correct: 0,
    finished: false,
    index: 0,
    selectedIndex: null as number | null,
  };
}

function normalizeKnowledgeHistory(values: string[]) {
  const normalized: string[] = [];

  for (const value of values) {
    const cleaned = value.trim();
    if (!cleaned || normalized.includes(cleaned)) {
      continue;
    }
    normalized.push(cleaned);
  }

  return normalized.slice(-KNOWLEDGE_HISTORY_LIMIT);
}

function appendKnowledgePackHistory(
  previous: KnowledgeProgress,
  pack: KnowledgePackResponse,
): KnowledgeProgress {
  return {
    ...previous,
    recentQuestionPrompts: normalizeKnowledgeHistory([
      ...previous.recentQuestionPrompts,
      ...pack.rapidfire_rounds.map((question) => question.prompt),
      ...pack.quiz_questions.map((question) => question.prompt),
    ]),
    recentFlashcardFronts: normalizeKnowledgeHistory([
      ...previous.recentFlashcardFronts,
      ...pack.flashcards.map((flashcard) => flashcard.front),
    ]),
  };
}

export default function KnowledgePage() {
  const router = useRouter();
  const { hydrated, sessions, user } = useWorkspaceUser();
  const [knowledgePack, setKnowledgePack] = useState<KnowledgePackResponse | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [isPackLoading, setIsPackLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<KnowledgeTab>("rapidfire");
  const [studyMode, setStudyMode] = useState<KnowledgeStudyMode>("current_procedure");
  const [selectedTopic, setSelectedTopic] = useState("");
  const [progress, setProgress] = useState<KnowledgeProgress>(
    createDefaultKnowledgeProgress,
  );
  const [rapidfireState, setRapidfireState] = useState(resetRapidfireState);
  const [quizState, setQuizState] = useState(resetQuizState);
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [flashcardFlipped, setFlashcardFlipped] = useState(false);
  const [flashcardsKnown, setFlashcardsKnown] = useState<string[]>([]);
  const knowledgeRequestIdRef = useRef(0);
  const progressRef = useRef(progress);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    if (hydrated && !user) {
      router.replace("/login?role=student&next=%2Fknowledge");
      return;
    }

    if (hydrated && user?.isDeveloper) {
      router.replace("/developer/approvals");
      return;
    }
  }, [hydrated, router, user]);

  useEffect(() => {
    if (!user) {
      setProgress(createDefaultKnowledgeProgress());
      return;
    }

    const username = user.username;
    let cancelled = false;
    setProgress(getKnowledgeProgress(username));

    async function hydrateProgress() {
      try {
        await syncLearningStateFromBackend();
      } catch {
        return;
      }

      if (!cancelled) {
        setProgress(getKnowledgeProgress(username));
      }
    }

    void hydrateProgress();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const latestReviewHref = useMemo(() => deriveReviewHref(sessions), [sessions]);
  const hasSavedSession = sessions.length > 0;
  const recentIssueLabels = useMemo(() => deriveRecentIssueLabels(sessions), [sessions]);
  const focusArea = recentIssueLabels[0] ?? "needle entry consistency";
  const latestSkillLevel = useMemo(() => deriveLatestSkillLevel(sessions), [sessions]);
  const latestLanguage = useMemo(() => deriveLatestLanguage(sessions), [sessions]);
  const defaultTopicSuggestions = useMemo(
    () => buildDefaultTopicSuggestions(recentIssueLabels),
    [recentIssueLabels],
  );

  const updateProgress = useCallback(
    (mutator: (previous: KnowledgeProgress) => KnowledgeProgress) => {
      if (!user) {
        return;
      }

      setProgress((previous) => {
        const next = mutator(previous);
        saveKnowledgeProgress(user.username, next);
        return next;
      });
    },
    [user],
  );

  function resetInteractiveState() {
    setRapidfireState(resetRapidfireState());
    setQuizState(resetQuizState());
    setFlashcardIndex(0);
    setFlashcardFlipped(false);
    setFlashcardsKnown([]);
  }

  const loadKnowledgePack = useCallback(
    async (
      overrides?: Partial<{
        selectedTopic: string;
        studyMode: KnowledgeStudyMode;
      }>,
    ) => {
      if (!user) {
        return;
      }

      const nextStudyMode = overrides?.studyMode ?? studyMode;
      const nextSelectedTopic = overrides?.selectedTopic ?? selectedTopic;
      const requestId = knowledgeRequestIdRef.current + 1;
      knowledgeRequestIdRef.current = requestId;
      setIsPackLoading(true);
      setPackError(null);

      try {
        const nextPack = await generateKnowledgePack({
          procedure_id: KNOWLEDGE_PROCEDURE_ID,
          skill_level: latestSkillLevel,
          feedback_language: latestLanguage,
          learner_name: user.name,
          focus_area: nextSelectedTopic || focusArea,
          study_mode: nextStudyMode,
          selected_topic: nextSelectedTopic || undefined,
          recent_issue_labels: recentIssueLabels,
          avoid_question_prompts: progressRef.current.recentQuestionPrompts,
          avoid_flashcard_fronts: progressRef.current.recentFlashcardFronts,
          generation_nonce:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${Date.now()}`,
        });
        if (knowledgeRequestIdRef.current !== requestId) {
          return;
        }
        setKnowledgePack(nextPack);
        setStudyMode(nextPack.study_mode);
        setSelectedTopic(nextPack.topic_title);
        resetInteractiveState();
        updateProgress((previous) => {
          const nextProgress = appendKnowledgePackHistory(previous, nextPack);
          progressRef.current = nextProgress;
          return nextProgress;
        });
      } catch (error) {
        if (knowledgeRequestIdRef.current !== requestId) {
          return;
        }
        setPackError(
          error instanceof Error
            ? error.message
            : "Knowledge lab is unavailable right now. Try again in a moment.",
        );
      } finally {
        if (knowledgeRequestIdRef.current === requestId) {
          setIsPackLoading(false);
        }
      }
    },
    [
      focusArea,
      latestLanguage,
      latestSkillLevel,
      recentIssueLabels,
      selectedTopic,
      studyMode,
      updateProgress,
      user,
    ],
  );

  useEffect(() => {
    if (!user) {
      return;
    }

    void loadKnowledgePack();
  }, [loadKnowledgePack, user]);

  useEffect(() => {
    return () => {
      knowledgeRequestIdRef.current += 1;
    };
  }, []);

  const rapidfireQuestions = knowledgePack?.rapidfire_rounds ?? [];
  const quizQuestions = knowledgePack?.quiz_questions ?? [];
  const flashcards = knowledgePack?.flashcards ?? [];
  const topicSuggestions = knowledgePack?.topic_suggestions ?? defaultTopicSuggestions;
  const currentRapidfireQuestion =
    rapidfireQuestions[rapidfireState.index] ?? null;
  const currentQuizQuestion = quizQuestions[quizState.index] ?? null;
  const currentFlashcard = flashcards[flashcardIndex] ?? null;
  const rating = ratingFromPoints(progress.totalPoints);
  const activeTopicLabel = selectedTopic || knowledgePack?.topic_title || focusArea;
  const accuracyPercent =
    progress.answeredCount > 0
      ? Math.round((progress.correctCount / progress.answeredCount) * 100)
      : 0;

  useEffect(() => {
    if (
      activeTab !== "rapidfire" ||
      !rapidfireState.started ||
      rapidfireState.finished ||
      rapidfireState.selectedIndex !== null
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      let didTimeOut = false;
      setRapidfireState((previous) => {
        if (previous.selectedIndex !== null || previous.finished) {
          return previous;
        }

        if (previous.timeLeft <= 1) {
          didTimeOut = true;
          return {
            ...previous,
            currentStreak: 0,
            selectedIndex: -1,
            timeLeft: 0,
          };
        }

        return {
          ...previous,
          timeLeft: previous.timeLeft - 1,
        };
      });

      if (didTimeOut) {
        updateProgress((previous) => ({
          ...previous,
          answeredCount: previous.answeredCount + 1,
        }));
      }
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [
    activeTab,
    rapidfireState.finished,
    rapidfireState.selectedIndex,
    rapidfireState.started,
    updateProgress,
  ]);

  function handleLogout() {
    clearAuthUser();
    router.push("/login");
  }

  function handleStudyModeChange(nextMode: KnowledgeStudyMode) {
    setStudyMode(nextMode);
    setSelectedTopic("");
    void loadKnowledgePack({ selectedTopic: "", studyMode: nextMode });
  }

  function handleTopicSelect(topic: KnowledgeTopicSuggestion) {
    setStudyMode(topic.study_mode);
    setSelectedTopic(topic.label);
    void loadKnowledgePack({
      selectedTopic: topic.label,
      studyMode: topic.study_mode,
    });
  }

  function startRapidfire() {
    setRapidfireState({
      ...resetRapidfireState(),
      started: true,
    });
  }

  function answerRapidfire(choiceIndex: number) {
    if (!currentRapidfireQuestion || rapidfireState.selectedIndex !== null) {
      return;
    }

    const isCorrect = choiceIndex === currentRapidfireQuestion.correct_index;
    const nextStreak = isCorrect ? rapidfireState.currentStreak + 1 : 0;
    const nextBest = Math.max(rapidfireState.bestStreak, nextStreak);

    if (isCorrect) {
      updateProgress((previous) => ({
        ...previous,
        answeredCount: previous.answeredCount + 1,
        correctCount: previous.correctCount + 1,
        rapidfireBestStreak: Math.max(previous.rapidfireBestStreak, nextBest),
        totalPoints: previous.totalPoints + currentRapidfireQuestion.point_value,
      }));
    } else {
      updateProgress((previous) => ({
        ...previous,
        answeredCount: previous.answeredCount + 1,
      }));
    }

    setRapidfireState((previous) => ({
      ...previous,
      bestStreak: nextBest,
      correct: previous.correct + (isCorrect ? 1 : 0),
      currentStreak: nextStreak,
      selectedIndex: choiceIndex,
    }));
  }

  function advanceRapidfire() {
    if (!currentRapidfireQuestion) {
      return;
    }

    const isLastQuestion = rapidfireState.index >= rapidfireQuestions.length - 1;
    if (isLastQuestion) {
      setRapidfireState((previous) => ({
        ...previous,
        finished: true,
      }));
      return;
    }

    setRapidfireState((previous) => ({
      ...previous,
      index: previous.index + 1,
      selectedIndex: null,
      timeLeft: RAPIDFIRE_SECONDS,
    }));
  }

  function answerQuiz(choiceIndex: number) {
    if (!currentQuizQuestion || quizState.selectedIndex !== null) {
      return;
    }

    const isCorrect = choiceIndex === currentQuizQuestion.correct_index;
    updateProgress((previous) => ({
      ...previous,
      answeredCount: previous.answeredCount + 1,
      correctCount: previous.correctCount + (isCorrect ? 1 : 0),
      totalPoints: previous.totalPoints + (isCorrect ? currentQuizQuestion.point_value : 0),
    }));

    setQuizState((previous) => ({
      ...previous,
      correct: previous.correct + (isCorrect ? 1 : 0),
      selectedIndex: choiceIndex,
    }));
  }

  function advanceQuiz() {
    if (!currentQuizQuestion) {
      return;
    }

    const isLastQuestion = quizState.index >= quizQuestions.length - 1;
    if (isLastQuestion) {
      const perfectRound = quizState.correct === quizQuestions.length;
      updateProgress((previous) => ({
        ...previous,
        completedQuizRounds: previous.completedQuizRounds + 1,
        perfectRounds: previous.perfectRounds + (perfectRound ? 1 : 0),
      }));
      setQuizState((previous) => ({
        ...previous,
        finished: true,
      }));
      return;
    }

    setQuizState((previous) => ({
      ...previous,
      index: previous.index + 1,
      selectedIndex: null,
    }));
  }

  function markFlashcard(known: boolean) {
    if (!currentFlashcard) {
      return;
    }

    if (known && !flashcardsKnown.includes(currentFlashcard.id)) {
      setFlashcardsKnown((previous) => [...previous, currentFlashcard.id]);
      updateProgress((previous) => ({
        ...previous,
        flashcardsMastered: previous.flashcardsMastered + 1,
        totalPoints: previous.totalPoints + currentFlashcard.point_value,
      }));
    }

    setFlashcardFlipped(false);
    setFlashcardIndex((previous) => {
      if (previous >= flashcards.length - 1) {
        return 0;
      }
      return previous + 1;
    });
  }

  if (!hydrated || !user) {
    return (
      <AppFrame
        brandSubtitle="Knowledge lab"
        pageTitle="Knowledge Lab"
        sidebarItems={buildSharedSidebarItems({ active: "knowledge", userRole: null })}
      >
        <section className="dashboard-card dashboard-frame-panel">
          <span className="dashboard-card-eyebrow">Preparing Knowledge Lab</span>
          <h2>Checking your workspace profile.</h2>
          <p>We’re loading your study mode and recent practice context.</p>
        </section>
      </AppFrame>
    );
  }

  return (
    <AppFrame
      brandSubtitle="Gamified study mode"
      footerPrimaryAction={{
        href: DEFAULT_TRAINING_HREF,
        icon: "play",
        label: "Start Live Session",
        strong: true,
      }}
      footerSecondaryActions={[
        {
          href: latestReviewHref,
          icon: "review",
          label: hasSavedSession ? "Latest Review" : "Open Trainer",
        },
        { href: "/library", icon: "book", label: "Practice Guide" },
        { icon: "logout", label: "Logout", onClick: handleLogout },
      ]}
      pageTitle="Knowledge Lab"
      sidebarItems={buildSharedSidebarItems({
        active: "knowledge",
        isDeveloper: user.isDeveloper,
        reviewHref: latestReviewHref,
        userRole: user.role,
      })}
      statusPill={{ icon: "spark", label: rating }}
      topActions={[
        { href: latestReviewHref, label: hasSavedSession ? "Latest Review" : "Open Trainer" },
        { href: DEFAULT_TRAINING_HREF, label: "Open Trainer", strong: true },
      ]}
      userName={user.name}
    >
      <section className="dashboard-hero knowledge-hero">
        <div>
          <span className="dashboard-kicker">Knowledge Lab</span>
          <h1>Study the procedure, related concepts, or common mistakes in one place.</h1>
          <p>
            Use quick rounds, a deeper quiz, and flashcards to strengthen the next live
            session. You can stay close to the procedure or branch into related topics
            that still improve your suturing reps.
          </p>
        </div>
        <div className="dashboard-hero-meta">
          <span>{rating}</span>
          <span>{activeTopicLabel}</span>
          <button
            className="dashboard-action-pill is-strong"
            onClick={() => void loadKnowledgePack()}
            type="button"
          >
            New AI Round
          </button>
        </div>
      </section>

      <section className="knowledge-summary-grid">
        <article className="dashboard-card dashboard-kpi-card knowledge-summary-card">
          <span>Total points</span>
          <strong>{progress.totalPoints}</strong>
          <p>Your running score across quizzes, rounds, and flashcards.</p>
        </article>
        <article className="dashboard-card dashboard-kpi-card knowledge-summary-card">
          <span>Accuracy</span>
          <strong>{accuracyPercent}%</strong>
          <p>Correct answers across all knowledge checks.</p>
        </article>
        <article className="dashboard-card dashboard-kpi-card knowledge-summary-card">
          <span>Best streak</span>
          <strong>{progress.rapidfireBestStreak}</strong>
          <p>Your strongest rapid-fire run so far.</p>
        </article>
        <article className="dashboard-card dashboard-kpi-card knowledge-summary-card">
          <span>Flashcards mastered</span>
          <strong>{progress.flashcardsMastered}</strong>
          <p>Cards you marked as learned during study rounds.</p>
        </article>
      </section>

      {packError ? (
        <article className="feedback-block knowledge-feedback-block">
          <div className="feedback-header">
            <strong>Knowledge pack unavailable</strong>
          </div>
          <p className="feedback-copy">{packError}</p>
        </article>
      ) : null}

      <div className="dashboard-grid">
        <div className="dashboard-left-column">
          <article className="dashboard-card knowledge-pack-card">
            <div className="dashboard-card-header">
              <div>
                <span className="dashboard-card-eyebrow">Current Pack</span>
                <h2>{knowledgePack?.title ?? "Building your knowledge pack"}</h2>
              </div>
              <span className="dashboard-meta-chip">
                {isPackLoading ? "loading" : knowledgePack ? "ready" : "waiting"}
              </span>
            </div>
            <p className="library-lead-copy">
              {knowledgePack?.summary ??
                "Generating a study set from the suturing rubric and your recent practice context."}
            </p>
            <div className="knowledge-chip-row">
              <span className="dashboard-meta-chip">
                Lane: {KNOWLEDGE_LANE_META[studyMode].label}
              </span>
              <span className="dashboard-meta-chip">
                Topic: {knowledgePack?.topic_title ?? activeTopicLabel}
              </span>
              <span className="dashboard-meta-chip">
                Focus: {knowledgePack?.recommended_focus ?? focusArea}
              </span>
              <span className="dashboard-meta-chip">
                Quiz rounds: {progress.completedQuizRounds}
              </span>
              <span className="dashboard-meta-chip">
                Perfect rounds: {progress.perfectRounds}
              </span>
            </div>
            <div className="knowledge-lane-row">
              {(Object.entries(KNOWLEDGE_LANE_META) as Array<
                [KnowledgeStudyMode, (typeof KNOWLEDGE_LANE_META)[KnowledgeStudyMode]]
              >).map(([mode, meta]) => (
                <button
                  className={`knowledge-lane-pill ${studyMode === mode ? "is-active" : ""}`}
                  key={mode}
                  onClick={() => handleStudyModeChange(mode)}
                  type="button"
                >
                  <strong>{meta.label}</strong>
                  <span>{meta.description}</span>
                </button>
              ))}
            </div>
            <div className="knowledge-topic-section">
              <div className="dashboard-card-header">
                <div>
                  <span className="dashboard-card-eyebrow">Suggested Topics</span>
                  <h3>Pick what you want to study next.</h3>
                </div>
              </div>
              <div className="knowledge-suggestion-grid">
                {topicSuggestions.map((topic) => (
                  <button
                    className={`knowledge-suggestion-card ${
                      activeTopicLabel === topic.label ? "is-active" : ""
                    }`}
                    key={topic.id}
                    onClick={() => handleTopicSelect(topic)}
                    type="button"
                  >
                    <span className="dashboard-card-eyebrow">
                      {KNOWLEDGE_LANE_META[topic.study_mode].label}
                    </span>
                    <strong>{topic.label}</strong>
                    <p>{topic.description}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="knowledge-tab-row">
              <button
                className={`knowledge-tab ${activeTab === "rapidfire" ? "is-active" : ""}`}
                onClick={() => setActiveTab("rapidfire")}
                type="button"
              >
                Rapidfire
              </button>
              <button
                className={`knowledge-tab ${activeTab === "quiz" ? "is-active" : ""}`}
                onClick={() => setActiveTab("quiz")}
                type="button"
              >
                Quiz
              </button>
              <button
                className={`knowledge-tab ${activeTab === "flashcards" ? "is-active" : ""}`}
                onClick={() => setActiveTab("flashcards")}
                type="button"
              >
                Flashcards
              </button>
            </div>

            {activeTab === "rapidfire" ? (
              <section className="knowledge-mode-panel">
                {!rapidfireState.started || rapidfireState.finished ? (
                  <div className="knowledge-round-summary">
                    <div>
                      <span className="dashboard-card-eyebrow">Rapidfire Round</span>
                      <h3>
                        {rapidfireState.finished
                          ? `${rapidfireState.correct}/${rapidfireQuestions.length} correct`
                          : "Ready to sprint through the rubric?"}
                      </h3>
                      <p>
                        {rapidfireState.finished
                          ? knowledgePack?.celebration_line ??
                            "You finished the round. Generate a fresh one or head back to the trainer."
                          : "You get 12 seconds per question. Correct answers build streaks and points fast."}
                      </p>
                    </div>
                    <div className="knowledge-metric-strip">
                      <div>
                        <span>Current streak</span>
                        <strong>{rapidfireState.currentStreak}</strong>
                      </div>
                      <div>
                        <span>Best this round</span>
                        <strong>{rapidfireState.bestStreak}</strong>
                      </div>
                    </div>
                    <div className="dashboard-frame-actions">
                      <button
                        className="dashboard-primary-button"
                        onClick={startRapidfire}
                        type="button"
                      >
                        {rapidfireState.finished ? "Play Again" : "Start Rapidfire"}
                      </button>
                      <button
                        className="dashboard-action-pill"
                        onClick={() => void loadKnowledgePack()}
                        type="button"
                      >
                        Refresh Pack
                      </button>
                    </div>
                  </div>
                ) : currentRapidfireQuestion ? (
                  <div className="knowledge-question-shell">
                    <div className="knowledge-question-topline">
                      <span className="dashboard-card-eyebrow">
                        Question {rapidfireState.index + 1} of {rapidfireQuestions.length}
                      </span>
                      <span className="knowledge-timer">{rapidfireState.timeLeft}s</span>
                    </div>
                    <h3>{currentRapidfireQuestion.prompt}</h3>
                    <div className="knowledge-choice-grid">
                      {currentRapidfireQuestion.choices.map((choice, index) => {
                        const isSelected = rapidfireState.selectedIndex === index;
                        const isCorrect = index === currentRapidfireQuestion.correct_index;
                        const showCorrect =
                          rapidfireState.selectedIndex !== null && isCorrect;
                        const stateClass =
                          rapidfireState.selectedIndex === null
                            ? ""
                            : showCorrect
                              ? "is-correct"
                              : isSelected
                                ? "is-wrong"
                                : "";

                        return (
                          <button
                            className={`knowledge-choice ${stateClass}`}
                            key={`${currentRapidfireQuestion.id}:${choice}`}
                            onClick={() => answerRapidfire(index)}
                            type="button"
                          >
                            {choice}
                          </button>
                        );
                      })}
                    </div>
                    {rapidfireState.selectedIndex !== null ? (
                      <div className="knowledge-explanation-card">
                        <strong>
                          {rapidfireState.selectedIndex === currentRapidfireQuestion.correct_index
                            ? "Correct"
                            : rapidfireState.selectedIndex === -1
                              ? "Time is up"
                              : "Not quite"}
                        </strong>
                        <p>{currentRapidfireQuestion.explanation}</p>
                        <button
                          className="dashboard-primary-button"
                          onClick={advanceRapidfire}
                          type="button"
                        >
                          {rapidfireState.index >= rapidfireQuestions.length - 1
                            ? "Finish Round"
                            : "Next Question"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            {activeTab === "quiz" ? (
              <section className="knowledge-mode-panel">
                {currentQuizQuestion && !quizState.finished ? (
                  <div className="knowledge-question-shell">
                    <div className="knowledge-question-topline">
                      <span className="dashboard-card-eyebrow">
                        Quiz {quizState.index + 1} of {quizQuestions.length}
                      </span>
                      <span className="dashboard-meta-chip">
                        {currentQuizQuestion.difficulty}
                      </span>
                    </div>
                    <h3>{currentQuizQuestion.prompt}</h3>
                    <div className="knowledge-choice-grid">
                      {currentQuizQuestion.choices.map((choice, index) => {
                        const isSelected = quizState.selectedIndex === index;
                        const isCorrect = index === currentQuizQuestion.correct_index;
                        const showCorrect = quizState.selectedIndex !== null && isCorrect;
                        const stateClass =
                          quizState.selectedIndex === null
                            ? ""
                            : showCorrect
                              ? "is-correct"
                              : isSelected
                                ? "is-wrong"
                                : "";

                        return (
                          <button
                            className={`knowledge-choice ${stateClass}`}
                            key={`${currentQuizQuestion.id}:${choice}`}
                            onClick={() => answerQuiz(index)}
                            type="button"
                          >
                            {choice}
                          </button>
                        );
                      })}
                    </div>
                    {quizState.selectedIndex !== null ? (
                      <div className="knowledge-explanation-card">
                        <strong>
                          {quizState.selectedIndex === currentQuizQuestion.correct_index
                            ? "Correct answer"
                            : "Review this cue"}
                        </strong>
                        <p>{currentQuizQuestion.explanation}</p>
                        <button
                          className="dashboard-primary-button"
                          onClick={advanceQuiz}
                          type="button"
                        >
                          {quizState.index >= quizQuestions.length - 1
                            ? "Finish Quiz"
                            : "Next Question"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="knowledge-round-summary">
                    <div>
                      <span className="dashboard-card-eyebrow">Quiz Complete</span>
                      <h3>
                        {quizState.correct}/{quizQuestions.length || 0} correct
                      </h3>
                      <p>
                        Use the explanation cards to spot what the trainer expects, then
                        take that mental model back into the live session.
                      </p>
                    </div>
                    <div className="dashboard-frame-actions">
                      <button
                        className="dashboard-primary-button"
                        onClick={() => setQuizState(resetQuizState())}
                        type="button"
                      >
                        Restart Quiz
                      </button>
                      <Link className="dashboard-action-pill" href={DEFAULT_TRAINING_HREF}>
                        Back to trainer
                      </Link>
                    </div>
                  </div>
                )}
              </section>
            ) : null}

            {activeTab === "flashcards" ? (
              <section className="knowledge-mode-panel">
                {currentFlashcard ? (
                  <>
                    <div className="knowledge-question-topline">
                      <span className="dashboard-card-eyebrow">
                        Card {flashcardIndex + 1} of {flashcards.length}
                      </span>
                      <span className="dashboard-meta-chip">
                        Learned this round: {flashcardsKnown.length}
                      </span>
                    </div>
                    <button
                      className={`knowledge-flashcard ${flashcardFlipped ? "is-flipped" : ""}`}
                      onClick={() => setFlashcardFlipped((previous) => !previous)}
                      type="button"
                    >
                      <div className="knowledge-flashcard-face knowledge-flashcard-front">
                        <span className="dashboard-card-eyebrow">Prompt</span>
                        <h3>{currentFlashcard.front}</h3>
                        <p>Tap to flip the card.</p>
                      </div>
                      <div className="knowledge-flashcard-face knowledge-flashcard-back">
                        <span className="dashboard-card-eyebrow">Answer</span>
                        <h3>{currentFlashcard.back}</h3>
                        <p>{currentFlashcard.memory_tip}</p>
                      </div>
                    </button>
                    <div className="dashboard-frame-actions">
                      <button
                        className="dashboard-action-pill"
                        onClick={() => markFlashcard(false)}
                        type="button"
                      >
                        Need Again
                      </button>
                      <button
                        className="dashboard-primary-button"
                        onClick={() => markFlashcard(true)}
                        type="button"
                      >
                        Got It
                      </button>
                    </div>
                  </>
                ) : null}
              </section>
            ) : null}
          </article>
        </div>

        <div className="dashboard-right-column">
          <article className="dashboard-card knowledge-side-card">
            <div className="dashboard-card-header">
              <div>
                <span className="dashboard-card-eyebrow">Scoreboard</span>
                <h2>Your current rating</h2>
              </div>
              <span className="dashboard-meta-chip">{rating}</span>
            </div>
            <div className="knowledge-score-stack">
              <div>
                <span>Total points</span>
                <strong>{progress.totalPoints}</strong>
              </div>
              <div>
                <span>Answered</span>
                <strong>{progress.answeredCount}</strong>
              </div>
              <div>
                <span>Correct</span>
                <strong>{progress.correctCount}</strong>
              </div>
            </div>
          </article>

          <article className="dashboard-card knowledge-side-card">
            <div className="dashboard-card-header">
              <div>
                <span className="dashboard-card-eyebrow">Recommended Focus</span>
                <h2>What to keep in mind next</h2>
              </div>
            </div>
            <p className="library-lead-copy">
              {knowledgePack?.recommended_focus ?? focusArea}
            </p>
            <ul className="library-guardrail-list">
              {recentIssueLabels.length > 0 ? (
                recentIssueLabels.map((item) => <li key={item}>{item}</li>)
              ) : (
                <li>Use the knowledge round to sharpen one stage before the next session.</li>
              )}
            </ul>
          </article>

          <article className="dashboard-card knowledge-side-card">
            <div className="dashboard-card-header">
              <div>
                <span className="dashboard-card-eyebrow">Learning Lanes</span>
                <h2>Use the lab in the way you need today.</h2>
              </div>
            </div>
            <ul className="library-guardrail-list">
              <li>Current Procedure keeps you close to what the trainer will actually grade.</li>
              <li>Related Topics helps you study adjacent ideas like grip, angle, and framing.</li>
              <li>Common Mistakes turns recent misses into a focused study target.</li>
            </ul>
          </article>

          <article className="dashboard-card knowledge-side-card">
            <div className="dashboard-card-header">
              <div>
                <span className="dashboard-card-eyebrow">Study Suggestions</span>
                <h2>Good next topics for this learner</h2>
              </div>
            </div>
            <ul className="library-guardrail-list">
              {topicSuggestions.slice(0, 4).map((topic) => (
                <li key={`suggestion:${topic.id}`}>
                  <strong>{topic.label}.</strong> {topic.description}
                </li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    </AppFrame>
  );
}

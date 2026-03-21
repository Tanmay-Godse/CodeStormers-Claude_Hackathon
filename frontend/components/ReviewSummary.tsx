"use client";

import { useEffect, useState } from "react";

import { canUseSpeechSynthesis, speakText, stopSpeechPlayback } from "@/lib/audio";
import { getFeedbackLanguageLabel } from "@/lib/equity";
import type {
  DebriefResponse,
  ProcedureDefinition,
  ReviewCase,
  SessionEvent,
  SessionRecord,
} from "@/lib/types";

type ReviewSummaryProps = {
  session: SessionRecord;
  procedure: ProcedureDefinition | null;
  debrief: DebriefResponse | null;
  isDebriefLoading: boolean;
  debriefError: string | null;
  isOnline: boolean;
  reviewCases: ReviewCase[];
};

function toStageLabel(stageId: string, procedure: ProcedureDefinition | null) {
  return (
    procedure?.stages.find((stage) => stage.id === stageId)?.title ??
    stageId.replaceAll("-", " ").replaceAll("_", " ")
  );
}

function getStatusClass(status: SessionEvent["stepStatus"]) {
  return `status-badge status-${status}`;
}

export function ReviewSummary({
  session,
  procedure,
  debrief,
  isDebriefLoading,
  debriefError,
  isOnline,
  reviewCases,
}: ReviewSummaryProps) {
  const totalScore = session.events.reduce((sum, event) => sum + event.scoreDelta, 0);
  const latestFeedback = session.events.at(-1)?.coachingMessage ?? "No coaching recorded yet.";
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    return () => {
      stopSpeechPlayback();
    };
  }, []);

  function handlePlayDebriefAudio() {
    if (!debrief) {
      return;
    }

    const didSpeak = speakText(
      debrief.audio_script,
      session.equityMode.feedbackLanguage,
    );
    setIsSpeaking(didSpeak);
  }

  function handleStopDebriefAudio() {
    stopSpeechPlayback();
    setIsSpeaking(false);
  }

  return (
    <section className="review-grid">
      <article className="panel">
        <span className="pill">Session recap</span>
        <h1 className="review-title" style={{ marginTop: 16 }}>
          Phase 3 review
        </h1>
        <p className="review-subtle" style={{ marginTop: 14 }}>
          This page hydrates from browser session data first, then layers on a stored
          session debrief when one is available.
        </p>
        <p className="review-score" style={{ marginTop: 18 }}>
          {totalScore}
        </p>
        <p className="review-subtle">
          Total score across {session.events.length} logged attempts.
        </p>

        <div className="summary-grid" style={{ marginTop: 22 }}>
          <article className="metric-card">
            <p className="metric-label">Procedure</p>
            <p className="metric-value">{procedure?.title ?? session.procedureId}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Skill level</p>
            <p className="metric-value">{session.skillLevel}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Last update</p>
            <p className="metric-value">
              {new Date(session.updatedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Equity mode</p>
            <p className="metric-value">
              {session.equityMode.enabled
                ? getFeedbackLanguageLabel(session.equityMode.feedbackLanguage)
                : "Standard"}
            </p>
          </article>
        </div>

        <article className="review-card" style={{ marginTop: 22 }}>
          <header>
            <strong>Last coaching cue</strong>
            <span className="pill">Latest attempt</span>
          </header>
          <p className="review-subtle">{latestFeedback}</p>
        </article>
      </article>

      <section>
        <article className="review-card">
          <header>
            <strong>Session debrief</strong>
            <span className="pill">Study summary</span>
          </header>
          <p className="review-subtle" style={{ marginTop: 12 }}>
            Connection: {isOnline ? "online" : "offline"}. Feedback language:{" "}
            {getFeedbackLanguageLabel(session.equityMode.feedbackLanguage)}.
          </p>
          {isDebriefLoading ? (
            <p className="review-subtle">
              Building the session debrief from the stored stage history.
            </p>
          ) : null}

          {!isDebriefLoading && debriefError ? (
            <div className="feedback-block" style={{ marginTop: 14 }}>
              <div className="feedback-header">
                <strong>Debrief unavailable</strong>
                <span className="status-badge status-unsafe">attention</span>
              </div>
              <p className="review-subtle">{debriefError}</p>
            </div>
          ) : null}

          {!isDebriefLoading && !debriefError && session.events.length === 0 ? (
            <p className="review-subtle">
              Capture at least one analyzed step to generate the personalized AI debrief.
            </p>
          ) : null}

          {!isDebriefLoading && !debriefError && debrief ? (
            <div className="debrief-stack">
              <section className="debrief-block">
                <strong>Strengths</strong>
                <ul className="feedback-list" style={{ marginTop: 12 }}>
                  {debrief.strengths.map((item, index) => (
                    <li key={`${index}-${item}`}>{item}</li>
                  ))}
                </ul>
              </section>

              <section className="debrief-block">
                <strong>Improvement areas</strong>
                <ul className="feedback-list" style={{ marginTop: 12 }}>
                  {debrief.improvement_areas.map((item, index) => (
                    <li key={`${index}-${item}`}>{item}</li>
                  ))}
                </ul>
              </section>

              <section className="debrief-block">
                <strong>3-step practice plan</strong>
                <ol className="numbered-list" style={{ marginTop: 12 }}>
                  {debrief.practice_plan.map((item, index) => (
                    <li key={`${index}-${item}`}>{item}</li>
                  ))}
                </ol>
              </section>

              <section className="debrief-block">
                <strong>Equity support plan</strong>
                <ul className="feedback-list" style={{ marginTop: 12 }}>
                  {debrief.equity_support_plan.map((item, index) => (
                    <li key={`${index}-${item}`}>{item}</li>
                  ))}
                </ul>
              </section>

              {session.equityMode.enabled &&
              session.equityMode.audioCoaching &&
              canUseSpeechSynthesis() ? (
                <section className="debrief-block">
                  <strong>Audio coaching</strong>
                  <p className="review-subtle" style={{ marginTop: 10 }}>
                    {debrief.audio_script}
                  </p>
                  <div className="button-row" style={{ marginTop: 12 }}>
                    <button
                      className="button-secondary"
                      onClick={handlePlayDebriefAudio}
                      type="button"
                    >
                      Play Debrief Audio
                    </button>
                    {isSpeaking ? (
                      <button
                        className="button-ghost"
                        onClick={handleStopDebriefAudio}
                        type="button"
                      >
                        Stop Audio
                      </button>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <section className="debrief-block">
                <strong>Quick quiz</strong>
                <ul className="timeline-list" style={{ marginTop: 12 }}>
                  {debrief.quiz.map((item, index) => (
                    <li className="timeline-item" key={`${index}-${item.question}`}>
                      <p style={{ margin: 0, fontWeight: 700 }}>{item.question}</p>
                      <p className="review-subtle" style={{ marginTop: 10 }}>
                        {item.answer}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          ) : null}
        </article>

        <article className="review-card" style={{ marginTop: 20 }}>
          <header>
            <strong>Stage timeline</strong>
            <span className="pill">{session.events.length} logged attempts</span>
          </header>
          <ul className="timeline-list">
            {session.events.map((event) => (
              <li className="timeline-item" key={`${event.stageId}-${event.createdAt}`}>
                <header>
                  <strong>{toStageLabel(event.stageId, procedure)}</strong>
                  <span className={getStatusClass(event.stepStatus)}>
                    {event.stepStatus}
                  </span>
                </header>
                <p className="review-subtle">
                  Attempt {event.attempt}. Score delta {event.scoreDelta}. Overlay targets:{" "}
                  {event.overlayTargetIds.join(", ") || "none"}.
                </p>
                <p className="review-subtle">{event.coachingMessage}</p>
              </li>
            ))}
          </ul>
        </article>

        <article className="review-card" style={{ marginTop: 20 }}>
          <header>
            <strong>Human review status</strong>
            <span className="pill">{reviewCases.length} flagged case(s)</span>
          </header>
          {reviewCases.length === 0 ? (
            <p className="review-subtle">
              No human-review cases were attached to this session.
            </p>
          ) : (
            <ul className="timeline-list">
              {reviewCases.map((caseItem) => (
                <li className="timeline-item" key={caseItem.id}>
                  <header>
                    <strong>{toStageLabel(caseItem.stage_id, procedure)}</strong>
                    <span className={`status-badge status-${caseItem.status === "resolved" ? "pass" : "retry"}`}>
                      {caseItem.status}
                    </span>
                  </header>
                  <p className="review-subtle">{caseItem.trigger_reason}</p>
                  <p className="review-subtle">
                    Safety gate: {caseItem.safety_gate.status}. Source: {caseItem.source}.
                  </p>
                  {caseItem.reviewer_notes ? (
                    <p className="review-subtle">Reviewer note: {caseItem.reviewer_notes}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="review-card" style={{ marginTop: 20 }}>
          <header>
            <strong>Offline practice logs</strong>
            <span className="pill">{session.offlinePracticeLogs.length} saved log(s)</span>
          </header>
          {session.offlinePracticeLogs.length === 0 ? (
            <p className="review-subtle">
              No offline-only practice attempts were recorded for this session.
            </p>
          ) : (
            <ul className="timeline-list">
              {session.offlinePracticeLogs.map((log) => (
                <li className="timeline-item" key={log.id}>
                  <header>
                    <strong>{toStageLabel(log.stageId, procedure)}</strong>
                    <span className="pill">offline saved</span>
                  </header>
                  <p className="review-subtle">
                    Frame {log.frameWidth}x{log.frameHeight}. Low-bandwidth:{" "}
                    {log.lowBandwidthMode ? "yes" : "no"}. Cheap-phone mode:{" "}
                    {log.cheapPhoneMode ? "yes" : "no"}.
                  </p>
                  {log.note ? (
                    <p className="review-subtle">Learner note: {log.note}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
    </section>
  );
}

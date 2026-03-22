"use client";

import { useEffect, useState } from "react";

import { speakText, stopSpeechPlayback } from "@/lib/audio";
import { getFeedbackLanguageLabel } from "@/lib/equity";
import { inferEventGraded } from "@/lib/learnerProfile";
import type {
  AdaptiveDrill,
  DebriefResponse,
  ErrorFingerprintItem,
  LearnerProfileSnapshot,
  ProcedureDefinition,
  ReviewCase,
  SessionEvent,
  SessionRecord,
} from "@/lib/types";

type ReviewSummaryProps = {
  adaptiveDrill: AdaptiveDrill | null;
  session: SessionRecord;
  procedure: ProcedureDefinition | null;
  debrief: DebriefResponse | null;
  isDebriefLoading: boolean;
  debriefError: string | null;
  isOnline: boolean;
  learnerProfile: LearnerProfileSnapshot | null;
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
  adaptiveDrill,
  session,
  procedure,
  debrief,
  isDebriefLoading,
  debriefError,
  isOnline,
  learnerProfile,
  reviewCases,
}: ReviewSummaryProps) {
  const totalScore = session.events.reduce((sum, event) => sum + event.scoreDelta, 0);
  const gradedAttemptCount =
    debrief?.graded_attempt_count ??
    session.events.filter((event) => inferEventGraded(event)).length;
  const notGradedAttemptCount =
    debrief?.not_graded_attempt_count ?? session.events.length - gradedAttemptCount;
  const errorFingerprint: ErrorFingerprintItem[] =
    debrief?.error_fingerprint ?? learnerProfile?.recurring_issues ?? [];
  const latestFeedback = session.events.at(-1)?.coachingMessage ?? "No coaching recorded yet.";
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    return () => {
      stopSpeechPlayback();
    };
  }, []);

  async function handlePlayDebriefAudio() {
    if (!debrief) {
      return;
    }

    const didSpeak = await speakText(
      debrief.audio_script,
      session.equityMode.feedbackLanguage,
      session.equityMode.coachVoice,
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
          Practice review
        </h1>
        <p className="review-subtle" style={{ marginTop: 14 }}>
          Revisit the attempt timeline, read the debrief, and decide what to repeat next.
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
          <article className="metric-card">
            <p className="metric-label">Graded Attempts</p>
            <p className="metric-value">{gradedAttemptCount}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Not Graded</p>
            <p className="metric-value">{notGradedAttemptCount}</p>
          </article>
        </div>

        <article className="review-card" style={{ marginTop: 22 }}>
          <header>
            <strong>Latest coaching cue</strong>
            <span className="pill">Latest attempt</span>
          </header>
          <p className="review-subtle">{latestFeedback}</p>
        </article>
      </article>

      <section>
        <article className="review-card">
          <header>
            <strong>Session debrief</strong>
            <span className="pill">AI summary</span>
          </header>
          <p className="review-subtle" style={{ marginTop: 12 }}>
            Session status: {isOnline ? "online" : "offline"}. Feedback language:{" "}
            {getFeedbackLanguageLabel(session.equityMode.feedbackLanguage)}.
          </p>
          {isDebriefLoading ? (
            <p className="review-subtle">
              Building your debrief from the recorded attempts.
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
              Capture at least one analyzed step to generate a personalized debrief.
            </p>
          ) : null}

          {!isDebriefLoading && !debriefError && debrief ? (
            <div className="debrief-stack">
              <section className="debrief-block">
                <strong>Recurring patterns</strong>
                {errorFingerprint.length === 0 ? (
                  <p className="review-subtle" style={{ marginTop: 12 }}>
                    Capture a few more graded attempts to build a reliable pattern.
                  </p>
                ) : (
                  <ul className="feedback-list" style={{ marginTop: 12 }}>
                    {errorFingerprint.map((item) => (
                      <li key={`${item.code}-${item.count}`}>
                        <strong>{item.label}</strong>
                        <p className="review-subtle" style={{ marginTop: 8 }}>
                          Repeated {item.count} time(s)
                          {learnerProfile?.total_sessions
                            ? ` across ${learnerProfile.total_sessions} saved session(s).`
                            : "."}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

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
                <strong>Next drill</strong>
                {adaptiveDrill ? (
                  <>
                    <p className="review-subtle" style={{ marginTop: 12 }}>
                      <strong>{adaptiveDrill.title}</strong>
                    </p>
                    <p className="review-subtle" style={{ marginTop: 10 }}>
                      {adaptiveDrill.reason}
                    </p>
                    <ol className="numbered-list" style={{ marginTop: 12 }}>
                      {adaptiveDrill.instructions.map((item, index) => (
                        <li key={`${index}-${item}`}>{item}</li>
                      ))}
                    </ol>
                    <p className="review-subtle" style={{ marginTop: 12 }}>
                      {adaptiveDrill.rep_target}
                    </p>
                  </>
                ) : (
                  <p className="review-subtle" style={{ marginTop: 12 }}>
                    The drill plan will appear once the session has enough pattern data.
                  </p>
                )}
              </section>

              <section className="debrief-block">
                <strong>Next 3 reps</strong>
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
              session.equityMode.audioCoaching ? (
                <section className="debrief-block">
                  <strong>Audio coaching</strong>
                  <p className="review-subtle" style={{ marginTop: 10 }}>
                    {debrief.audio_script}
                  </p>
                  <div className="button-row" style={{ marginTop: 12 }}>
                    <button
                      className="button-secondary"
                      onClick={() => void handlePlayDebriefAudio()}
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

          {!isDebriefLoading && !debrief && (errorFingerprint.length > 0 || adaptiveDrill) ? (
            <div className="debrief-stack">
              <section className="debrief-block">
                <strong>Recurring patterns</strong>
                {errorFingerprint.length === 0 ? (
                  <p className="review-subtle" style={{ marginTop: 12 }}>
                    Capture a few more graded attempts to build a reliable pattern.
                  </p>
                ) : (
                  <ul className="feedback-list" style={{ marginTop: 12 }}>
                    {errorFingerprint.map((item) => (
                      <li key={`${item.code}-${item.count}`}>
                        <strong>{item.label}</strong>
                        <p className="review-subtle" style={{ marginTop: 8 }}>
                          Repeated {item.count} time(s)
                          {learnerProfile?.total_sessions
                            ? ` across ${learnerProfile.total_sessions} saved session(s).`
                            : "."}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="debrief-block">
                <strong>Next drill</strong>
                {adaptiveDrill ? (
                  <>
                    <p className="review-subtle" style={{ marginTop: 12 }}>
                      <strong>{adaptiveDrill.title}</strong>
                    </p>
                    <p className="review-subtle" style={{ marginTop: 10 }}>
                      {adaptiveDrill.reason}
                    </p>
                    <ol className="numbered-list" style={{ marginTop: 12 }}>
                      {adaptiveDrill.instructions.map((item, index) => (
                        <li key={`${index}-${item}`}>{item}</li>
                      ))}
                    </ol>
                    <p className="review-subtle" style={{ marginTop: 12 }}>
                      {adaptiveDrill.rep_target}
                    </p>
                  </>
                ) : (
                  <p className="review-subtle" style={{ marginTop: 12 }}>
                    The drill plan will appear once the session has enough pattern data.
                  </p>
                )}
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
                  Attempt {event.attempt}.{" "}
                  {inferEventGraded(event)
                    ? `Score delta ${event.scoreDelta}.`
                    : event.gradingReason ?? "Not graded - retake required."}{" "}
                  Overlay targets: {event.overlayTargetIds.join(", ") || "none"}.
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
              No faculty review cases were attached to this session.
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
                  {caseItem.corrected_step_status ? (
                    <p className="review-subtle">
                      Corrected status: {caseItem.corrected_step_status}
                    </p>
                  ) : null}
                  {caseItem.corrected_coaching_message ? (
                    <p className="review-subtle">
                      Corrected coaching: {caseItem.corrected_coaching_message}
                    </p>
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

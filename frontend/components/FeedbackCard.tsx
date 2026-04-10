"use client";

import { useEffect, useRef } from "react";

import { speakText, stopSpeechPlayback } from "@/lib/audio";
import type { AnalyzeFrameResponse, CoachVoicePreset, FeedbackLanguage } from "@/lib/types";

type FeedbackCardProps = {
  response: AnalyzeFrameResponse | null;
  stageTitle: string;
  attemptCount: number;
  isAnalyzing: boolean;
  error: string | null;
  audioEnabled?: boolean;
  autoSpeakEnabled?: boolean;
  feedbackLanguage: FeedbackLanguage;
  coachVoice: CoachVoicePreset;
};

function getStatusClass(status: AnalyzeFrameResponse["step_status"]) {
  return `status-badge status-${status}`;
}

function getSeverityClass(severity: "low" | "medium" | "high") {
  return `severity-badge severity-${severity}`;
}

export function FeedbackCard({
  response,
  stageTitle,
  attemptCount,
  isAnalyzing,
  error,
  audioEnabled = false,
  autoSpeakEnabled = true,
  feedbackLanguage,
  coachVoice,
}: FeedbackCardProps) {
  const lastSpokenMessageRef = useRef("");

  useEffect(() => {
    return () => {
      stopSpeechPlayback();
    };
  }, []);

  useEffect(() => {
    if (
      !response ||
      !audioEnabled ||
      !autoSpeakEnabled ||
      !response.coaching_message.trim() ||
      response.coaching_message === lastSpokenMessageRef.current
    ) {
      return;
    }

    void speakText(
      response.coaching_message,
      feedbackLanguage,
      coachVoice,
    ).then((didSpeak) => {
      if (didSpeak) {
        lastSpokenMessageRef.current = response.coaching_message;
      }
    });
  }, [audioEnabled, autoSpeakEnabled, coachVoice, feedbackLanguage, response]);

  async function handlePlayCoachingAudio() {
    if (!response) {
      return;
    }

    const didSpeak = await speakText(
      response.coaching_message,
      feedbackLanguage,
      coachVoice,
    );
    if (didSpeak) {
      lastSpokenMessageRef.current = response.coaching_message;
    }
  }

  function handleStopCoachingAudio() {
    stopSpeechPlayback();
  }

  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Live coaching</h2>
          <p className="panel-copy">Review the latest frame analysis for this stage.</p>
        </div>
        <span className="pill">Attempts: {attemptCount}</span>
      </div>

      {isAnalyzing ? (
        <div className="feedback-block">
          <p className="panel-copy">
            Sending the current frame to the coaching backend and waiting for feedback.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="feedback-block">
          <div className="feedback-header">
            <strong>Analysis issue</strong>
            <span className="status-badge status-unsafe">attention</span>
          </div>
          <p className="feedback-copy">{error}</p>
        </div>
      ) : null}

      {!response && !isAnalyzing ? (
        <div className="feedback-block">
          <strong>{stageTitle}</strong>
          <p className="feedback-copy">
            No result yet. Turn on the camera, frame the practice surface, and click{" "}
            <em>Check My Step</em>.
          </p>
        </div>
      ) : null}

      {response ? (
        <div className="feedback-card">
          {response.analysis_mode === "blocked" ? (
            <div className="feedback-block">
              <div className="feedback-header">
                <strong>Safety check paused analysis</strong>
                <span className="status-badge status-unsafe">
                  {response.safety_gate.status}
                </span>
              </div>
              <p className="feedback-copy" style={{ marginTop: 12 }}>
                {response.coaching_message}
              </p>
              <p className="feedback-copy" style={{ marginTop: 12 }}>
                Reason: {response.safety_gate.reason}
              </p>
              {response.review_case_id ? (
                <p className="feedback-copy" style={{ marginTop: 12 }}>
                  Escalated for human review as {response.review_case_id}.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="feedback-block">
            <div className="feedback-header">
              <strong>Result for this capture</strong>
              <span className={getStatusClass(response.step_status)}>
                {response.step_status}
              </span>
            </div>
            {response.grading_decision === "graded" ? (
              <p className="feedback-copy">
                Confidence {Math.round(response.confidence * 100)}%. Score delta{" "}
                {response.score_delta}.
              </p>
            ) : (
              <p className="feedback-copy">
                Not graded - retake required.{" "}
                {response.grading_reason ??
                  "The frame was not reliable enough for a trustworthy score."}
              </p>
            )}
          </div>

          <div className="feedback-block">
            <strong>Visible observations</strong>
            <ul className="feedback-list" style={{ marginTop: 12 }}>
              {response.visible_observations.map((item, index) => (
                <li key={`${index}-${item}`}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="feedback-block">
            <div className="feedback-header">
              <strong>Priority fixes</strong>
              <span className="pill">{response.issues.length} issue(s)</span>
            </div>
            {response.issues.length === 0 ? (
              <p className="feedback-copy">
                No major issues were flagged for this capture.
              </p>
            ) : (
              <ul className="feedback-list" style={{ marginTop: 12 }}>
                {response.issues.map((issue) => (
                  <li key={`${issue.code}-${issue.message}`}>
                    <div className="feedback-header">
                      <strong>{issue.code}</strong>
                      <span className={getSeverityClass(issue.severity)}>
                        {issue.severity}
                      </span>
                    </div>
                    <p className="feedback-copy">{issue.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="feedback-block">
            <strong>Coaching message</strong>
            <p className="feedback-copy" style={{ marginTop: 12 }}>
              {response.coaching_message}
            </p>
            {audioEnabled ? (
              <div className="button-row" style={{ marginTop: 12 }}>
                <button
                  className="button-secondary"
                  onClick={() => void handlePlayCoachingAudio()}
                  type="button"
                >
                  Play Audio Coaching
                </button>
                <button
                  className="button-ghost"
                  onClick={handleStopCoachingAudio}
                  type="button"
                >
                  Stop Audio
                </button>
              </div>
            ) : null}
          </div>

          <div className="feedback-block">
            <strong>Next action</strong>
            <p className="feedback-copy" style={{ marginTop: 12 }}>
              {response.next_action}
            </p>
          </div>

          {response.requires_human_review ? (
            <div className="feedback-block">
              <div className="feedback-header">
                <strong>Human review requested</strong>
                <span className="pill">Faculty queue</span>
              </div>
              <p className="feedback-copy" style={{ marginTop: 12 }}>
                {response.human_review_reason ??
                  "A reviewer has been asked to validate this attempt."}
              </p>
              {response.review_case_id ? (
                <p className="feedback-copy" style={{ marginTop: 12 }}>
                  Review case id: {response.review_case_id}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

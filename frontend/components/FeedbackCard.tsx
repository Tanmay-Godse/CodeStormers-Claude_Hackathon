"use client";

import type { AnalyzeFrameResponse } from "@/lib/types";

type FeedbackCardProps = {
  response: AnalyzeFrameResponse | null;
  stageTitle: string;
  attemptCount: number;
  isAnalyzing: boolean;
  error: string | null;
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
}: FeedbackCardProps) {
  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Feedback panel</h2>
          <p className="panel-copy">
            This card renders the live stage analysis returned by the FastAPI coaching service.
          </p>
        </div>
        <span className="pill">Attempts: {attemptCount}</span>
      </div>

      {isAnalyzing ? (
        <div className="feedback-block">
          <p className="panel-copy">
            Capturing the current frame, freezing the preview, and waiting for the model
            server to return the stage analysis.
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
            No analysis result yet. Turn on the camera, frame the practice surface, and
            click <em>Check My Step</em>.
          </p>
        </div>
      ) : null}

      {response ? (
        <div className="feedback-card">
          <div className="feedback-block">
            <div className="feedback-header">
              <strong>Current result</strong>
              <span className={getStatusClass(response.step_status)}>
                {response.step_status}
              </span>
            </div>
            <p className="feedback-copy">
              Confidence {Math.round(response.confidence * 100)}%. Score delta{" "}
              {response.score_delta}.
            </p>
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
              <strong>Issues to fix</strong>
              <span className="pill">{response.issues.length} issue(s)</span>
            </div>
            {response.issues.length === 0 ? (
              <p className="feedback-copy">
                No blocking issues were returned for this stage.
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
          </div>

          <div className="feedback-block">
            <strong>Next action</strong>
            <p className="feedback-copy" style={{ marginTop: 12 }}>
              {response.next_action}
            </p>
          </div>
        </div>
      ) : null}
    </article>
  );
}

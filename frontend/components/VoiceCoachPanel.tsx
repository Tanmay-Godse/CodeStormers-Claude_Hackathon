"use client";

import { useEffect, useMemo } from "react";

import {
  COACH_VOICE_OPTIONS,
  canUseSpeechSynthesis,
  canUseVoiceRecording,
  primeSpeechPlayback,
  speakText,
  stopSpeechPlayback,
} from "@/lib/audio";
import type {
  CoachVoicePreset,
  CoachChatMessage,
  CoachChatResponse,
  FeedbackLanguage,
} from "@/lib/types";

type VoiceCoachPanelProps = {
  cameraReady: boolean;
  coachTurn: CoachChatResponse | null;
  coachVoice: CoachVoicePreset;
  error: string | null;
  feedbackLanguage: FeedbackLanguage;
  messages: CoachChatMessage[];
  onCoachVoiceChange: (voice: CoachVoicePreset) => void;
  simulationConfirmed: boolean;
  voiceChatEnabled: boolean;
  voiceSessionStatus:
    | "idle"
    | "starting"
    | "watching"
    | "speaking"
    | "listening"
    | "thinking"
    | "paused";
};

export function VoiceCoachPanel({
  cameraReady,
  coachTurn,
  coachVoice,
  error,
  feedbackLanguage,
  messages,
  onCoachVoiceChange,
  simulationConfirmed,
  voiceChatEnabled,
  voiceSessionStatus,
}: VoiceCoachPanelProps) {
  const supportsSpeechSynthesis = useMemo(() => canUseSpeechSynthesis(), []);
  const supportsVoiceRecording = useMemo(() => canUseVoiceRecording(), []);

  useEffect(() => {
    return () => {
      stopSpeechPlayback();
    };
  }, []);

  async function handleTestVoice() {
    primeSpeechPlayback();
    await speakText(
      "Coach voice check. If you hear this, spoken guidance is working.",
      feedbackLanguage,
      coachVoice,
    );
  }

  return (
    <article className="panel" style={{ marginTop: 20 }}>
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Voice coach</h2>
          <p className="panel-copy">
            The coach now behaves like a live guide: once the camera is on, it speaks
            automatically and keeps guiding the current stage without needing typed
            replies.
          </p>
        </div>
        <span className="pill">
          {cameraReady ? "camera live" : "waiting for camera"}
        </span>
      </div>

      <div className="coach-status-grid" style={{ marginTop: 16 }}>
        <article className="metric-card compact-metric-card">
          <p className="metric-label">Coach stage</p>
          <p className="metric-value">
            {coachTurn?.conversation_stage?.replaceAll("_", " ") ?? "standby"}
          </p>
          <p className="panel-copy" style={{ marginTop: 10 }}>
            {simulationConfirmed
              ? "Simulation confirmed. The coach can use frame context in the next turn."
              : "Confirm the simulation setup to unlock image-guided coaching."}
          </p>
        </article>

        <article className="metric-card compact-metric-card">
          <p className="metric-label">Hands-free mode</p>
          <p className="metric-value">
            {voiceSessionStatus}
          </p>
          <p className="panel-copy" style={{ marginTop: 10 }}>
            {voiceChatEnabled
              ? "The trainer is running a live voice loop: coach speaks, listens on the mic, and sends learner audio to the backend model."
              : "Turn on Audio coaching inside Equity mode to let the coach speak back and listen without extra taps."}
          </p>
        </article>
      </div>

      <div className="inline-form-row" style={{ marginTop: 16 }}>
        <label className="field-label">
          Coach voice
          <select
            onChange={(event) =>
              onCoachVoiceChange(event.target.value as CoachVoicePreset)
            }
            value={coachVoice}
          >
            {COACH_VOICE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <article className="metric-card compact-metric-card">
          <p className="metric-label">Hands-free playback</p>
          <p className="metric-value">
            {COACH_VOICE_OPTIONS.find((option) => option.value === coachVoice)?.label ??
              "Guide voice"}
          </p>
          <p className="panel-copy" style={{ marginTop: 10 }}>
            {COACH_VOICE_OPTIONS.find((option) => option.value === coachVoice)
              ?.description ??
              "Spoken guidance plays automatically after each coach reply."}
          </p>
        </article>
      </div>

      <div className="feedback-block" style={{ marginTop: 16 }}>
        <div className="feedback-header">
          <strong>Live behavior</strong>
          <span className="pill">
            {simulationConfirmed ? "watching frames" : "awaiting confirmation"}
          </span>
        </div>
        <p className="feedback-copy" style={{ marginTop: 12 }}>
          {voiceChatEnabled
            ? simulationConfirmed
              ? "Once the coach finishes speaking, it reopens the microphone, listens for the learner, and keeps using fresh frames to guide the stage."
              : "The coach can already talk and listen, and it will start image-guided feedback as soon as the simulation-only setup is confirmed."
            : "The coach can still plan the stage from the backend, but full hands-free voice chat starts after Audio coaching is turned on."}
        </p>
      </div>

      <div className="coach-status-grid" style={{ marginTop: 16 }}>
        <article className="metric-card compact-metric-card">
          <p className="metric-label">Voice input</p>
          <p className="metric-value">
            {supportsVoiceRecording ? "microphone ready" : "unsupported"}
          </p>
          <p className="panel-copy" style={{ marginTop: 10 }}>
            {supportsVoiceRecording
              ? "The loop listens for the learner after each spoken coach turn."
              : "This browser cannot capture learner voice, so the session falls back to one-way spoken guidance."}
          </p>
        </article>

        <article className="metric-card compact-metric-card">
          <p className="metric-label">Voice output</p>
          <p className="metric-value">
            {supportsSpeechSynthesis ? "browser + backend" : "backend only"}
          </p>
          <p className="panel-copy" style={{ marginTop: 10 }}>
            {supportsSpeechSynthesis
              ? "Coach replies use backend audio first, with browser speech as a fallback."
              : "Coach replies use backend-generated audio because browser speech is unavailable."}
          </p>
        </article>
      </div>

      {coachTurn ? (
        <div className="coach-plan-card" style={{ marginTop: 16 }}>
          <strong>Current plan</strong>
          <p className="panel-copy" style={{ marginTop: 10 }}>
            {coachTurn.plan_summary}
          </p>
          <p className="panel-copy" style={{ marginTop: 10 }}>
            Next step: {coachTurn.suggested_next_step}
          </p>
          {coachTurn.stage_focus.length > 0 ? (
            <ul className="feedback-list" style={{ marginTop: 12 }}>
              {coachTurn.stage_focus.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {coachTurn.camera_observations.length > 0 ? (
            <ul className="feedback-list" style={{ marginTop: 12 }}>
              {coachTurn.camera_observations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="coach-transcript" style={{ marginTop: 16 }}>
        {messages.length === 0 ? (
          <div className="feedback-block">
            <strong>Coach standby</strong>
            <p className="feedback-copy" style={{ marginTop: 12 }}>
              Start the camera to begin the session. The coach will greet the learner,
              ask what they want to improve, and keep the conversation moving from
              voice alone.
            </p>
          </div>
        ) : (
          <ul className="timeline-list">
            {messages.map((message, index) => (
              <li className="timeline-item" key={`${message.role}-${index}-${message.content}`}>
                <header>
                  <strong>{message.role === "assistant" ? "AI coach" : "Learner"}</strong>
                  <span className="pill">{message.role}</span>
                </header>
                <p className="review-subtle" style={{ marginTop: 10 }}>
                  {message.content}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error ? (
        <div className="feedback-block" style={{ marginTop: 16 }}>
          <div className="feedback-header">
            <strong>Coach issue</strong>
            <span className="status-badge status-unsafe">attention</span>
          </div>
          <p className="feedback-copy" style={{ marginTop: 12 }}>
            {error}
          </p>
        </div>
      ) : null}

      <div className="button-row" style={{ marginTop: 16 }}>
        <button
          className="button-secondary"
          onClick={() => void handleTestVoice()}
          type="button"
        >
          Test Voice
        </button>
        <button
          className="button-ghost"
          onClick={stopSpeechPlayback}
          type="button"
        >
          Stop Voice
        </button>
      </div>
    </article>
  );
}

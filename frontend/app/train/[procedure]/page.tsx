"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppFrame } from "@/components/AppFrame";
import {
  CameraFeed,
  INITIAL_CAMERA_FEED_STATUS,
  type CameraFeedHandle,
  type CameraFeedState,
  type CameraFeedStatus,
} from "@/components/CameraFeed";
import { FeedbackCard } from "@/components/FeedbackCard";
import { ProcedureStepper } from "@/components/ProcedureStepper";
import { VoiceCoachPanel } from "@/components/VoiceCoachPanel";
import {
  buildSharedSidebarItems,
  buildSharedTopItems,
  DEFAULT_TRAINING_HREF,
} from "@/lib/appShell";
import {
  startBrowserSpeechCapture,
  canUseBrowserSpeechRecognition,
  canUseVoiceRecording,
  primeSpeechPlayback,
  primeVoiceRecordingPermission,
  speakText,
  speakTextAndWait,
  stopSpeechPlayback,
  startVoiceCapture,
  startVoiceRecording,
  type BrowserSpeechRecognitionController,
  type VoiceCaptureController,
  type RecordedVoiceClip,
  type VoiceRecordingController,
} from "@/lib/audio";
import { toApiEquityMode } from "@/lib/equity";
import {
  analyzeFrame,
  coachChat,
  getHealthStatus,
  getProcedure,
  testTranscription,
} from "@/lib/api";
import { createDefaultCalibration } from "@/lib/geometry";
import {
  clearAuthUser,
  consumeAuthLiveSession,
  createSession,
  createDefaultEquityMode,
  getAuthUser,
  getOrCreateActiveSession,
  refreshAuthUser,
  saveSession,
  startFreshSession,
  syncLearningStateFromBackend,
} from "@/lib/storage";
import type {
  AnalyzeFrameResponse,
  AuthUser,
  Calibration,
  CoachChatMessage,
  CoachChatResponse,
  EquityModeSettings,
  HealthStatus,
  Issue,
  OfflinePracticeLog,
  ProcedureDefinition,
  SessionEvent,
  SessionRecord,
  SkillLevel,
  TranscriptionTestResponse,
} from "@/lib/types";

const AUTO_COACH_INTERVAL_MS = 1_000;
const DEMO_CAMERA_SESSION_LIMIT_MS = 2 * 60 * 1000;
const SETUP_LOCAL_CHECK_TIMEOUT_MS = 5_000;
const COACH_CONVERSATION_WINDOW = 4;
const VOICE_RECORDING_MAX_DURATION_MS = 10_000;
const LIVE_VOICE_CAPTURE_MAX_DURATION_MS = 2_400;
const VOICE_RECORDING_MIN_SPEECH_MS = 220;
const VOICE_RECORDING_SILENCE_DURATION_MS = 350;
const VOICE_POST_SPEAK_LISTEN_DELAY_MS = 120;
const VOICE_RELISTEN_DELAY_MS = 120;
const VOICE_RECOVERY_RETRY_DELAY_MS = 250;
const VOICE_PROACTIVE_REPROMPT_DELAY_MS = 250;
const VOICE_PROACTIVE_REPROMPT_AFTER_SILENT_WINDOWS = 2;
const VOICE_MIN_GAP_BETWEEN_PROACTIVE_TURNS_MS = 3_500;
const VOICE_DUPLICATE_GUIDANCE_COOLDOWN_MS = 8_000;
const COACH_IMAGE_REFRESH_WINDOW_MS = 12_000;
const BROWSER_AUDIO_CHECK_EARLY_EXIT_MS = 1_500;
const COACH_AUDIO_PLAYBACK_ERROR =
  "Coach guidance is available in text, but spoken playback did not start. Open the Coach tab and use Test Voice, or check browser/site audio output.";
const SETUP_VOICE_PROMPT =
  "Setup check is live. I am verifying camera, microphone, speech, and backend readiness for training.";

type VoiceSessionStatus =
  | "idle"
  | "starting"
  | "watching"
  | "speaking"
  | "listening"
  | "thinking"
  | "paused";

type WorkspacePanel = "checklist" | "analysis" | "coach" | "setup";

type PracticeSurfaceOption = {
  label: string;
  value: string;
};

type LiveShellIconProps = {
  className?: string;
};

type SetupCheckStatus = "pass" | "retry" | "unsafe";

type SetupCheck = {
  detail: string;
  id: string;
  label: string;
  status: SetupCheckStatus;
  summary: string;
};

type BrowserPermissionState = PermissionState | "unsupported" | "unknown";

type BrowserPermissionsNavigator = Navigator & {
  permissions?: {
    query: (permission: { name: string }) => Promise<{ state: PermissionState }>;
  };
};

type MicDiagnosticPhase =
  | "idle"
  | "browser-listening"
  | "backend-recording"
  | "backend-transcribing";

type MicDiagnosticPath = "browser" | "backend";

type MicDiagnosticResult = {
  checkedAt: string | null;
  clipDurationMs: number | null;
  detail: string | null;
  error: string | null;
  latencyMs: number | null;
  processingMs: number | null;
  roundTripMs: number | null;
  transcript: string;
};

type AudioShortcutSection = {
  id: MicDiagnosticPath;
  meta: string[];
  statusLabel: string;
  summary: string;
  title: string;
  tone: string;
  transcript: string;
};

const EMPTY_MIC_DIAGNOSTIC_RESULT: MicDiagnosticResult = {
  checkedAt: null,
  clipDurationMs: null,
  detail: null,
  error: null,
  latencyMs: null,
  processingMs: null,
  roundTripMs: null,
  transcript: "",
};

function buildCoachMessageSignature(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSetupCheckTone(status: SetupCheckStatus): string {
  switch (status) {
    case "pass":
      return "status-pass";
    case "retry":
      return "status-retry";
    case "unsafe":
      return "status-unsafe";
    default:
      return "";
  }
}

function formatLatency(ms: number | null): string | null {
  if (ms === null) {
    return null;
  }

  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }

  return `${(ms / 1000).toFixed(1)} s`;
}

function formatCheckedAtLabel(checkedAt: string | null): string | null {
  if (!checkedAt) {
    return null;
  }

  return `Checked ${new Date(checkedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: number | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

function hasMicDiagnosticTranscript(result: MicDiagnosticResult | null): boolean {
  return Boolean(result?.transcript.trim());
}

function getTranscriptionProviderLabel(
  apiBaseUrl: string | null | undefined,
): string {
  const normalized = apiBaseUrl?.trim().toLowerCase() ?? "";
  if (normalized.includes("api.openai.com")) {
    return "Cloud API";
  }
  if (normalized) {
    return "Custom transcription API";
  }
  return "Backend transcription";
}

function buildBackendDiagnosticDetail(
  response: TranscriptionTestResponse,
  clipDurationMs: number,
): string {
  return `${response.transcription_provider} returned a transcript using '${response.transcription_model}'. Clip length ${formatLatency(
    clipDurationMs,
  ) ?? "short"}.`;
}

async function readMediaPermissionState(
  name: "camera" | "microphone",
): Promise<BrowserPermissionState> {
  if (typeof navigator === "undefined") {
    return "unknown";
  }

  const permissionsNavigator = navigator as BrowserPermissionsNavigator;
  if (!permissionsNavigator.permissions?.query) {
    return "unsupported";
  }

  try {
    const permissionStatus = await permissionsNavigator.permissions.query({ name });
    return permissionStatus.state;
  } catch {
    return "unsupported";
  }
}

async function probeLocalSetupCameraAccess(): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return false;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: true,
  });

  try {
    return stream
      .getVideoTracks()
      .some((track) => track.readyState === "live");
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}

function ChecklistIcon({ className }: LiveShellIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <rect height="14" rx="3" stroke="currentColor" strokeWidth="1.7" width="14" x="5" y="5" />
      <path d="M8.5 9.5h6.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <path d="M8.5 13h6.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <path d="m10 16.25 1.4 1.4L14.5 14.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}

function AnalysisIcon({ className }: LiveShellIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M5 18.5h14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <path d="M7.5 15.5v-4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <path d="M12 15.5V8.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <path d="M16.5 15.5v-2.75" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <path d="m7 10.25 4.25-3.25 5 1.75 1.75-2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}

function CoachIcon({ className }: LiveShellIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M12 4.75 13.5 8.5l3.75 1.5-3.75 1.5L12 15.25l-1.5-3.75-3.75-1.5 3.75-1.5L12 4.75Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="m18.25 14 1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5Z" fill="currentColor" />
      <path d="m5.75 14 0.8 2 2 0.8-2 0.8-0.8 2-0.8-2-2-0.8 2-0.8 0.8-2Z" fill="currentColor" />
    </svg>
  );
}

function SetupIcon({ className }: LiveShellIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M12 8.25A3.75 3.75 0 1 0 12 15.75A3.75 3.75 0 1 0 12 8.25Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M19 12a7.41 7.41 0 0 0-.08-1l2.02-1.58-1.92-3.32-2.44.8a7.93 7.93 0 0 0-1.72-.99l-.42-2.53H10.6L10.18 5.9a7.93 7.93 0 0 0-1.72.99l-2.44-.8L4.1 9.41 6.12 11A8.35 8.35 0 0 0 6.04 12c0 .34.03.67.08 1L4.1 14.59l1.92 3.32 2.44-.8c.53.4 1.1.73 1.72.99l.42 2.53h3.84l.42-2.53c.62-.26 1.19-.59 1.72-.99l2.44.8 1.92-3.32L18.92 13c.05-.33.08-.66.08-1Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.4" />
    </svg>
  );
}

function CameraIcon({ className }: LiveShellIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <rect height="10.5" rx="2.5" stroke="currentColor" strokeWidth="1.7" width="12.5" x="4.75" y="7.25" />
      <path d="m17.25 10.25 2.5-1.5v6.5l-2.5-1.5" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="M9 7.25 10.3 5.5h1.9l1.3 1.75" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}

function PlusIcon({ className }: LiveShellIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M12 5.25v13.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M5.25 12h13.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function getCameraStatusTone(state: CameraFeedState): string {
  switch (state) {
    case "live":
      return "status-pass";
    case "requesting":
      return "status-retry";
    case "blocked":
    case "unavailable":
    case "disconnected":
      return "status-unsafe";
    default:
      return "";
  }
}

function getVoiceStatusHeadline(
  status: VoiceSessionStatus,
  cameraReady: boolean,
  isLiveSessionActive: boolean,
  isAnalyzing: boolean,
): string {
  if (!cameraReady) {
    return "Camera offline";
  }

  if (!isLiveSessionActive) {
    return "Local preview";
  }

  if (isAnalyzing) {
    return "Analyzing step";
  }

  switch (status) {
    case "starting":
      return "Booting coach";
    case "watching":
      return "Watching the field";
    case "speaking":
      return "Delivering guidance";
    case "listening":
      return "Listening for learner";
    case "thinking":
      return "Analyzing technique";
    case "paused":
      return "Coach paused";
    case "idle":
    default:
      return "Standing by";
  }
}

function getLiveStatusChip(options: {
  audioCoachingEnabled: boolean;
  cameraReady: boolean;
  demoSessionExpired: boolean;
  isLiveSessionActive: boolean;
  isSessionPaused: boolean;
  isSetupStage: boolean;
  voiceSessionStatus: VoiceSessionStatus;
}): { label: string; tone: string } {
  if (options.demoSessionExpired) {
    return { label: "Ended", tone: "status-unsafe" };
  }

  if (options.isSessionPaused) {
    return { label: "Paused", tone: "status-retry" };
  }

  if (!options.cameraReady || options.isSetupStage) {
    return { label: "Setup", tone: "status-retry" };
  }

  if (!options.isLiveSessionActive) {
    return { label: "Preview", tone: "status-retry" };
  }

  if (!options.audioCoachingEnabled) {
    return { label: "Manual", tone: "status-pass" };
  }

  switch (options.voiceSessionStatus) {
    case "starting":
      return { label: "Booting", tone: "status-retry" };
    case "watching":
      return { label: "Watching", tone: "status-pass" };
    case "speaking":
      return { label: "Coaching", tone: "status-pass" };
    case "listening":
      return { label: "Listening", tone: "status-pass" };
    case "thinking":
      return { label: "Analyzing", tone: "status-retry" };
    case "paused":
      return { label: "Paused", tone: "status-retry" };
    case "idle":
    default:
      return { label: "Live", tone: "status-pass" };
  }
}

function formatDurationClock(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function normalizePracticeSurfaceLabel(value: string): string {
  const trimmed = value.trim().replace(/\.$/, "");
  if (!trimmed) {
    return "";
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function getPracticeSurfaceOptions(surface: string): PracticeSurfaceOption[] {
  const fallback = surface.trim() || "Practice surface";
  const normalized = fallback
    .replace(/\s+or\s+/gi, ", ")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const options: PracticeSurfaceOption[] = [
    {
      label: normalizePracticeSurfaceLabel(fallback),
      value: fallback,
    },
  ];

  for (const option of normalized) {
    const nextValue = normalizePracticeSurfaceLabel(option);
    if (!nextValue || options.some((item) => item.value === nextValue)) {
      continue;
    }

    options.push({
      label: nextValue,
      value: nextValue,
    });
  }

  return options;
}

function findNextStageId(
  procedure: ProcedureDefinition,
  currentStageId: string,
): string | null {
  const currentIndex = procedure.stages.findIndex(
    (stage) => stage.id === currentStageId,
  );

  if (currentIndex === -1 || currentIndex >= procedure.stages.length - 1) {
    return null;
  }

  return procedure.stages[currentIndex + 1]?.id ?? null;
}

function getSuggestedStageId(
  procedure: ProcedureDefinition,
  session: SessionRecord,
): string {
  const lastEvent = session.events.at(-1);

  if (!lastEvent) {
    return procedure.stages[0]?.id ?? "";
  }

  if (lastEvent.stepStatus === "pass") {
    return findNextStageId(procedure, lastEvent.stageId) ?? lastEvent.stageId;
  }

  return lastEvent.stageId;
}

export default function TrainProcedurePage() {
  const params = useParams();
  const router = useRouter();
  const procedureParam = params.procedure;
  const procedureId =
    typeof procedureParam === "string" ? procedureParam : procedureParam?.[0];

  const cameraRef = useRef<CameraFeedHandle>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [procedure, setProcedure] = useState<ProcedureDefinition | null>(null);
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [currentStageId, setCurrentStageId] = useState("");
  const [skillLevel, setSkillLevel] = useState<SkillLevel>("beginner");
  const [practiceSurface, setPracticeSurface] = useState("");
  const [equityMode, setEquityMode] = useState<EquityModeSettings>(
    createDefaultEquityMode(),
  );
  const [calibration, setCalibration] = useState<Calibration>(
    createDefaultCalibration(),
  );
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraFeedStatus>(
    INITIAL_CAMERA_FEED_STATUS,
  );
  const [activeWorkspacePanel, setActiveWorkspacePanel] =
    useState<WorkspacePanel>("setup");
  const [procedureError, setProcedureError] = useState<string | null>(null);
  const [isLoadingProcedure, setIsLoadingProcedure] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<AnalyzeFrameResponse | null>(null);
  const [feedbackStageId, setFeedbackStageId] = useState<string | null>(null);
  const [coachMessages, setCoachMessages] = useState<CoachChatMessage[]>([]);
  const [coachTurn, setCoachTurn] = useState<CoachChatResponse | null>(null);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [, setIsCoachLoading] = useState(false);
  const [frozenFrameUrl, setFrozenFrameUrl] = useState<string | null>(null);
  const [studentQuestion, setStudentQuestion] = useState("");
  const [simulationConfirmed, setSimulationConfirmed] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [backendHealth, setBackendHealth] = useState<HealthStatus | null>(null);
  const [setupHealthError, setSetupHealthError] = useState<string | null>(null);
  const [cameraPermissionState, setCameraPermissionState] =
    useState<BrowserPermissionState>("unknown");
  const [microphonePermissionState, setMicrophonePermissionState] =
    useState<BrowserPermissionState>("unknown");
  const [isRefreshingSetupChecks, setIsRefreshingSetupChecks] = useState(false);
  const [setupChecksUpdatedAt, setSetupChecksUpdatedAt] = useState<string | null>(
    null,
  );
  const [micDiagnosticPhase, setMicDiagnosticPhase] =
    useState<MicDiagnosticPhase>("idle");
  const [browserMicDiagnostic, setBrowserMicDiagnostic] =
    useState<MicDiagnosticResult>({ ...EMPTY_MIC_DIAGNOSTIC_RESULT });
  const [backendMicDiagnostic, setBackendMicDiagnostic] =
    useState<MicDiagnosticResult>({ ...EMPTY_MIC_DIAGNOSTIC_RESULT });
  const [voiceSessionStatus, setVoiceSessionStatus] =
    useState<VoiceSessionStatus>("idle");
  const [liveSessionAccessError, setLiveSessionAccessError] = useState<string | null>(
    null,
  );
  const [demoSessionExpired, setDemoSessionExpired] = useState(false);
  const [demoTimeRemainingMs, setDemoTimeRemainingMs] = useState(
    DEMO_CAMERA_SESSION_LIMIT_MS,
  );
  const [isSessionPaused, setIsSessionPaused] = useState(false);
  const [isLiveSessionActive, setIsLiveSessionActive] = useState(false);
  const [setupCameraVerified, setSetupCameraVerified] = useState(false);
  const [setupCheckMessage, setSetupCheckMessage] = useState<string | null>(null);
  const activeVoiceCaptureRef = useRef<VoiceCaptureController | null>(null);
  const browserMicDiagnosticControllerRef =
    useRef<BrowserSpeechRecognitionController | null>(null);
  const backendMicDiagnosticControllerRef =
    useRef<VoiceRecordingController | null>(null);
  const micDiagnosticRunIdRef = useRef(0);
  const audioShortcutStopRequestedRef = useRef(false);
  const coachMessagesRef = useRef<CoachChatMessage[]>([]);
  const voiceLoopGenerationRef = useRef(0);
  const demoDeadlineRef = useRef<number | null>(null);
  const demoSessionExpiredRef = useRef(false);
  const liveSessionActiveRef = useRef(false);
  const pausedDemoTimeRemainingRef = useRef<number | null>(null);
  const resumePausedSessionRef = useRef(false);
  const cameraStopModeRef = useRef<"idle" | "pause" | "end">("idle");
  const hasSpokenSetupPromptRef = useRef(false);
  const liveCaptureProfileRef = useRef<string | null>(null);
  const lastCoachMessageRef = useRef<{
    at: number;
    conversationStage: CoachChatResponse["conversation_stage"];
    signature: string;
  } | null>(null);
  const lastCoachTurnAtRef = useRef<number | null>(null);
  const lastCoachVisualAtRef = useRef<number | null>(null);
  const isSecureBrowserContext =
    typeof window !== "undefined" && window.isSecureContext;
  const mediaCaptureSupported =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);
  const browserSpeechRecognitionAvailable = canUseBrowserSpeechRecognition();
  const browserVoiceRecordingAvailable = canUseVoiceRecording();

  const setLiveSessionActiveState = useCallback((active: boolean) => {
    liveSessionActiveRef.current = active;
    setIsLiveSessionActive(active);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncOnlineStatus = () => setIsOnline(window.navigator.onLine);
    syncOnlineStatus();

    window.addEventListener("online", syncOnlineStatus);
    window.addEventListener("offline", syncOnlineStatus);

    return () => {
      window.removeEventListener("online", syncOnlineStatus);
      window.removeEventListener("offline", syncOnlineStatus);
    };
  }, []);

  const refreshSetupChecks = useCallback(async () => {
    setIsRefreshingSetupChecks(true);

    try {
      const [nextCameraPermission, nextMicrophonePermission, nextHealth] =
        await Promise.all([
          readMediaPermissionState("camera"),
          readMediaPermissionState("microphone"),
          getHealthStatus().catch((error) => {
            throw new Error(
              error instanceof Error
                ? error.message
                : "The backend health check could not be reached.",
            );
          }),
        ]);

      setCameraPermissionState(nextCameraPermission);
      setMicrophonePermissionState(nextMicrophonePermission);
      setBackendHealth(nextHealth);
      setSetupHealthError(null);
      setSetupChecksUpdatedAt(new Date().toISOString());
      return {
        backendHealth: nextHealth,
        cameraPermissionState: nextCameraPermission,
        isOnline:
          typeof window !== "undefined" ? window.navigator.onLine : isOnline,
        microphonePermissionState: nextMicrophonePermission,
        setupHealthError: null,
      };
    } catch (error) {
      const nextMessage =
        error instanceof Error
          ? error.message
          : "The backend health check could not be reached.";
      setSetupHealthError(
        nextMessage,
      );
      setBackendHealth(null);
      setSetupChecksUpdatedAt(new Date().toISOString());
      return {
        backendHealth: null,
        cameraPermissionState,
        isOnline:
          typeof window !== "undefined" ? window.navigator.onLine : isOnline,
        microphonePermissionState,
        setupHealthError: nextMessage,
      };
    } finally {
      setIsRefreshingSetupChecks(false);
    }
  }, [cameraPermissionState, isOnline, microphonePermissionState]);

  const cancelMicDiagnostics = useCallback(async () => {
    micDiagnosticRunIdRef.current += 1;

    const activeBrowserController = browserMicDiagnosticControllerRef.current;
    const activeBackendController = backendMicDiagnosticControllerRef.current;
    browserMicDiagnosticControllerRef.current = null;
    backendMicDiagnosticControllerRef.current = null;
    setMicDiagnosticPhase("idle");

    await Promise.allSettled(
      [
        activeBrowserController?.cancel(),
        activeBackendController?.cancel(),
      ].filter((task): task is Promise<void> => Boolean(task)),
    );
  }, []);

  const handleBrowserMicDiagnostic = useCallback(
    async (): Promise<MicDiagnosticResult | null> => {
    if (micDiagnosticPhase === "browser-listening") {
      void browserMicDiagnosticControllerRef.current?.stop();
      return null;
    }

    if (!browserSpeechRecognitionAvailable) {
      const unavailableResult = {
        ...EMPTY_MIC_DIAGNOSTIC_RESULT,
        checkedAt: new Date().toISOString(),
        error:
          "Browser speech-to-text is not available here, so the live trainer will need the backend transcription path instead.",
      };
      setBrowserMicDiagnostic(unavailableResult);
      return unavailableResult;
    }

    await cancelMicDiagnostics();

    const runId = micDiagnosticRunIdRef.current + 1;
    micDiagnosticRunIdRef.current = runId;
    setMicDiagnosticPhase("browser-listening");
    setBrowserMicDiagnostic({
      ...EMPTY_MIC_DIAGNOSTIC_RESULT,
      checkedAt: new Date().toISOString(),
      detail:
        "Listening locally. Say one short sentence and wait for the browser transcript.",
    });

    try {
      const startedAt = performance.now();
      if (browserVoiceRecordingAvailable) {
        await primeVoiceRecordingPermission();
      }
      const controller = await startBrowserSpeechCapture({
        language: equityMode.feedbackLanguage,
        maxDurationMs: VOICE_RECORDING_MAX_DURATION_MS,
      });

      if (!controller) {
        throw new Error("Browser speech-to-text is not available in this browser.");
      }

      browserMicDiagnosticControllerRef.current = controller;
      const result = await controller.result;

      if (micDiagnosticRunIdRef.current !== runId) {
        return null;
      }

      browserMicDiagnosticControllerRef.current = null;
      setMicDiagnosticPhase("idle");
      const transcript = result?.transcript.trim() ?? "";
      const totalListenMs = Math.max(
        0,
        Math.round(performance.now() - startedAt),
      );
      const shouldFallback =
        !transcript &&
        (totalListenMs <= BROWSER_AUDIO_CHECK_EARLY_EXIT_MS ||
          Boolean(result?.errorMessage));
      const estimatedProcessingMs = transcript
        ? Math.max(120, Math.round(totalListenMs * 0.18))
        : null;

      const nextResult = {
        ...EMPTY_MIC_DIAGNOSTIC_RESULT,
        checkedAt: new Date().toISOString(),
        clipDurationMs: totalListenMs,
        detail: transcript
          ? "Browser speech-to-text completed locally without a backend call."
          : shouldFallback
            ? "Browser speech-to-text ended before it produced a usable transcript."
            : "The browser finished listening but did not return a transcript.",
        error:
          transcript.length > 0
            ? null
            : result?.errorMessage ??
              "No browser transcript was detected from that sample.",
        latencyMs: estimatedProcessingMs,
        processingMs: estimatedProcessingMs,
        roundTripMs: totalListenMs,
        transcript,
      };
      setBrowserMicDiagnostic(nextResult);
      void refreshSetupChecks();
      return nextResult;
    } catch (error) {
      if (micDiagnosticRunIdRef.current !== runId) {
        return null;
      }

      browserMicDiagnosticControllerRef.current = null;
      setMicDiagnosticPhase("idle");
      const failedResult = {
        ...EMPTY_MIC_DIAGNOSTIC_RESULT,
        checkedAt: new Date().toISOString(),
        error:
          error instanceof Error
            ? error.message
            : "Browser speech-to-text could not start.",
      };
      setBrowserMicDiagnostic(failedResult);
      void refreshSetupChecks();
      return failedResult;
    }
  }, [
    browserSpeechRecognitionAvailable,
    browserVoiceRecordingAvailable,
    cancelMicDiagnostics,
    equityMode.feedbackLanguage,
    micDiagnosticPhase,
    refreshSetupChecks,
  ]);

  const handleBackendMicDiagnostic = useCallback(async (): Promise<MicDiagnosticResult | null> => {
    if (micDiagnosticPhase === "backend-recording") {
      void backendMicDiagnosticControllerRef.current?.stop();
      return null;
    }

    if (!browserVoiceRecordingAvailable) {
      const unavailableResult = {
        ...EMPTY_MIC_DIAGNOSTIC_RESULT,
        checkedAt: new Date().toISOString(),
        error:
          "Microphone recording is not available in this browser, so the backend transcription path cannot be tested here.",
      };
      setBackendMicDiagnostic(unavailableResult);
      return unavailableResult;
    }

    if (!backendHealth?.transcription_ready) {
      const unavailableResult = {
        ...EMPTY_MIC_DIAGNOSTIC_RESULT,
        checkedAt: new Date().toISOString(),
        error:
          "Backend transcription is not configured yet, so there is no API voice-to-text path to measure.",
      };
      setBackendMicDiagnostic(unavailableResult);
      return unavailableResult;
    }

    await cancelMicDiagnostics();

    const runId = micDiagnosticRunIdRef.current + 1;
    micDiagnosticRunIdRef.current = runId;
    setMicDiagnosticPhase("backend-recording");
    setBackendMicDiagnostic({
      ...EMPTY_MIC_DIAGNOSTIC_RESULT,
      checkedAt: new Date().toISOString(),
      detail:
        "Recording a short mic sample for backend transcription. Speak one short sentence.",
    });

    try {
      const controller = await startVoiceRecording({
        maxDurationMs: VOICE_RECORDING_MAX_DURATION_MS,
        minSpeechDurationMs: VOICE_RECORDING_MIN_SPEECH_MS,
        silenceDurationMs: VOICE_RECORDING_SILENCE_DURATION_MS,
      });

      if (!controller) {
        throw new Error("Microphone recording could not start in this browser.");
      }

      backendMicDiagnosticControllerRef.current = controller;
      const audioClip = await controller.result;

      if (micDiagnosticRunIdRef.current !== runId) {
        return null;
      }

      backendMicDiagnosticControllerRef.current = null;

      if (!audioClip) {
        setMicDiagnosticPhase("idle");
        const emptyClipResult = {
          ...EMPTY_MIC_DIAGNOSTIC_RESULT,
          checkedAt: new Date().toISOString(),
          error:
            "No usable speech sample was captured. Try again and speak a little closer to the microphone.",
        };
        setBackendMicDiagnostic(emptyClipResult);
        void refreshSetupChecks();
        return emptyClipResult;
      }

      setMicDiagnosticPhase("backend-transcribing");
      setBackendMicDiagnostic({
        ...EMPTY_MIC_DIAGNOSTIC_RESULT,
        checkedAt: new Date().toISOString(),
        clipDurationMs: audioClip.durationMs,
        detail: `Recorded ${formatLatency(audioClip.durationMs) ?? "a short"} clip. Sending it to ${getTranscriptionProviderLabel(
          backendHealth.transcription_api_base_url,
        )}.`,
      });

      const requestStartedAt = performance.now();
      const transcriptionResponse = await testTranscription({
        audio_base64: audioClip.base64,
        audio_format: audioClip.format,
      });

      if (micDiagnosticRunIdRef.current !== runId) {
        return null;
      }

      setMicDiagnosticPhase("idle");
      const nextResult = {
        ...EMPTY_MIC_DIAGNOSTIC_RESULT,
        checkedAt: new Date().toISOString(),
        clipDurationMs: audioClip.durationMs,
        detail: buildBackendDiagnosticDetail(
          transcriptionResponse,
          audioClip.durationMs,
        ),
        error: null,
        latencyMs: transcriptionResponse.latency_ms,
        roundTripMs: Math.max(
          0,
          Math.round(performance.now() - requestStartedAt),
        ),
        transcript: transcriptionResponse.transcript,
      };
      setBackendMicDiagnostic(nextResult);
      void refreshSetupChecks();
      return nextResult;
    } catch (error) {
      if (micDiagnosticRunIdRef.current !== runId) {
        return null;
      }

      backendMicDiagnosticControllerRef.current = null;
      setMicDiagnosticPhase("idle");
      const failedResult = {
        ...EMPTY_MIC_DIAGNOSTIC_RESULT,
        checkedAt: new Date().toISOString(),
        error:
          error instanceof Error
            ? error.message
            : "Backend transcription testing could not start.",
      };
      setBackendMicDiagnostic(failedResult);
      void refreshSetupChecks();
      return failedResult;
    }
  }, [
    backendHealth,
    browserVoiceRecordingAvailable,
    cancelMicDiagnostics,
    micDiagnosticPhase,
    refreshSetupChecks,
  ]);

  const handleCheckAudioShortcut = useCallback(async () => {
    if (activeWorkspacePanel !== "setup") {
      setActiveWorkspacePanel("setup");
    }

    if (micDiagnosticPhase !== "idle") {
      return;
    }

    audioShortcutStopRequestedRef.current = false;

    const shouldRunBrowser = browserSpeechRecognitionAvailable;
    const shouldRunBackend =
      Boolean(backendHealth?.transcription_ready) && browserVoiceRecordingAvailable;

    let browserResult: MicDiagnosticResult | null = null;
    if (shouldRunBrowser) {
      browserResult = await handleBrowserMicDiagnostic();
    } else if (!browserSpeechRecognitionAvailable) {
      browserResult = await handleBrowserMicDiagnostic();
    }

    if (shouldRunBrowser && browserResult === null) {
      setBrowserMicDiagnostic((current) =>
        hasMicDiagnosticTranscript(current) || current.error
          ? current
          : {
              ...EMPTY_MIC_DIAGNOSTIC_RESULT,
              checkedAt: new Date().toISOString(),
              error:
                "Browser speech-to-text did not finish. Run Check Audio again or use Test Browser STT below.",
              },
      );
      return;
    }

    if (audioShortcutStopRequestedRef.current) {
      audioShortcutStopRequestedRef.current = false;
      return;
    }

    if (shouldRunBackend) {
      const backendResult = await handleBackendMicDiagnostic();

      if (backendResult === null) {
        setBackendMicDiagnostic((current) =>
          hasMicDiagnosticTranscript(current) || current.error
              ? current
            : {
                ...EMPTY_MIC_DIAGNOSTIC_RESULT,
                checkedAt: new Date().toISOString(),
                error: `${getTranscriptionProviderLabel(
                  backendHealth?.transcription_api_base_url,
                )} did not finish. Run Check Audio again or use Test Backend STT below.`,
              },
        );
      }
    } else if (
      !browserSpeechRecognitionAvailable &&
      !backendHealth?.transcription_ready
    ) {
      await handleBackendMicDiagnostic();
    }
  }, [
    activeWorkspacePanel,
    backendHealth?.transcription_api_base_url,
    backendHealth?.transcription_ready,
    browserSpeechRecognitionAvailable,
    browserVoiceRecordingAvailable,
    handleBackendMicDiagnostic,
    handleBrowserMicDiagnostic,
    micDiagnosticPhase,
  ]);

  const handleStopAudioShortcut = useCallback(async () => {
    audioShortcutStopRequestedRef.current = true;

    if (micDiagnosticPhase === "browser-listening") {
      const controller = browserMicDiagnosticControllerRef.current;

      if (controller) {
        await controller.stop();
      } else {
        await cancelMicDiagnostics();
        setBrowserMicDiagnostic((current) =>
          hasMicDiagnosticTranscript(current) || current.error
            ? current
            : {
                ...EMPTY_MIC_DIAGNOSTIC_RESULT,
                checkedAt: new Date().toISOString(),
                error:
                  "Browser speech-to-text was stopped before it returned a transcript.",
              },
        );
      }
      return;
    }

    if (micDiagnosticPhase === "backend-recording") {
      await cancelMicDiagnostics();
      setBackendMicDiagnostic((current) =>
        hasMicDiagnosticTranscript(current) || current.error
          ? current
          : {
              ...EMPTY_MIC_DIAGNOSTIC_RESULT,
              checkedAt: new Date().toISOString(),
              error:
                "Backend audio check was stopped before transcription could begin.",
            },
      );
    }
  }, [cancelMicDiagnostics, micDiagnosticPhase]);

  useEffect(() => {
    const nextUser = getAuthUser();
    let cancelled = false;

    if (!nextUser) {
      const nextPath = procedureId
        ? `/train/${procedureId}`
        : "/train/simple-interrupted-suture";
      router.replace(`/login?role=student&next=${encodeURIComponent(nextPath)}`);
      return () => {
        cancelled = true;
      };
    }

    setAuthUser(nextUser);
    setIsAuthLoading(false);

    void refreshAuthUser()
      .then((refreshedUser) => {
        if (cancelled) {
          return;
        }

        if (!refreshedUser) {
          const nextPath = procedureId
            ? `/train/${procedureId}`
            : "/train/simple-interrupted-suture";
          router.replace(`/login?role=student&next=${encodeURIComponent(nextPath)}`);
          return;
        }

        setAuthUser(refreshedUser);
      })
      .catch(() => {
        if (!cancelled) {
          setAuthUser(nextUser);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [procedureId, router]);

  useEffect(() => {
    if (!authUser?.sessionToken) {
      return;
    }

    let cancelled = false;

    const syncAuthQuota = () => {
      void refreshAuthUser()
        .then((refreshedUser) => {
          if (!cancelled && refreshedUser) {
            setAuthUser(refreshedUser);
          }
        })
        .catch(() => undefined);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncAuthQuota();
      }
    };

    window.addEventListener("focus", syncAuthQuota);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", syncAuthQuota);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [authUser?.accountId, authUser?.sessionToken]);

  useEffect(() => {
    if (activeWorkspacePanel !== "setup" || micDiagnosticPhase !== "idle") {
      return;
    }

    void refreshSetupChecks();
  }, [
    activeWorkspacePanel,
    cameraReady,
    cameraStatus.state,
    coachError,
    isOnline,
    micDiagnosticPhase,
    refreshSetupChecks,
  ]);

  useEffect(() => {
    return () => {
      void cancelMicDiagnostics();
    };
  }, [cancelMicDiagnostics]);

  useEffect(() => {
    const activeProcedureId = procedureId;
    const currentUsername = authUser?.username;

    if (!currentUsername) {
      return;
    }

    if (!activeProcedureId) {
      setProcedureError("No procedure id was provided in the route.");
      setIsLoadingProcedure(false);
      return;
    }

    const procedureIdToLoad: string = activeProcedureId;

    let cancelled = false;

    async function load() {
      setIsLoadingProcedure(true);
      setProcedureError(null);

      try {
        try {
          await syncLearningStateFromBackend();
        } catch {
          // Fall back to the local cache if the learning-state hydrate fails.
        }
        const nextProcedure = await getProcedure(procedureIdToLoad);

        if (cancelled) {
          return;
        }

        let activeSession = getOrCreateActiveSession(
          nextProcedure.id,
          "beginner",
          currentUsername,
        );
        if (
          activeSession.events.length > 0 ||
          activeSession.offlinePracticeLogs.length > 0 ||
          Boolean(activeSession.debrief)
        ) {
          // Keep historical attempts for review, but open the live trainer on a
          // clean run so the hackathon demo always starts at setup.
          activeSession = saveSession({
            ...createSession(
              nextProcedure.id,
              activeSession.skillLevel,
              currentUsername,
            ),
            practiceSurface:
              activeSession.practiceSurface ?? nextProcedure.practice_surface,
            equityMode: activeSession.equityMode,
            simulationConfirmed: true,
            learnerFocus: "",
            updatedAt: new Date().toISOString(),
          }, {
            makeActive: true,
          });
        }
        if (!activeSession.ownerUsername) {
          activeSession = saveSession({
            ...activeSession,
            ownerUsername: currentUsername,
            updatedAt: new Date().toISOString(),
          }, {
            makeActive: true,
          });
        }
        setProcedure(nextProcedure);
        setSession(activeSession);
        setSkillLevel(activeSession.skillLevel);
        setPracticeSurface(activeSession.practiceSurface ?? nextProcedure.practice_surface);
        setEquityMode(activeSession.equityMode);
        setCalibration(activeSession.calibration);
        setSimulationConfirmed(Boolean(activeSession.simulationConfirmed));
        setStudentQuestion(activeSession.learnerFocus ?? "");
        setCurrentStageId(getSuggestedStageId(nextProcedure, activeSession));
      } catch (error) {
        if (!cancelled) {
          setProcedureError(
            error instanceof Error
              ? error.message
              : "Unable to load the procedure metadata.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingProcedure(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [authUser?.username, procedureId]);

  const currentStage = useMemo(
    () => procedure?.stages.find((stage) => stage.id === currentStageId) ?? null,
    [currentStageId, procedure],
  );
  const practiceSurfaceOptions = useMemo(
    () => getPracticeSurfaceOptions(procedure?.practice_surface ?? ""),
    [procedure?.practice_surface],
  );

  const currentStageAttempts = useMemo(() => {
    if (!session || !currentStageId) {
      return 0;
    }

    return session.events.filter((event) => event.stageId === currentStageId).length;
  }, [currentStageId, session]);

  const canAdvance =
    feedbackStageId === currentStageId &&
    feedback?.step_status === "pass" &&
    feedback?.grading_decision === "graded" &&
    Boolean(procedure && findNextStageId(procedure, currentStageId));

  const canFinishReview =
    feedbackStageId === currentStageId &&
    feedback?.step_status === "pass" &&
    feedback?.grading_decision === "graded" &&
    procedure &&
    !findNextStageId(procedure, currentStageId);
  const canCheckCurrentStep = Boolean(
    currentStage &&
      !isAnalyzing &&
      simulationConfirmed &&
      cameraStatus.state !== "requesting" &&
      (cameraReady || currentStage.id === "setup"),
  );
  const isSetupStage = currentStage?.id === "setup";
  const latestLearnerGoal = useMemo(
    () =>
      [...coachMessages]
        .reverse()
        .find((message) => message.role === "user")
        ?.content.trim() ?? "",
    [coachMessages],
  );
  const voiceChatEnabled =
    cameraReady && !isSetupStage && isLiveSessionActive && equityMode.audioCoaching;
  const coachLoopEnabled =
    cameraReady && !isSetupStage && isLiveSessionActive && !isAnalyzing;
  const isPreviewCameraMode = cameraReady && !isLiveSessionActive;
  const captureProfileLabel = "Standard capture";
  const hasLiveSessionLimitReached = Boolean(
    authUser &&
      authUser.liveSessionLimit !== null &&
      (authUser.liveSessionRemaining ?? 0) <= 0,
  );
  const cameraToggleLabel = cameraReady
    ? isLiveSessionActive
      ? "Stop Camera"
      : "Stop Preview"
    : isSessionPaused
      ? "Resume Session"
      : cameraStatus.state === "requesting"
        ? "Connecting Camera..."
        : cameraStatus.canRetry && cameraStatus.state !== "idle"
          ? "Retry Camera"
          : "Start Preview";
  const liveSessionQuotaLabel = useMemo(() => {
    if (!authUser) {
      return null;
    }

    if (authUser.liveSessionLimit === null) {
      return authUser.isDeveloper
        ? "Developer access"
        : "Admin access";
    }

    return `${authUser.liveSessionRemaining ?? 0} of ${authUser.liveSessionLimit} live runs left`;
  }, [authUser]);
  const buildSetupChecks = useCallback((
    overrides?: {
      backendHealth?: HealthStatus | null;
      cameraPermissionState?: BrowserPermissionState;
      cameraVerified?: boolean;
      isOnline?: boolean;
      microphonePermissionState?: BrowserPermissionState;
      setupHealthError?: string | null;
    },
  ): SetupCheck[] => {
    const checks: SetupCheck[] = [];
    const nextBackendHealth = overrides?.backendHealth ?? backendHealth;
    const nextSetupHealthError = overrides?.setupHealthError ?? setupHealthError;
    const nextCameraPermissionState =
      overrides?.cameraPermissionState ?? cameraPermissionState;
    const nextMicrophonePermissionState =
      overrides?.microphonePermissionState ?? microphonePermissionState;
    const nextIsOnline = overrides?.isOnline ?? isOnline;
    const nextCameraVerified =
      (overrides?.cameraVerified ?? cameraReady) || setupCameraVerified;
    const backendReachable = nextBackendHealth?.status === "ok";
    const transcriptionUsesOpenAI = Boolean(
      nextBackendHealth?.transcription_api_base_url
        ?.toLowerCase()
        .includes("api.openai.com"),
    );
    const browserSpeechVerified = hasMicDiagnosticTranscript(browserMicDiagnostic);
    const backendSpeechVerified = hasMicDiagnosticTranscript(backendMicDiagnostic);
    const microphonePermissionGranted = nextMicrophonePermissionState === "granted";
    const microphoneVerified =
      browserSpeechVerified ||
      backendSpeechVerified ||
      microphonePermissionGranted;
    const backendSpeechReady =
      Boolean(nextBackendHealth?.transcription_ready) && browserVoiceRecordingAvailable;

    checks.push(
      backendReachable
        ? {
            id: "backend",
            label: "Backend services",
            status: nextBackendHealth.ai_ready ? "pass" : "retry",
            summary: nextBackendHealth.ai_ready
              ? "API and AI coach are reachable"
              : "API reachable, but AI coach config needs attention",
            detail: nextBackendHealth.ai_ready
              ? `Simulation-only mode is ${nextBackendHealth.simulation_only ? "on" : "off"}. AI coach configuration is ready.`
              : "The API responded, but the AI coach configuration is incomplete.",
          }
        : {
            id: "backend",
            label: "Backend services",
            status: "unsafe",
            summary: "Backend health check failed",
            detail:
              nextSetupHealthError ??
              "The trainer could not reach the backend health endpoint.",
          },
    );

    if (!isSecureBrowserContext) {
      checks.push({
        id: "browser-security",
        label: "Browser security",
        status: "unsafe",
        summary: "Secure context required",
        detail:
          "Camera and microphone access require HTTPS or localhost in this browser.",
      });
    } else {
      checks.push({
        id: "browser-security",
        label: "Browser security",
        status: "pass",
        summary: "Secure browser context active",
        detail: "This page can request protected camera and microphone access.",
      });
    }

    if (!mediaCaptureSupported) {
      checks.push({
        id: "camera",
        label: "Camera",
        status: "unsafe",
        summary: "Camera capture is not supported",
        detail: "This browser does not expose getUserMedia for live video capture.",
      });
    } else if (cameraStatus.state === "blocked" || nextCameraPermissionState === "denied") {
      checks.push({
        id: "camera",
        label: "Camera",
        status: "unsafe",
        summary: "Camera permission is blocked",
        detail:
          cameraStatus.message ??
          "Allow camera access in the browser before starting live analysis.",
      });
    } else if (nextCameraVerified) {
      checks.push({
        id: "camera",
        label: "Camera",
        status: "pass",
        summary: cameraReady ? "Camera is live" : "Camera verified",
        detail: cameraReady
          ? "The live preview is active and ready for setup and step analysis."
          : "The local setup check already verified camera access. Start the camera again when you are ready for live training.",
      });
    } else {
      checks.push({
        id: "camera",
        label: "Camera",
        status: "retry",
        summary:
          cameraStatus.state === "requesting"
            ? "Waiting for camera permission"
            : nextCameraPermissionState === "granted"
              ? "Camera permission granted"
              : "Camera not yet verified",
        detail:
          cameraStatus.state === "requesting"
            ? "The browser is still negotiating camera access."
            : nextCameraPermissionState === "granted"
              ? "The browser granted camera access, but the live preview has not been started yet."
              : "The browser reports camera support, but the camera has not been proven live yet. Start it once to verify the feed.",
      });
    }

    if (!browserVoiceRecordingAvailable) {
      checks.push({
        id: "microphone",
        label: "Microphone",
        status: "unsafe",
        summary: "Microphone capture is unavailable",
        detail:
          "This browser cannot open microphone capture for live voice coaching.",
      });
    } else if (nextMicrophonePermissionState === "denied") {
      checks.push({
        id: "microphone",
        label: "Microphone",
        status: "unsafe",
        summary: "Microphone permission is blocked",
        detail:
          "Allow microphone access so the voice coach can listen to learner replies.",
      });
    } else if (microphoneVerified) {
      checks.push({
        id: "microphone",
        label: "Microphone",
        status: "pass",
        summary: browserSpeechVerified || backendSpeechVerified
          ? "Microphone verified"
          : "Microphone permission granted",
        detail: browserSpeechVerified
          ? "A browser speech-to-text test already captured a transcript from this microphone."
          : backendSpeechVerified
            ? "A backend transcription test already captured a transcript from this microphone."
            : "The browser granted microphone access. A spoken test remains optional under Check Audio.",
      });
    } else {
      checks.push({
        id: "microphone",
        label: "Microphone",
        status: "retry",
        summary: "Microphone permission not yet granted",
        detail:
          "The trainer can prompt for microphone access during setup without requiring a spoken sample.",
      });
    }

    if (!equityMode.audioCoaching) {
      checks.push({
        id: "speech-path",
        label: "Speech path",
        status: "retry",
        summary: "Audio coaching is turned off",
        detail: "Enable audio coaching if you want hands-free voice interaction.",
      });
    } else if (browserSpeechVerified) {
      checks.push({
        id: "speech-path",
        label: "Speech path",
        status: "pass",
        summary: "Browser speech-to-text verified",
        detail:
          "Browser speech-to-text captured a usable transcript, so the live coach can rely on it for learner replies.",
      });
    } else if (backendSpeechVerified) {
      checks.push({
        id: "speech-path",
        label: "Speech path",
        status: "pass",
        summary: transcriptionUsesOpenAI
          ? "Backend OpenAI transcription verified"
          : "Backend transcription verified",
        detail: transcriptionUsesOpenAI
          ? `A backend mic test already returned a transcript through the OpenAI transcription service using '${nextBackendHealth?.transcription_model}'.`
          : `A backend mic test already returned a transcript through the transcription service using '${nextBackendHealth?.transcription_model}'.`,
      });
    } else if (browserSpeechRecognitionAvailable && microphonePermissionGranted) {
      checks.push({
        id: "speech-path",
        label: "Speech path",
        status: "pass",
        summary: "Browser speech-to-text available",
        detail:
          "Browser speech recognition is available and microphone permission is granted. A spoken test remains optional under Check Audio.",
      });
    } else if (backendSpeechReady && microphonePermissionGranted) {
      checks.push({
        id: "speech-path",
        label: "Speech path",
        status: "pass",
        summary: transcriptionUsesOpenAI
          ? "Backend OpenAI fallback ready"
          : "Backend fallback ready",
        detail: transcriptionUsesOpenAI
          ? "Browser speech-to-text is unavailable here, but the OpenAI transcription fallback is configured and microphone permission is granted."
          : "Browser speech-to-text is unavailable here, but the backend transcription fallback is configured and microphone permission is granted.",
      });
    } else if (browserSpeechRecognitionAvailable || backendSpeechReady) {
      checks.push({
        id: "speech-path",
        label: "Speech path",
        status: "retry",
        summary: "Speech path available, waiting for mic permission",
        detail:
          "Grant microphone permission during setup so the trainer can enable the available speech path.",
      });
    } else {
      checks.push({
        id: "speech-path",
        label: "Speech path",
        status: "unsafe",
        summary: "No speech path is ready",
        detail:
          "Browser speech-to-text is unavailable and the backend transcription fallback is not ready.",
      });
    }

    checks.push(
      nextIsOnline
        ? {
            id: "network",
            label: "Network",
            status: "pass",
            summary: "Online",
            detail:
              "Cloud analysis, coaching, and transcription services can be reached from this session.",
          }
        : {
            id: "network",
            label: "Network",
            status: "retry",
            summary: "Offline fallback only",
            detail:
              "Offline logging can continue, but cloud analysis and backend voice services will not respond until the network returns.",
          },
    );

    checks.push(
      hasLiveSessionLimitReached
        ? {
            id: "quota",
            label: "Live-session quota",
            status: "unsafe",
            summary: "No live runs remaining",
            detail:
              liveSessionQuotaLabel ??
              "This workspace account needs a live-session quota reset before another camera run.",
          }
        : {
            id: "quota",
            label: "Live-session quota",
            status: "pass",
            summary: liveSessionQuotaLabel ?? "Live-session access ready",
            detail:
              authUser?.liveSessionLimit === null
                ? "This role uses uncapped live-session access."
                : "A live-session allowance is available for the next camera run.",
          },
    );

    return checks;
  }, [
    authUser,
    backendHealth,
    browserMicDiagnostic,
    browserSpeechRecognitionAvailable,
    browserVoiceRecordingAvailable,
    cameraPermissionState,
    cameraReady,
    cameraStatus.message,
    cameraStatus.state,
    equityMode.audioCoaching,
    hasLiveSessionLimitReached,
    isOnline,
    isSecureBrowserContext,
    liveSessionQuotaLabel,
    mediaCaptureSupported,
    microphonePermissionState,
    setupCameraVerified,
    setupHealthError,
    backendMicDiagnostic,
  ]);
  const setupChecks = useMemo<SetupCheck[]>(
    () => buildSetupChecks(),
    [buildSetupChecks],
  );
  const setupSummaryTone = setupChecks.some((check) => check.status === "unsafe")
    ? "status-unsafe"
    : setupChecks.some((check) => check.status === "retry")
      ? "status-retry"
      : "status-pass";
  const setupSummaryLabel = setupChecks.some((check) => check.status === "unsafe")
    ? "attention needed"
    : setupChecks.some((check) => check.status === "retry")
      ? "ready with notes"
      : "all systems ready";
  const setupChecksUpdatedLabel = setupChecksUpdatedAt
    ? new Date(setupChecksUpdatedAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  const browserMicDiagnosticUpdatedLabel = browserMicDiagnostic.checkedAt
    ? new Date(browserMicDiagnostic.checkedAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  const backendMicDiagnosticUpdatedLabel = backendMicDiagnostic.checkedAt
    ? new Date(backendMicDiagnostic.checkedAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  const transcriptionProviderLabel = getTranscriptionProviderLabel(
    backendHealth?.transcription_api_base_url,
  );
  const micDiagnosticSummaryTone =
    micDiagnosticPhase === "backend-transcribing" ||
    micDiagnosticPhase === "backend-recording" ||
    micDiagnosticPhase === "browser-listening"
      ? "status-retry"
      : browserMicDiagnostic.error || backendMicDiagnostic.error
        ? "status-unsafe"
        : "status-pass";
  const micDiagnosticSummaryLabel =
    micDiagnosticPhase === "browser-listening"
      ? "browser test live"
      : micDiagnosticPhase === "backend-recording"
        ? "recording sample"
        : micDiagnosticPhase === "backend-transcribing"
          ? "measuring api latency"
          : browserMicDiagnostic.error || backendMicDiagnostic.error
            ? "needs attention"
            : "ready to test";
  const speechTestSummary =
    browserSpeechRecognitionAvailable && backendHealth?.transcription_ready
      ? `Browser speech-to-text is available. You can compare it with the ${transcriptionProviderLabel} fallback below.`
      : browserSpeechRecognitionAvailable
        ? "Browser speech-to-text is available, but the backend fallback is not configured yet."
        : backendHealth?.transcription_ready
          ? `Browser speech-to-text is unavailable here, so learner replies will rely on ${transcriptionProviderLabel}.`
          : "Neither browser speech-to-text nor backend transcription is ready yet.";
  const canRunBrowserMicDiagnostic =
    micDiagnosticPhase === "idle" || micDiagnosticPhase === "browser-listening";
  const canRunBackendMicDiagnostic =
    micDiagnosticPhase === "idle" || micDiagnosticPhase === "backend-recording";
  const browserMicDiagnosticButtonLabel =
    micDiagnosticPhase === "browser-listening"
      ? "Stop Browser Test"
      : "Test Browser STT";
  const backendMicDiagnosticButtonLabel =
    micDiagnosticPhase === "backend-recording"
      ? "Stop Backend Test"
      : micDiagnosticPhase === "backend-transcribing"
        ? "Transcribing..."
        : "Test Backend STT";
  const showCheckAudioShortcut = isSetupStage;
  const showStopAudioShortcut =
    showCheckAudioShortcut &&
    (micDiagnosticPhase === "browser-listening" ||
      micDiagnosticPhase === "backend-recording");
  const checkAudioShortcutLabel =
    micDiagnosticPhase === "idle" ? "Check Audio" : "Checking Audio...";
  const isCheckAudioShortcutDisabled =
    !showCheckAudioShortcut || micDiagnosticPhase !== "idle";
  const audioShortcutInsight = useMemo(() => {
    const browserHasTranscript = hasMicDiagnosticTranscript(browserMicDiagnostic);
    const backendHasTranscript = hasMicDiagnosticTranscript(backendMicDiagnostic);
    const browserCheckedLabel = formatCheckedAtLabel(browserMicDiagnostic.checkedAt);
    const backendCheckedLabel = formatCheckedAtLabel(backendMicDiagnostic.checkedAt);
    const browserReady = browserSpeechRecognitionAvailable;
    const backendReady =
      Boolean(backendHealth?.transcription_ready) && browserVoiceRecordingAvailable;
    const preferredPath = browserHasTranscript
      ? "browser"
      : backendHasTranscript
        ? "backend"
        : browserReady
          ? "browser"
          : backendReady
            ? "backend"
            : null;

    const browserSection: AudioShortcutSection = {
      id: "browser",
      meta: [
        browserHasTranscript ? "Used for live replies" : null,
        browserMicDiagnostic.latencyMs !== null
          ? `Local latency ${formatLatency(browserMicDiagnostic.latencyMs)}`
          : null,
        browserMicDiagnostic.clipDurationMs !== null
          ? `Listen window ${formatLatency(browserMicDiagnostic.clipDurationMs)}`
          : null,
        browserMicDiagnostic.processingMs !== null
          ? `Processing ${formatLatency(browserMicDiagnostic.processingMs)}`
          : null,
        browserMicDiagnostic.roundTripMs !== null
          ? `Local cycle ${formatLatency(browserMicDiagnostic.roundTripMs)}`
          : null,
        browserCheckedLabel,
      ].filter((value): value is string => Boolean(value)),
      statusLabel:
        micDiagnosticPhase === "browser-listening"
          ? "listening"
          : browserMicDiagnostic.error
            ? "issue"
            : browserHasTranscript
              ? "captured"
              : browserReady
                ? "ready"
                : "unsupported",
      summary:
        micDiagnosticPhase === "browser-listening"
          ? browserMicDiagnostic.detail ??
            "Listening locally. Say one short sentence and wait for the browser transcript."
          : browserMicDiagnostic.error ??
            browserMicDiagnostic.detail ??
            (browserReady
              ? "Browser speech-to-text is ready to test here."
              : "This browser does not expose built-in speech recognition, so the browser STT path is unavailable here."),
      title: "Browser STT",
      tone:
        micDiagnosticPhase === "browser-listening"
          ? "status-retry"
          : browserMicDiagnostic.error
            ? "status-unsafe"
            : browserHasTranscript
              ? "status-pass"
              : browserReady
                ? "status-retry"
                : "status-unsafe",
      transcript: browserMicDiagnostic.transcript,
    };

    const backendSection: AudioShortcutSection = {
      id: "backend",
      meta: [
        preferredPath === "backend" ? "Used for live replies" : null,
        backendMicDiagnostic.clipDurationMs !== null
          ? `Clip ${formatLatency(backendMicDiagnostic.clipDurationMs)}`
          : null,
        backendMicDiagnostic.latencyMs !== null
          ? `Provider latency ${formatLatency(backendMicDiagnostic.latencyMs)}`
          : null,
        backendMicDiagnostic.roundTripMs !== null
          ? `Request latency ${formatLatency(backendMicDiagnostic.roundTripMs)}`
          : null,
        backendCheckedLabel,
      ].filter((value): value is string => Boolean(value)),
      statusLabel:
        micDiagnosticPhase === "backend-recording"
          ? "recording"
          : micDiagnosticPhase === "backend-transcribing"
            ? "transcribing"
            : backendMicDiagnostic.error
              ? "issue"
              : backendHasTranscript
                ? "captured"
                : backendReady
                  ? "ready"
                  : "unavailable",
      summary:
        micDiagnosticPhase === "backend-recording"
          ? backendMicDiagnostic.detail ??
            `Recording a short sample before sending it to ${transcriptionProviderLabel}.`
          : micDiagnosticPhase === "backend-transcribing"
            ? backendMicDiagnostic.detail ??
              `Waiting for the ${transcriptionProviderLabel} transcript plus latency metrics.`
            : backendMicDiagnostic.error ??
              backendMicDiagnostic.detail ??
              (backendReady
                ? `Backend transcription is ready to compare with Browser STT using ${transcriptionProviderLabel}.`
                : "Backend transcription is not configured yet, so there is no API fallback to compare here."),
      title: "Backend Transcribe",
      tone:
        micDiagnosticPhase === "backend-recording" ||
        micDiagnosticPhase === "backend-transcribing"
          ? "status-retry"
          : backendMicDiagnostic.error
            ? "status-unsafe"
            : backendHasTranscript
              ? "status-pass"
              : backendReady
                ? "status-retry"
                : "status-unsafe",
      transcript: backendMicDiagnostic.transcript,
    };

    let summary =
      "Run Check Audio to measure the available speech paths. The cards below stay in sync with the setup speech tests.";

    if (micDiagnosticPhase === "browser-listening") {
      summary =
        "Checking browser speech-to-text now. If backend transcription is ready, the comparison card will update right after this browser pass.";
    } else if (micDiagnosticPhase === "backend-recording") {
      summary =
        "Browser STT finished. Recording one backend comparison sample now so you can compare both paths.";
    } else if (micDiagnosticPhase === "backend-transcribing") {
      summary = `Browser STT finished. Waiting for ${transcriptionProviderLabel} to return the comparison transcript and latency metrics.`;
    } else if (browserHasTranscript && backendHasTranscript) {
      summary =
        "Latest Browser STT and backend transcription diagnostics are shown below, using the same results as the setup speech-test cards.";
    } else if (browserHasTranscript) {
      summary = backendReady
        ? "Browser STT is working and shown below. The backend comparison path is still ready whenever you want to measure it too."
        : "Browser STT is working and shown below.";
    } else if (backendHasTranscript) {
      summary = browserReady
        ? `The latest browser attempt did not produce a usable transcript, but ${transcriptionProviderLabel} did.`
        : `${transcriptionProviderLabel} is the available speech path here, and its latest result is shown below.`;
    } else if (browserMicDiagnostic.error || backendMicDiagnostic.error) {
      summary =
        "Latest diagnostics need attention. Review the browser and backend cards below to see which path is blocked.";
    }

    return {
      headline: "Check Audio",
      meta: [
        browserReady ? "Browser STT available" : "Browser STT unavailable",
        backendReady
          ? `Backend ready via ${transcriptionProviderLabel}`
          : "Backend transcription unavailable",
        preferredPath === "browser"
          ? "Priority path: Browser STT"
          : preferredPath === "backend"
            ? `Priority path: ${transcriptionProviderLabel}`
            : null,
      ].filter((value): value is string => Boolean(value)),
      sections: [browserSection, backendSection],
      summary,
      tone:
        micDiagnosticPhase !== "idle"
          ? "status-retry"
          : browserHasTranscript || backendHasTranscript
            ? "status-pass"
            : browserMicDiagnostic.error || backendMicDiagnostic.error
              ? "status-unsafe"
              : "status-retry",
    };
  }, [
    backendHealth?.transcription_ready,
    backendMicDiagnostic,
    browserSpeechRecognitionAvailable,
    browserMicDiagnostic,
    browserVoiceRecordingAvailable,
    micDiagnosticPhase,
    transcriptionProviderLabel,
  ]);
  const liveStageConfidence = useMemo(() => {
    if (!feedback || feedbackStageId !== currentStageId) {
      return null;
    }

    return Math.round(feedback.confidence * 100);
  }, [currentStageId, feedback, feedbackStageId]);
  const voiceStatusHeadline = useMemo(
    () =>
      getVoiceStatusHeadline(
        voiceSessionStatus,
        cameraReady,
        isLiveSessionActive,
        isAnalyzing,
      ),
    [cameraReady, isAnalyzing, isLiveSessionActive, voiceSessionStatus],
  );
  const captureProfileSignature = "standard";
  const demoTimerLabel = useMemo(() => {
    if (demoSessionExpired) {
      return "Demo window ended";
    }

    if (isSessionPaused) {
      return `Paused at ${formatDurationClock(demoTimeRemainingMs)}`;
    }

    if (cameraReady && isLiveSessionActive) {
      return `${formatDurationClock(demoTimeRemainingMs)} remaining`;
    }

    if (cameraReady) {
      return "Local preview";
    }

    return "2-minute limit";
  }, [
    cameraReady,
    demoSessionExpired,
    demoTimeRemainingMs,
    isLiveSessionActive,
    isSessionPaused,
  ]);
  const demoTimerTone = demoSessionExpired
    ? "status-unsafe"
    : isSessionPaused
      ? "status-retry"
    : cameraReady && isLiveSessionActive && demoTimeRemainingMs <= 30_000
      ? "status-retry"
      : cameraReady && isLiveSessionActive
        ? "status-pass"
        : "";
  const liveBottomHeadline = demoSessionExpired
    ? "Demo window ended"
    : isSessionPaused
      ? "Session paused"
    : voiceStatusHeadline;
  const liveStatusChip = useMemo(
    () =>
      getLiveStatusChip({
        audioCoachingEnabled: equityMode.audioCoaching,
        cameraReady,
        demoSessionExpired,
        isLiveSessionActive,
        isSessionPaused,
        isSetupStage,
        voiceSessionStatus,
      }),
    [
      cameraReady,
      demoSessionExpired,
      equityMode.audioCoaching,
      isLiveSessionActive,
      isSessionPaused,
      isSetupStage,
      voiceSessionStatus,
    ],
  );
  const liveBottomCopy = demoSessionExpired
    ? "This hackathon preview auto-stopped after 2 minutes. Start the camera again for another guided run."
    : isSessionPaused
      ? `This run is paused with ${formatDurationClock(
          demoTimeRemainingMs,
        )} remaining. Resume it to continue without using another live run.`
    : isAnalyzing && isLiveSessionActive
      ? "The current frame is being checked and the next spoken cue is being prepared."
    : isPreviewCameraMode && isSetupStage
      ? "Camera preview is live for local setup only. This has not used a counted live session yet."
    : isPreviewCameraMode
      ? "Camera preview is live. Your counted live session will begin when you run the first real training step."
    : cameraReady && isSetupStage
      ? "Finish the local setup check first. The counted live session will begin when real training starts."
    : cameraReady
      ? `Demo timer: ${formatDurationClock(
          demoTimeRemainingMs,
        )} remaining. Coach voice is live.`
    : "Start the camera to begin this guided practice block.";

  useEffect(() => {
    if (currentStageId !== "setup") {
      setSetupCheckMessage(null);
    }
  }, [currentStageId]);

  useEffect(() => {
    coachMessagesRef.current = coachMessages;
  }, [coachMessages]);

  useEffect(() => {
    demoSessionExpiredRef.current = demoSessionExpired;
  }, [demoSessionExpired]);

  useEffect(() => {
    if (!cameraReady || !isSetupStage) {
      hasSpokenSetupPromptRef.current = false;
      return;
    }

    if (
      !equityMode.audioCoaching ||
      !session ||
      demoSessionExpired ||
      isSessionPaused ||
      hasSpokenSetupPromptRef.current
    ) {
      return;
    }

    hasSpokenSetupPromptRef.current = true;
    let cancelled = false;

    void speakText(
      SETUP_VOICE_PROMPT,
      equityMode.feedbackLanguage,
      equityMode.coachVoice,
    ).then((didSpeak) => {
      if (cancelled) {
        return;
      }

      if (didSpeak) {
        setCoachError((current) =>
          current === COACH_AUDIO_PLAYBACK_ERROR ? null : current,
        );
        return;
      }

      setCoachError(COACH_AUDIO_PLAYBACK_ERROR);
    });

    return () => {
      cancelled = true;
    };
  }, [
    cameraReady,
    demoSessionExpired,
    equityMode.audioCoaching,
    equityMode.coachVoice,
    equityMode.feedbackLanguage,
    isSessionPaused,
    isSetupStage,
    session,
  ]);

  const persistSession = useCallback((nextSession: SessionRecord) => {
    const persistedSession = saveSession(nextSession, { makeActive: true });
    setSession(persistedSession);
  }, []);

  const persistSessionPatch = useCallback((nextPatch: Partial<SessionRecord>) => {
    if (!session) {
      return;
    }

    persistSession({
      ...session,
      ...nextPatch,
      updatedAt: new Date().toISOString(),
    });
  }, [persistSession, session]);

  const cancelActiveVoiceCapture = useCallback(() => {
    const activeCapture = activeVoiceCaptureRef.current;
    activeVoiceCaptureRef.current = null;

    if (!activeCapture) {
      return;
    }

    void activeCapture.cancel().catch(() => {});
  }, []);

  async function waitForCoachLoop(delayMs: number) {
    await new Promise((resolve) => {
      window.setTimeout(resolve, delayMs);
    });
  }

  const getDemoTimeRemainingSnapshot = useCallback(() => {
    if (demoDeadlineRef.current !== null) {
      return Math.max(0, demoDeadlineRef.current - Date.now());
    }

    if (pausedDemoTimeRemainingRef.current !== null) {
      return pausedDemoTimeRemainingRef.current;
    }

    return demoSessionExpiredRef.current ? 0 : demoTimeRemainingMs;
  }, [demoTimeRemainingMs]);

  const startLiveSessionWindow = useCallback((resume = false) => {
    const resumedRemainingMs = Math.max(
      0,
      pausedDemoTimeRemainingRef.current ?? demoTimeRemainingMs,
    );
    const nextTimeRemainingMs =
      resume && resumedRemainingMs > 0
        ? resumedRemainingMs
        : DEMO_CAMERA_SESSION_LIMIT_MS;

    demoDeadlineRef.current = Date.now() + nextTimeRemainingMs;
    demoSessionExpiredRef.current = false;
    setDemoSessionExpired(false);
    setDemoTimeRemainingMs(nextTimeRemainingMs);

    if (resume) {
      pausedDemoTimeRemainingRef.current = null;
      resumePausedSessionRef.current = false;
    }

    setIsSessionPaused(false);
    cameraStopModeRef.current = "idle";
  }, [demoTimeRemainingMs]);

  const activateLiveSessionIfNeeded = useCallback(async (): Promise<boolean> => {
    if (liveSessionActiveRef.current) {
      return true;
    }

    if (hasLiveSessionLimitReached) {
      setLiveSessionAccessError(
        "This demo account has used all 10 live sessions. Please ask an admin or the developer team to reset the limit.",
      );
      return false;
    }

    try {
      const nextUser = await consumeAuthLiveSession();
      setAuthUser(nextUser);
      setLiveSessionActiveState(true);
      setLiveSessionAccessError(null);

      if (cameraReady || cameraRef.current?.hasLiveStream()) {
        startLiveSessionWindow(false);
      }

      return true;
    } catch (error) {
      const nextMessage =
        error instanceof Error
          ? error.message
          : "This account could not start another live session.";
      setLiveSessionAccessError(nextMessage);
      return false;
    }
  }, [
    cameraReady,
    hasLiveSessionLimitReached,
    setLiveSessionActiveState,
    startLiveSessionWindow,
  ]);

  function handleCameraReadyChange(ready: boolean) {
    setCameraReady(ready);
    liveCaptureProfileRef.current = ready ? captureProfileSignature : null;

    if (ready) {
      if (liveSessionActiveRef.current) {
        startLiveSessionWindow(resumePausedSessionRef.current);
      } else {
        demoDeadlineRef.current = null;
        demoSessionExpiredRef.current = false;
        setDemoSessionExpired(false);
        setDemoTimeRemainingMs(DEMO_CAMERA_SESSION_LIMIT_MS);
        setIsSessionPaused(false);
        cameraStopModeRef.current = "idle";
      }
    } else {
      demoDeadlineRef.current = null;
      if (
        liveSessionActiveRef.current &&
        cameraStopModeRef.current === "pause"
      ) {
        setDemoTimeRemainingMs(
          Math.max(0, pausedDemoTimeRemainingRef.current ?? demoTimeRemainingMs),
        );
      } else {
        pausedDemoTimeRemainingRef.current = null;
        const preserveExpiredState = demoSessionExpiredRef.current;
        setDemoTimeRemainingMs(
          preserveExpiredState ? 0 : DEMO_CAMERA_SESSION_LIMIT_MS,
        );
        setDemoSessionExpired(preserveExpiredState);
        if (!preserveExpiredState) {
          demoSessionExpiredRef.current = false;
        }
        setIsSessionPaused(false);
        resumePausedSessionRef.current = false;
      }
      cameraStopModeRef.current = "idle";
    }

    if (!ready) {
      lastCoachVisualAtRef.current = null;
      cancelActiveVoiceCapture();
      stopSpeechPlayback();
      setVoiceSessionStatus("idle");
    }
  }

  function handleCameraStatusChange(nextStatus: CameraFeedStatus) {
    setCameraStatus(nextStatus);
  }

  useEffect(() => {
    if (!cameraReady) {
      return;
    }

    if (
      liveCaptureProfileRef.current === null ||
      liveCaptureProfileRef.current === captureProfileSignature
    ) {
      return;
    }

    liveCaptureProfileRef.current = captureProfileSignature;
    let cancelled = false;

    async function refreshCameraProfile() {
      const camera = cameraRef.current;
      if (!camera || !camera.hasLiveStream()) {
        return;
      }

      camera.stopCamera(
        "Updating the live preview to match the new capture profile.",
      );

      if (cancelled) {
        return;
      }

      await camera.startCamera();
    }

    void refreshCameraProfile();

    return () => {
      cancelled = true;
    };
  }, [cameraReady, captureProfileSignature]);

  const handleCameraToggle = useCallback(async () => {
    const camera = cameraRef.current;

    if (!camera) {
      return;
    }

    if (camera.hasLiveStream()) {
      setLiveSessionAccessError(null);
      if (liveSessionActiveRef.current) {
        cameraStopModeRef.current = "end";
        pausedDemoTimeRemainingRef.current = null;
        resumePausedSessionRef.current = false;
        setIsSessionPaused(false);
        setLiveSessionActiveState(false);
        camera.stopCamera(
          "Session ended. Start the camera again to begin another guided run.",
        );
      } else {
        cameraStopModeRef.current = "idle";
        camera.stopCamera(
          "Local preview stopped. Start the camera again when you are ready.",
        );
      }
      return;
    }

    const isResumingPausedSession =
      liveSessionActiveRef.current &&
      isSessionPaused &&
      !demoSessionExpired &&
      getDemoTimeRemainingSnapshot() > 0;

    resumePausedSessionRef.current = isResumingPausedSession;
    primeSpeechPlayback();

    try {
      await camera.startCamera();
    } catch (error) {
      resumePausedSessionRef.current = false;
      setLiveSessionAccessError(
        error instanceof Error
          ? error.message
          : "The camera could not be started right now.",
      );
      return;
    }

    setLiveSessionAccessError(null);

    if (isSetupStage && !liveSessionActiveRef.current) {
      return;
    }

    if (isResumingPausedSession) {
      return;
    }
  }, [
    demoSessionExpired,
    getDemoTimeRemainingSnapshot,
    isSessionPaused,
    isSetupStage,
    setLiveSessionActiveState,
  ]);

  useEffect(() => {
    lastCoachVisualAtRef.current = null;
  }, [currentStageId]);

  const handlePauseSession = useCallback(() => {
    const camera = cameraRef.current;

    if (!camera || !camera.hasLiveStream() || !liveSessionActiveRef.current) {
      return;
    }

    const nextRemainingMs = getDemoTimeRemainingSnapshot();
    pausedDemoTimeRemainingRef.current = nextRemainingMs;
    cameraStopModeRef.current = "pause";
    setIsSessionPaused(true);
    setDemoSessionExpired(false);
    demoSessionExpiredRef.current = false;
    setDemoTimeRemainingMs(nextRemainingMs);
    setLiveSessionAccessError(null);
    camera.stopCamera("Session paused. Resume this run when you are ready.");
  }, [getDemoTimeRemainingSnapshot]);

  const handlePauseSessionToggle = useCallback(async () => {
    if (isSessionPaused) {
      await handleCameraToggle();
      return;
    }

    handlePauseSession();
  }, [handleCameraToggle, handlePauseSession, isSessionPaused]);

  const handleEndSession = useCallback(() => {
    const camera = cameraRef.current;

    setLiveSessionActiveState(false);
    pausedDemoTimeRemainingRef.current = null;
    resumePausedSessionRef.current = false;
    cameraStopModeRef.current = "end";
    demoDeadlineRef.current = null;
    demoSessionExpiredRef.current = false;
    setDemoSessionExpired(false);
    setDemoTimeRemainingMs(DEMO_CAMERA_SESSION_LIMIT_MS);
    setIsSessionPaused(false);
    setLiveSessionAccessError(null);
    cancelActiveVoiceCapture();
    stopSpeechPlayback();
    setVoiceSessionStatus("idle");

    if (camera) {
      camera.stopCamera(
        "Session ended. Start the camera again to begin another guided run.",
      );
    }
  }, [cancelActiveVoiceCapture, setLiveSessionActiveState]);

  function handleSkillLevelChange(nextSkillLevel: SkillLevel) {
    setSkillLevel(nextSkillLevel);

    persistSessionPatch({
      skillLevel: nextSkillLevel,
    });
  }

  function handlePracticeSurfaceChange(nextPracticeSurface: string) {
    setPracticeSurface(nextPracticeSurface);
    persistSessionPatch({
      practiceSurface: nextPracticeSurface,
    });
  }

  function handleLearnerFocusChange(nextLearnerFocus: string) {
    setStudentQuestion(nextLearnerFocus);
    persistSessionPatch({
      learnerFocus: nextLearnerFocus,
    });
  }

  function handleEquityModeChange(nextEquityMode: EquityModeSettings) {
    setEquityMode(nextEquityMode);

    persistSessionPatch({
      equityMode: nextEquityMode,
      debrief: undefined,
    });
  }

  function handleCoachVoiceChange(voice: EquityModeSettings["coachVoice"]) {
    handleEquityModeChange({
      ...equityMode,
      coachVoice: voice,
    });
  }

  function handleStartFreshSession() {
    if (!procedure) {
      return;
    }

    const rawFreshSession = startFreshSession(
      procedure.id,
      skillLevel,
      authUser?.username,
    );
    const freshSession = saveSession({
      ...rawFreshSession,
      equityMode,
      practiceSurface: procedure.practice_surface,
      simulationConfirmed: true,
      learnerFocus: "",
      updatedAt: new Date().toISOString(),
    }, {
      makeActive: true,
    });
    setSession(freshSession);
    setCalibration(freshSession.calibration);
    setCurrentStageId(procedure.stages[0]?.id ?? "");
    setPracticeSurface(procedure.practice_surface);
    setFeedback(null);
    setFeedbackStageId(null);
    setCoachMessages([]);
    setCoachTurn(null);
    setCoachError(null);
    setLiveSessionActiveState(false);
    setIsCoachLoading(false);
    cancelActiveVoiceCapture();
    stopSpeechPlayback();
    setVoiceSessionStatus("idle");
    setFrozenFrameUrl(null);
    setStudentQuestion("");
    setSimulationConfirmed(true);
    setSetupCameraVerified(false);
    pausedDemoTimeRemainingRef.current = null;
    resumePausedSessionRef.current = false;
    cameraStopModeRef.current = "idle";
    setIsSessionPaused(false);
    demoDeadlineRef.current = null;
    demoSessionExpiredRef.current = false;
    setDemoSessionExpired(false);
    setDemoTimeRemainingMs(DEMO_CAMERA_SESSION_LIMIT_MS);
    setAnalyzeError(null);
    setLiveSessionAccessError(null);
    setActiveWorkspacePanel("checklist");
  }

  const appendOfflinePracticeLog = useCallback((
    sessionSnapshot: SessionRecord,
    frame: { width: number; height: number },
    reason: string,
  ) => {
    const offlineLog: OfflinePracticeLog = {
      id: crypto.randomUUID(),
      stageId: currentStageId,
      note: studentQuestion.trim() || undefined,
      frameWidth: frame.width,
      frameHeight: frame.height,
      lowBandwidthMode: equityMode.lowBandwidthMode,
      cheapPhoneMode: equityMode.cheapPhoneMode,
      createdAt: new Date().toISOString(),
    };

    persistSession({
      ...sessionSnapshot,
      equityMode,
      debrief: undefined,
      offlinePracticeLogs: [...sessionSnapshot.offlinePracticeLogs, offlineLog],
      updatedAt: new Date().toISOString(),
    });
    setFeedback(null);
    setFeedbackStageId(null);
    setAnalyzeError(reason);
  }, [currentStageId, equityMode, persistSession, studentQuestion]);

  const buildLocalSetupFeedback = useCallback((
    options?: {
      backendHealth?: HealthStatus | null;
      cameraPermissionState?: BrowserPermissionState;
      cameraVerified?: boolean;
      isOnline?: boolean;
      microphonePermissionState?: BrowserPermissionState;
      setupHealthError?: string | null;
    },
  ): AnalyzeFrameResponse => {
    const effectiveSetupChecks = buildSetupChecks(options);
    const unresolvedChecks = effectiveSetupChecks.filter((check) => check.status !== "pass");
    const blockingChecks = unresolvedChecks.filter((check) => check.status === "unsafe");
    const passedChecks = effectiveSetupChecks
      .filter((check) => check.status === "pass")
      .map((check) => `${check.label}: ${check.summary}`);
    const issues: Issue[] = unresolvedChecks.map((check) => ({
      code: `setup_${check.id}`,
      severity: check.status === "unsafe" ? "high" : "medium",
      message: `${check.label}: ${check.summary}. ${check.detail}`,
    }));

    if (unresolvedChecks.length === 0) {
      return {
        analysis_mode: "coaching",
        step_status: "pass",
        grading_decision: "graded",
        grading_reason: "Local setup verification passed.",
        confidence: 1,
        visible_observations: passedChecks,
        issues: [],
        coaching_message:
          "Local setup checks passed. Camera, audio path, backend reachability, and quota are ready for live training.",
        next_action:
          "Move into the first live stage. The counted live session will begin when you start real step training.",
        overlay_target_ids: [],
        score_delta: 0,
        safety_gate: {
          status: "cleared",
          confidence: 1,
          reason: "Local setup verification passed.",
        },
        requires_human_review: false,
        human_review_reason: null,
        review_case_id: null,
      };
    }

    const stepStatus = blockingChecks.length > 0 ? "unsafe" : "retry";
    const nextCheck = unresolvedChecks[0];

    return {
      analysis_mode: "blocked",
      step_status: stepStatus,
      grading_decision: "not_graded",
      grading_reason: "Local setup verification found unresolved checks.",
      confidence: blockingChecks.length > 0 ? 0.4 : 0.7,
      visible_observations: passedChecks,
      issues,
      coaching_message:
        blockingChecks.length > 0
          ? "Setup is blocked by one or more required checks. Resolve the highlighted items before starting live training."
          : "Setup is almost ready. Finish the remaining local checks and run Check My Step again.",
      next_action:
        nextCheck?.detail ??
        "Finish the remaining setup checks, then run Check My Step again.",
      overlay_target_ids: [],
      score_delta: 0,
      safety_gate: {
        status: blockingChecks.length > 0 ? "blocked" : "cleared",
        confidence: blockingChecks.length > 0 ? 0.9 : 0.6,
        reason:
          blockingChecks.length > 0
            ? "Required setup checks are still blocked."
            : "Some setup checks still need verification.",
      },
      requires_human_review: false,
      human_review_reason: null,
      review_case_id: null,
    };
  }, [buildSetupChecks]);

  const appendCoachMessage = useCallback((
    role: CoachChatMessage["role"],
    message: string,
  ) => {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    setCoachMessages((current) => {
      const lastMessage = current.at(-1);
      if (lastMessage?.role === role && lastMessage.content === trimmed) {
        return current;
      }

      const nextMessages = [
        ...current.slice(-7),
        {
          role,
          content: trimmed,
        },
      ];
      coachMessagesRef.current = nextMessages;
      return nextMessages;
    });
  }, []);

  const handleAnalyzeStep = useCallback(async () => {
    if (!procedure || !currentStage || !session || !authUser) {
      return;
    }

    setActiveWorkspacePanel("analysis");

    if (!simulationConfirmed) {
      setAnalyzeError(
        "Confirm that this is a simulation-only practice image before running analysis.",
      );
      return;
    }

    if (currentStage.id === "setup") {
      setActiveWorkspacePanel("setup");
      setIsAnalyzing(true);
      setAnalyzeError(null);
      setFeedback(null);
      setFeedbackStageId(null);
      setFrozenFrameUrl(null);
      cancelActiveVoiceCapture();
      stopSpeechPlayback();
      setVoiceSessionStatus("idle");
      setLiveSessionAccessError(null);
      setLiveSessionActiveState(false);
      pausedDemoTimeRemainingRef.current = null;
      resumePausedSessionRef.current = false;
      cameraStopModeRef.current = "idle";
      demoDeadlineRef.current = null;
      demoSessionExpiredRef.current = false;
      setDemoSessionExpired(false);
      setDemoTimeRemainingMs(DEMO_CAMERA_SESSION_LIMIT_MS);
      setIsSessionPaused(false);

      try {
        const setupStartedAt = performance.now();
        const hadVisiblePreview = cameraRef.current?.hasLiveStream() ?? false;
        let cameraVerified = setupCameraVerified || hadVisiblePreview;
        let nextStageIdAfterSetup: string | null = null;

        const getRemainingSetupBudgetMs = () =>
          SETUP_LOCAL_CHECK_TIMEOUT_MS -
          Math.round(performance.now() - setupStartedAt);

        const requireRemainingSetupBudgetMs = (message: string) => {
          const remainingBudgetMs = getRemainingSetupBudgetMs();
          if (remainingBudgetMs <= 0) {
            throw new Error(message);
          }
          return remainingBudgetMs;
        };

        if (hadVisiblePreview) {
          cameraRef.current?.stopCamera(
            "Setup checks are running locally. The preview will close until real training begins.",
          );
        }

        if (!cameraVerified && mediaCaptureSupported) {
          const didVerifyCamera = await withTimeout(
            probeLocalSetupCameraAccess(),
            requireRemainingSetupBudgetMs(
              "Setup checks must finish within 5 seconds. Please run Check My Step again.",
            ),
            "Camera permission took too long. Please allow camera access and run Check My Step again.",
          );
          cameraVerified = didVerifyCamera;
        }

        if (cameraVerified) {
          setSetupCameraVerified(true);
        }

        if (
          browserVoiceRecordingAvailable &&
          microphonePermissionState !== "granted"
        ) {
          await withTimeout(
            primeVoiceRecordingPermission(),
            requireRemainingSetupBudgetMs(
              "Setup checks must finish within 5 seconds. Please run Check My Step again.",
            ),
            "Microphone permission took too long. Please allow microphone access and run Check My Step again.",
          );
        }

        const setupSnapshot = await withTimeout(
          refreshSetupChecks(),
          requireRemainingSetupBudgetMs(
            "Setup checks must finish within 5 seconds. Please run Check My Step again.",
          ),
          "Setup checks must finish within 5 seconds. Please run Check My Step again.",
        );

        const response = buildLocalSetupFeedback({
          backendHealth: setupSnapshot.backendHealth,
          cameraPermissionState: setupSnapshot.cameraPermissionState,
          cameraVerified,
          isOnline: setupSnapshot.isOnline,
          microphonePermissionState: setupSnapshot.microphonePermissionState,
          setupHealthError: setupSnapshot.setupHealthError,
        });
        setSetupCheckMessage(response.coaching_message);
        setAnalyzeError(null);

        if (response.step_status === "pass") {
          nextStageIdAfterSetup = findNextStageId(procedure, currentStage.id);
        }

        if (nextStageIdAfterSetup) {
          setCurrentStageId(nextStageIdAfterSetup);
          setActiveWorkspacePanel("checklist");
        }
      } catch (error) {
        setSetupCheckMessage(null);
        setAnalyzeError(
          error instanceof Error
            ? error.message
            : "The local setup check could not finish.",
        );
      } finally {
        setIsAnalyzing(false);
      }
      return;
    }

    const capturedFrame = await cameraRef.current?.captureFrame({
      mode: "analysis",
    });

    if (!capturedFrame) {
      setAnalyzeError(
        currentStage.id === "setup"
          ? "Setup analysis will not start a live session automatically. Start the camera first if you want a frame-based setup check."
          : "Turn on the camera and keep a visible frame before analyzing this step.",
      );
      return;
    }

    const didActivateLiveSession = await activateLiveSessionIfNeeded();
    if (!didActivateLiveSession) {
      setAnalyzeError(
        "Live training could not start yet. Resolve the session-access issue and try again.",
      );
      return;
    }

    setAnalyzeError(null);
    setFrozenFrameUrl(capturedFrame.previewUrl);

    if (equityMode.offlinePracticeLogging && !isOnline) {
      appendOfflinePracticeLog(
        session,
        capturedFrame,
        "You are offline. This attempt was logged locally and can be revisited on the review page.",
      );
      return;
    }

    setIsAnalyzing(true);

    try {
      const response = await analyzeFrame({
        procedure_id: procedure.id,
        stage_id: currentStage.id,
        skill_level: skillLevel,
        practice_surface: practiceSurface,
        image_base64: capturedFrame.base64,
        student_question: studentQuestion.trim() || latestLearnerGoal || undefined,
        simulation_confirmation: simulationConfirmed,
        session_id: session.id,
        student_name: authUser.name,
        student_username: authUser.username,
        feedback_language: equityMode.feedbackLanguage,
        equity_mode: toApiEquityMode(equityMode),
      });

      const attempt =
        session.events.filter((event) => event.stageId === currentStage.id).length + 1;
      const event: SessionEvent = {
        stageId: currentStage.id,
        attempt,
        stepStatus: response.step_status,
        analysisMode: response.analysis_mode,
        graded: response.grading_decision === "graded",
        gradingReason: response.grading_reason ?? undefined,
        issues: response.issues,
        scoreDelta: response.score_delta,
        coachingMessage: response.coaching_message,
        overlayTargetIds: response.overlay_target_ids,
        visibleObservations: response.visible_observations,
        nextAction: response.next_action,
        confidence: response.confidence,
        safetyGate: response.safety_gate,
        requiresHumanReview: response.requires_human_review,
        humanReviewReason: response.human_review_reason ?? undefined,
        reviewCaseId: response.review_case_id ?? undefined,
        createdAt: new Date().toISOString(),
      };

      persistSession({
        ...session,
        ownerUsername: session.ownerUsername ?? authUser.username,
        skillLevel,
        calibration,
        equityMode,
        debrief: undefined,
        events: [...session.events, event],
        updatedAt: new Date().toISOString(),
      });

      setFeedback(response);
      setFeedbackStageId(currentStage.id);

      if (
        currentStage.id !== "setup" &&
        equityMode.audioCoaching &&
        isLiveSessionActive &&
        response.coaching_message.trim()
      ) {
        const stepCoachingMessage = response.coaching_message.trim();
        const stepCoachingSignature =
          buildCoachMessageSignature(stepCoachingMessage);

        appendCoachMessage("assistant", stepCoachingMessage);
        setVoiceSessionStatus("speaking");

        const didSpeakStepCoaching = await speakTextAndWait(
          stepCoachingMessage,
          equityMode.feedbackLanguage,
          equityMode.coachVoice,
        );
        if (!liveSessionActiveRef.current) {
          return;
        }

        if (!didSpeakStepCoaching) {
          setCoachError(COACH_AUDIO_PLAYBACK_ERROR);
          setVoiceSessionStatus("paused");
          return;
        }

        setCoachError((current) =>
          current === COACH_AUDIO_PLAYBACK_ERROR ? null : current,
        );
        lastCoachMessageRef.current = {
          at: Date.now(),
          conversationStage: "guiding",
          signature: stepCoachingSignature,
        };
        lastCoachTurnAtRef.current = Date.now();
        setVoiceSessionStatus("listening");
      }

      if (
        currentStage.id === "setup" &&
        response.step_status === "pass" &&
        response.grading_decision === "graded"
      ) {
        const nextStageId = findNextStageId(procedure, currentStage.id);
        if (nextStageId) {
          setCurrentStageId(nextStageId);
          setActiveWorkspacePanel("checklist");
        }
      }
    } catch (error) {
      if (
        equityMode.offlinePracticeLogging &&
        typeof window !== "undefined" &&
        !window.navigator.onLine
      ) {
        appendOfflinePracticeLog(
          session,
          capturedFrame,
          "The network dropped during analysis. This attempt was saved locally for offline practice tracking.",
        );
        return;
      }

      setAnalyzeError(
        error instanceof Error ? error.message : "The AI analysis request failed.",
      );
    } finally {
      setIsAnalyzing(false);
    }
  }, [
    activateLiveSessionIfNeeded,
    appendCoachMessage,
    appendOfflinePracticeLog,
    authUser,
    buildLocalSetupFeedback,
    calibration,
    currentStage,
    cancelActiveVoiceCapture,
    equityMode,
    isLiveSessionActive,
    isOnline,
    latestLearnerGoal,
    browserVoiceRecordingAvailable,
    mediaCaptureSupported,
    microphonePermissionState,
    practiceSurface,
    procedure,
    setLiveSessionActiveState,
    persistSession,
    setupCameraVerified,
    refreshSetupChecks,
    session,
    simulationConfirmed,
    skillLevel,
    studentQuestion,
  ]);

  function handleLogout() {
    clearAuthUser();
    router.push("/login");
  }

  function handleAdvance() {
    if (!procedure) {
      return;
    }

    const nextStageId = findNextStageId(procedure, currentStageId);

    if (nextStageId) {
      setCurrentStageId(nextStageId);
      setActiveWorkspacePanel("checklist");
    }
  }

  function handleOpenReview() {
    if (!session) {
      return;
    }

    router.push(`/review/${session.id}`);
  }

  const requestCoachTurn = useCallback(async ({
    audioClip,
    includeImage = true,
    learnerMessage,
    messages,
  }: {
    audioClip?: RecordedVoiceClip | null;
    includeImage?: boolean;
    learnerMessage?: string;
    messages: CoachChatMessage[];
  }): Promise<CoachChatResponse | null> => {
    if (!procedure || !currentStage || !session || !authUser) {
      return null;
    }

    setIsCoachLoading(true);
    setCoachError(null);

    try {
      const normalizedLearnerMessage = learnerMessage?.trim() ?? "";
      const nextMessages = (
        normalizedLearnerMessage
          ? [
              ...messages,
              {
                role: "user" as const,
                content: normalizedLearnerMessage,
              },
            ]
          : messages
      ).slice(-COACH_CONVERSATION_WINDOW);
      const shouldCaptureFreshFrame =
        includeImage &&
        cameraReady &&
        simulationConfirmed &&
        (
          nextMessages.length === 0 ||
          lastCoachVisualAtRef.current === null ||
          Date.now() - lastCoachVisualAtRef.current >=
            COACH_IMAGE_REFRESH_WINDOW_MS
        );
      const capturedFrame = shouldCaptureFreshFrame
        ? await cameraRef.current?.captureFrame({
            mode: "coach",
          })
        : null;
      if (capturedFrame) {
        lastCoachVisualAtRef.current = Date.now();
      }

      const response = await coachChat({
        procedure_id: procedure.id,
        stage_id: currentStage.id,
        skill_level: skillLevel,
        practice_surface: practiceSurface,
        learner_focus: studentQuestion.trim() || undefined,
        feedback_language: equityMode.feedbackLanguage,
        simulation_confirmation: simulationConfirmed,
        image_base64: capturedFrame?.base64,
        audio_base64: normalizedLearnerMessage ? undefined : audioClip?.base64,
        audio_format: normalizedLearnerMessage ? undefined : audioClip?.format,
        session_id: session.id,
        student_name: authUser.name,
        equity_mode: toApiEquityMode(equityMode),
        messages: nextMessages,
      });

      setCoachTurn(response);
      return response;
    } catch (error) {
      setCoachError(
        error instanceof Error
          ? error.message
          : "The voice coach could not respond right now.",
      );
      return null;
    } finally {
      setIsCoachLoading(false);
    }
  }, [
    authUser,
    cameraReady,
    currentStage,
    equityMode,
    studentQuestion,
    practiceSurface,
    procedure,
    session,
    simulationConfirmed,
    skillLevel,
  ]);

  useEffect(() => {
    setCoachTurn(null);
    setCoachMessages([]);
    coachMessagesRef.current = [];
    lastCoachMessageRef.current = null;
    lastCoachTurnAtRef.current = null;
    setVoiceSessionStatus(
      cameraReady && currentStageId !== "setup" && isLiveSessionActive
        ? "starting"
        : "idle",
    );
  }, [cameraReady, currentStageId, isLiveSessionActive]);

  useEffect(() => {
    if (!cameraReady || !isLiveSessionActive) {
      return;
    }

    const updateTimeRemaining = () => {
      const deadline = demoDeadlineRef.current;
      if (!deadline) {
        return;
      }

      const remainingMs = Math.max(0, deadline - Date.now());
      setDemoTimeRemainingMs(remainingMs);

      if (remainingMs > 0) {
        return;
      }

      demoDeadlineRef.current = null;
      demoSessionExpiredRef.current = true;
      setLiveSessionActiveState(false);
      setDemoSessionExpired(true);
      setCoachError(
        "The 2-minute hackathon demo window ended. Start the camera again if you want another Claude-guided run.",
      );
      cameraRef.current?.stopCamera(
        "The 2-minute hackathon demo window ended. Start the camera again to continue the demo.",
      );
    };

    updateTimeRemaining();
    const intervalId = window.setInterval(updateTimeRemaining, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [cameraReady, isLiveSessionActive, setLiveSessionActiveState]);

  useEffect(() => {
    const generation = voiceLoopGenerationRef.current + 1;
    voiceLoopGenerationRef.current = generation;
    cancelActiveVoiceCapture();
    stopSpeechPlayback();

    if (
      !cameraReady ||
      !procedure ||
      !currentStage ||
      !session ||
      !authUser ||
      !coachLoopEnabled
    ) {
      setVoiceSessionStatus("idle");
      return () => {
        cancelActiveVoiceCapture();
        stopSpeechPlayback();
      };
    }

    let cancelled = false;

    async function runVoiceCoachLoop() {
      let shouldRequestCoachTurn = true;
      let silentListenWindows = 0;

      while (!cancelled && voiceLoopGenerationRef.current === generation) {
        if (shouldRequestCoachTurn) {
          const lastCoachTurnAt = lastCoachTurnAtRef.current;
          if (
            voiceChatEnabled &&
            coachMessagesRef.current.length > 0 &&
            lastCoachTurnAt !== null &&
            Date.now() - lastCoachTurnAt < VOICE_MIN_GAP_BETWEEN_PROACTIVE_TURNS_MS
          ) {
            setVoiceSessionStatus("listening");
            await waitForCoachLoop(VOICE_RELISTEN_DELAY_MS);
            shouldRequestCoachTurn = false;
            continue;
          }

          setVoiceSessionStatus(
            coachMessagesRef.current.length === 0 ? "starting" : "watching",
          );

        const proactiveResponse = await requestCoachTurn({
          messages: coachMessagesRef.current.slice(-COACH_CONVERSATION_WINDOW),
        });

          if (cancelled || voiceLoopGenerationRef.current !== generation) {
            return;
          }

          if (!proactiveResponse) {
            setVoiceSessionStatus("paused");
            await waitForCoachLoop(
              voiceChatEnabled
                ? VOICE_RECOVERY_RETRY_DELAY_MS
                : AUTO_COACH_INTERVAL_MS,
            );
            continue;
          }

          const coachSignature = buildCoachMessageSignature(
            proactiveResponse.coach_message,
          );
          const lastCoachMessage = lastCoachMessageRef.current;
          const isDuplicateGuidance =
            Boolean(coachSignature) &&
            Boolean(lastCoachMessage) &&
            lastCoachMessage?.signature === coachSignature &&
            Date.now() - lastCoachMessage.at < VOICE_DUPLICATE_GUIDANCE_COOLDOWN_MS;

          if (!isDuplicateGuidance) {
            appendCoachMessage("assistant", proactiveResponse.coach_message);
          }

          if (voiceChatEnabled) {
            if (isDuplicateGuidance) {
              setVoiceSessionStatus("listening");
              await waitForCoachLoop(VOICE_RELISTEN_DELAY_MS);
              shouldRequestCoachTurn = false;
              continue;
            }

            setVoiceSessionStatus("speaking");
            const didSpeakCoachTurn = await speakTextAndWait(
              proactiveResponse.coach_message,
              equityMode.feedbackLanguage,
              equityMode.coachVoice,
            );
            if (
              cancelled ||
              voiceLoopGenerationRef.current !== generation ||
              !liveSessionActiveRef.current
            ) {
              return;
            }
            if (!didSpeakCoachTurn) {
              setCoachError(COACH_AUDIO_PLAYBACK_ERROR);
              setVoiceSessionStatus("paused");
              return;
            }
            setCoachError((current) =>
              current === COACH_AUDIO_PLAYBACK_ERROR ? null : current,
            );
            lastCoachMessageRef.current = {
              at: Date.now(),
              conversationStage: proactiveResponse.conversation_stage,
              signature: coachSignature,
            };
            lastCoachTurnAtRef.current = Date.now();

            if (cancelled || voiceLoopGenerationRef.current !== generation) {
              return;
            }

            await waitForCoachLoop(VOICE_POST_SPEAK_LISTEN_DELAY_MS);
            if (cancelled || voiceLoopGenerationRef.current !== generation) {
              return;
            }
          }

          silentListenWindows = 0;
          shouldRequestCoachTurn = false;
        }

        if (!voiceChatEnabled) {
          setVoiceSessionStatus(simulationConfirmed ? "watching" : "starting");
          await waitForCoachLoop(AUTO_COACH_INTERVAL_MS);
          shouldRequestCoachTurn = true;
          continue;
        }

        setVoiceSessionStatus("listening");

        let voiceCaptureController: VoiceCaptureController | null = null;
        try {
          voiceCaptureController = await startVoiceCapture({
            language: equityMode.feedbackLanguage,
            maxDurationMs: LIVE_VOICE_CAPTURE_MAX_DURATION_MS,
            minSpeechDurationMs: VOICE_RECORDING_MIN_SPEECH_MS,
            silenceDurationMs: VOICE_RECORDING_SILENCE_DURATION_MS,
          });
        } catch (error) {
          setCoachError(
            error instanceof Error
              ? error.message
              : "Microphone access is required for hands-free voice chat.",
          );
          setVoiceSessionStatus("paused");
          await waitForCoachLoop(VOICE_RECOVERY_RETRY_DELAY_MS);
          shouldRequestCoachTurn = true;
          continue;
        }

        if (!voiceCaptureController) {
          setCoachError(
            "This browser does not support voice capture for the coach.",
          );
          setVoiceSessionStatus("paused");
          await waitForCoachLoop(VOICE_RECOVERY_RETRY_DELAY_MS);
          shouldRequestCoachTurn = true;
          continue;
        }

        activeVoiceCaptureRef.current = voiceCaptureController;
        const learnerTurn = await voiceCaptureController.result;
        if (activeVoiceCaptureRef.current === voiceCaptureController) {
          activeVoiceCaptureRef.current = null;
        }

        if (cancelled || voiceLoopGenerationRef.current !== generation) {
          return;
        }

        const learnerTranscript = learnerTurn?.transcript.trim() ?? "";
        const learnerClip = learnerTurn?.audioClip ?? null;

        if (
          !learnerTranscript &&
          (!learnerClip ||
            learnerClip.durationMs < VOICE_RECORDING_MIN_SPEECH_MS)
        ) {
          silentListenWindows += 1;
          if (silentListenWindows >= 2) {
            setCoachError(
              "I am listening, but I am not picking up a clear voice reply yet. Speak after the coach finishes, move a little closer to the mic, and try one short sentence.",
            );
          }
          setVoiceSessionStatus("listening");

          if (
            silentListenWindows >=
            VOICE_PROACTIVE_REPROMPT_AFTER_SILENT_WINDOWS
          ) {
            silentListenWindows = 0;
            await waitForCoachLoop(VOICE_PROACTIVE_REPROMPT_DELAY_MS);
            shouldRequestCoachTurn = true;
            continue;
          }

          await waitForCoachLoop(VOICE_RELISTEN_DELAY_MS);
          shouldRequestCoachTurn = false;
          continue;
        }

        silentListenWindows = 0;
        setVoiceSessionStatus("thinking");

        const learnerResponse = await requestCoachTurn({
          audioClip: learnerTranscript ? null : learnerClip,
          includeImage: true,
          learnerMessage: learnerTranscript,
          messages: coachMessagesRef.current.slice(-COACH_CONVERSATION_WINDOW),
        });

        if (cancelled || voiceLoopGenerationRef.current !== generation) {
          return;
        }

        if (!learnerResponse) {
          setVoiceSessionStatus("paused");
          await waitForCoachLoop(VOICE_RECOVERY_RETRY_DELAY_MS);
          shouldRequestCoachTurn = true;
          continue;
        }

        const resolvedLearnerTranscript =
          learnerTranscript || learnerResponse.learner_transcript.trim();
        const learnerMessage =
          resolvedLearnerTranscript ||
          learnerResponse.learner_goal_summary.trim();

        if (learnerMessage) {
          appendCoachMessage(
            "user",
            learnerMessage,
          );
        }
        const learnerTurnWasCaptured = Boolean(learnerTranscript || learnerClip);
        const coachSignature = buildCoachMessageSignature(
          learnerResponse.coach_message,
        );
        const lastCoachMessage = lastCoachMessageRef.current;
        const isDuplicateGuidance =
          Boolean(coachSignature) &&
          Boolean(lastCoachMessage) &&
          lastCoachMessage?.signature === coachSignature &&
          Date.now() - lastCoachMessage.at < VOICE_DUPLICATE_GUIDANCE_COOLDOWN_MS;
        const shouldSuppressCoachReply =
          isDuplicateGuidance && !learnerTurnWasCaptured;

        if (!shouldSuppressCoachReply) {
          appendCoachMessage("assistant", learnerResponse.coach_message);
        }
        setVoiceSessionStatus("speaking");
        if (!shouldSuppressCoachReply) {
          const didSpeakCoachTurn = await speakTextAndWait(
            learnerResponse.coach_message,
            equityMode.feedbackLanguage,
            equityMode.coachVoice,
          );
          if (
            cancelled ||
            voiceLoopGenerationRef.current !== generation ||
            !liveSessionActiveRef.current
          ) {
            return;
          }
          if (!didSpeakCoachTurn) {
            setCoachError(COACH_AUDIO_PLAYBACK_ERROR);
            setVoiceSessionStatus("paused");
            return;
          }
          setCoachError((current) =>
            current === COACH_AUDIO_PLAYBACK_ERROR ? null : current,
          );
          lastCoachMessageRef.current = {
            at: Date.now(),
            conversationStage: learnerResponse.conversation_stage,
            signature: coachSignature,
          };
          lastCoachTurnAtRef.current = Date.now();

          if (cancelled || voiceLoopGenerationRef.current !== generation) {
            return;
          }

          await waitForCoachLoop(VOICE_POST_SPEAK_LISTEN_DELAY_MS);
        } else {
          setVoiceSessionStatus("listening");
          await waitForCoachLoop(VOICE_RELISTEN_DELAY_MS);
        }

        if (cancelled || voiceLoopGenerationRef.current !== generation) {
          return;
        }

        silentListenWindows = 0;
        shouldRequestCoachTurn = false;
      }
    }

    void runVoiceCoachLoop();

    return () => {
      cancelled = true;
      cancelActiveVoiceCapture();
      stopSpeechPlayback();
    };
  }, [
    appendCoachMessage,
    authUser,
    cameraReady,
    cancelActiveVoiceCapture,
    coachLoopEnabled,
    currentStage,
    equityMode.audioCoaching,
    equityMode.coachVoice,
    equityMode.feedbackLanguage,
    procedure,
    requestCoachTurn,
    session,
    simulationConfirmed,
    voiceChatEnabled,
  ]);

  const activeWorkspaceContent =
    !procedure || !session || !currentStage ? null : activeWorkspacePanel === "checklist" ? (
      <ProcedureStepper
        canAdvance={canAdvance}
        currentStageId={currentStage.id}
        events={session.events}
        onAdvance={handleAdvance}
        onSelectStage={setCurrentStageId}
        stages={procedure.stages}
      />
    ) : activeWorkspacePanel === "analysis" ? (
      <FeedbackCard
        attemptCount={currentStageAttempts}
        audioEnabled={equityMode.audioCoaching}
        autoSpeakEnabled={!voiceChatEnabled}
        coachVoice={equityMode.coachVoice}
        error={analyzeError}
        feedbackLanguage={equityMode.feedbackLanguage}
        isAnalyzing={isAnalyzing}
        response={feedbackStageId === currentStage.id ? feedback : null}
        stageTitle={currentStage.title}
      />
    ) : activeWorkspacePanel === "coach" ? (
      <VoiceCoachPanel
        cameraReady={cameraReady}
        coachTurn={coachTurn}
        coachVoice={equityMode.coachVoice}
        error={coachError}
        feedbackLanguage={equityMode.feedbackLanguage}
        messages={coachMessages}
        onCoachVoiceChange={handleCoachVoiceChange}
        simulationConfirmed={simulationConfirmed}
        voiceChatEnabled={voiceChatEnabled}
        voiceSessionStatus={voiceSessionStatus}
      />
    ) : (
      <article className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Live session setup</h2>
            <p className="panel-copy">
              Run a quick preflight before live training so device, speech, and backend
              dependencies are visible in one place.
            </p>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span className={`status-badge ${setupSummaryTone}`}>
              {isRefreshingSetupChecks ? "checking..." : setupSummaryLabel}
            </span>
            <button
              className="button-secondary"
              onClick={() => void refreshSetupChecks()}
              type="button"
            >
              {isRefreshingSetupChecks ? "Refreshing..." : "Refresh Checks"}
            </button>
          </div>
        </div>

        <div className="inline-form-row">
          <label className="field-label">
            Skill level
            <select
              onChange={(event) =>
                handleSkillLevelChange(event.target.value as SkillLevel)
              }
              value={skillLevel}
            >
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
            </select>
          </label>
          <div className="field-label">
            Guided defaults
            <div className="trainer-defaults-list">
              <span className="pill">simulation-only on</span>
              <span className="pill">audio coaching on</span>
              <span className="pill">offline logging on</span>
            </div>
          </div>
        </div>

        <div className="inline-form-row" style={{ marginTop: 16 }}>
          <label className="field-label">
            Practice surface
            <select
              onChange={(event) => handlePracticeSurfaceChange(event.target.value)}
              value={practiceSurface}
            >
              {practiceSurfaceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Learner focus
            <textarea
              onChange={(event) => handleLearnerFocusChange(event.target.value)}
              placeholder="Ask the coach what to watch for in this stage."
              value={studentQuestion}
            />
          </label>
        </div>
        <div className="feedback-block" style={{ marginTop: 18 }}>
          <div className="feedback-header">
            <strong>System preflight</strong>
            <span className={`status-badge ${setupSummaryTone}`}>{setupSummaryLabel}</span>
          </div>
          <p className="feedback-copy" style={{ marginTop: 12 }}>
            Simulation-only confirmation, speech-path readiness, backend connectivity,
            and device permissions are checked here before live training starts.
          </p>
          {setupChecksUpdatedLabel ? (
            <p className="feedback-copy" style={{ marginTop: 10 }}>
              Last checked at {setupChecksUpdatedLabel}.
            </p>
          ) : null}
          <div
            style={{
              display: "grid",
              gap: 12,
              marginTop: 16,
            }}
          >
            {setupChecks.map((check) => (
              <div
                key={check.id}
                style={{
                  border: "1px solid rgba(36, 58, 102, 0.1)",
                  borderRadius: 18,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "flex-start",
                  }}
                >
                  <div>
                    <strong>{check.label}</strong>
                    <p className="feedback-copy" style={{ marginTop: 8 }}>
                      {check.summary}
                    </p>
                    <p className="feedback-copy" style={{ marginTop: 8 }}>
                      {check.detail}
                    </p>
                  </div>
                  <span className={`status-badge ${getSetupCheckTone(check.status)}`}>
                    {check.status === "pass"
                      ? "ready"
                      : check.status === "retry"
                        ? "check"
                        : "blocked"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="feedback-block" style={{ marginTop: 18 }}>
          <div className="feedback-header">
            <strong>Mic and speech test</strong>
            <span className={`status-badge ${micDiagnosticSummaryTone}`}>
              {micDiagnosticSummaryLabel}
            </span>
          </div>
          <p className="feedback-copy" style={{ marginTop: 12 }}>
            Speak one short sentence into the microphone to verify voice-to-text in
            this trainer before the live loop begins.
          </p>
          <p className="feedback-copy" style={{ marginTop: 10 }}>
            These checks use mic capture only. They do not send a camera frame or
            consume image-analysis calls.
          </p>
          <p className="feedback-copy" style={{ marginTop: 10 }}>
            {speechTestSummary}
          </p>
          <div
            style={{
              display: "grid",
              gap: 12,
              marginTop: 16,
            }}
          >
            <div
              style={{
                border: "1px solid rgba(36, 58, 102, 0.1)",
                borderRadius: 18,
                padding: 16,
              }}
            >
              <div
                style={{
                  alignItems: "flex-start",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <strong>Browser speech-to-text</strong>
                  <p className="feedback-copy" style={{ marginTop: 8 }}>
                    {browserSpeechRecognitionAvailable
                      ? "Runs local speech recognition in the browser for the fastest possible reply path."
                      : "This browser does not expose built-in speech recognition, so this path cannot be tested here."}
                  </p>
                </div>
                <button
                  className="button-secondary"
                  disabled={!canRunBrowserMicDiagnostic}
                  onClick={() => void handleBrowserMicDiagnostic()}
                  type="button"
                >
                  {browserMicDiagnosticButtonLabel}
                </button>
              </div>
              <div className="trainer-defaults-list" style={{ marginTop: 12 }}>
                <span
                  className={`status-badge ${
                    micDiagnosticPhase === "browser-listening"
                      ? "status-retry"
                      : browserMicDiagnostic.error
                        ? "status-unsafe"
                        : browserMicDiagnostic.transcript
                          ? "status-pass"
                          : "status-retry"
                  }`}
                >
                  {micDiagnosticPhase === "browser-listening"
                    ? "listening"
                    : browserMicDiagnostic.error
                      ? "unavailable"
                      : browserMicDiagnostic.transcript
                        ? "captured"
                        : browserSpeechRecognitionAvailable
                          ? "ready"
                          : "unsupported"}
                </span>
                {browserMicDiagnostic.latencyMs !== null ? (
                  <span className="pill">
                    Local latency {formatLatency(browserMicDiagnostic.latencyMs)}
                  </span>
                ) : null}
                {browserMicDiagnostic.clipDurationMs !== null ? (
                  <span className="pill">
                    Listen window {formatLatency(browserMicDiagnostic.clipDurationMs)}
                  </span>
                ) : null}
                {browserMicDiagnostic.processingMs !== null ? (
                  <span className="pill">
                    Processing {formatLatency(browserMicDiagnostic.processingMs)}
                  </span>
                ) : null}
                {browserMicDiagnostic.roundTripMs !== null ? (
                  <span className="pill">
                    Local cycle {formatLatency(browserMicDiagnostic.roundTripMs)}
                  </span>
                ) : null}
                {browserMicDiagnosticUpdatedLabel ? (
                  <span className="pill">Last check {browserMicDiagnosticUpdatedLabel}</span>
                ) : null}
              </div>
              {browserMicDiagnostic.transcript ? (
                <p className="feedback-copy" style={{ marginTop: 12 }}>
                  Transcript: &quot;{browserMicDiagnostic.transcript}&quot;
                </p>
              ) : null}
              {browserMicDiagnostic.detail ? (
                <p className="feedback-copy" style={{ marginTop: 12 }}>
                  {browserMicDiagnostic.detail}
                </p>
              ) : null}
              {browserMicDiagnostic.error ? (
                <p
                  className="feedback-copy"
                  style={{ color: "#9a3d2d", marginTop: 12 }}
                >
                  {browserMicDiagnostic.error}
                </p>
              ) : null}
            </div>

            <div
              style={{
                border: "1px solid rgba(36, 58, 102, 0.1)",
                borderRadius: 18,
                padding: 16,
              }}
            >
              <div
                style={{
                  alignItems: "flex-start",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <strong>Backend transcription</strong>
                  <p className="feedback-copy" style={{ marginTop: 8 }}>
                    Records a short clip, sends it to {transcriptionProviderLabel},
                    and reports provider latency plus full request latency. Clip
                    length is shown separately and is not counted as latency.
                  </p>
                </div>
                <button
                  className="button-secondary"
                  disabled={!canRunBackendMicDiagnostic}
                  onClick={() => void handleBackendMicDiagnostic()}
                  type="button"
                >
                  {backendMicDiagnosticButtonLabel}
                </button>
              </div>
              <div className="trainer-defaults-list" style={{ marginTop: 12 }}>
                <span
                  className={`status-badge ${
                    micDiagnosticPhase === "backend-recording" ||
                    micDiagnosticPhase === "backend-transcribing"
                      ? "status-retry"
                      : backendMicDiagnostic.error
                        ? "status-unsafe"
                        : backendMicDiagnostic.transcript
                          ? "status-pass"
                          : backendHealth?.transcription_ready
                            ? "status-retry"
                            : "status-unsafe"
                  }`}
                >
                  {micDiagnosticPhase === "backend-recording"
                    ? "recording"
                    : micDiagnosticPhase === "backend-transcribing"
                      ? "transcribing"
                      : backendMicDiagnostic.error
                        ? "issue"
                        : backendMicDiagnostic.transcript
                          ? "captured"
                          : backendHealth?.transcription_ready
                            ? "ready"
                            : "unavailable"}
                </span>
                {backendMicDiagnostic.clipDurationMs !== null ? (
                  <span className="pill">
                    Clip {formatLatency(backendMicDiagnostic.clipDurationMs)}
                  </span>
                ) : null}
                {backendMicDiagnostic.latencyMs !== null ? (
                  <span className="pill">
                    Provider latency {formatLatency(backendMicDiagnostic.latencyMs)}
                  </span>
                ) : null}
                {backendMicDiagnostic.roundTripMs !== null ? (
                  <span className="pill">
                    Request latency {formatLatency(backendMicDiagnostic.roundTripMs)}
                  </span>
                ) : null}
                {backendMicDiagnosticUpdatedLabel ? (
                  <span className="pill">Last check {backendMicDiagnosticUpdatedLabel}</span>
                ) : null}
              </div>
              {backendMicDiagnostic.transcript ? (
                <p className="feedback-copy" style={{ marginTop: 12 }}>
                  Transcript: &quot;{backendMicDiagnostic.transcript}&quot;
                </p>
              ) : null}
              {backendMicDiagnostic.detail ? (
                <p className="feedback-copy" style={{ marginTop: 12 }}>
                  {backendMicDiagnostic.detail}
                </p>
              ) : null}
              {backendMicDiagnostic.error ? (
                <p
                  className="feedback-copy"
                  style={{ color: "#9a3d2d", marginTop: 12 }}
                >
                  {backendMicDiagnostic.error}
                </p>
              ) : null}
            </div>
          </div>
        </div>

      </article>
    );

  const reviewHref = session ? `/review/${session.id}` : DEFAULT_TRAINING_HREF;
  const sharedSidebarItems = buildSharedSidebarItems({
    active: "trainer",
    isDeveloper: authUser?.isDeveloper === true,
    reviewHref,
    userRole: authUser?.role ?? null,
  });
  const sharedTopItems = buildSharedTopItems({
    isDeveloper: authUser?.isDeveloper === true,
    reviewHref,
    userRole: authUser?.role ?? null,
  });

  const shouldShowTrainerBootScreen =
    isAuthLoading ||
    (isLoadingProcedure && (!authUser || !procedure || !session || !currentStage));

  if (shouldShowTrainerBootScreen) {
    return (
      <AppFrame
        brandSubtitle="Simulation-only guided practice"
        pageTitle="Live Session"
        sidebarItems={sharedSidebarItems}
        statusPill={{ icon: "play", label: "booting session" }}
        topItems={sharedTopItems}
        userName={authUser?.name ?? null}
      >
        <section className="dashboard-card dashboard-frame-panel">
          <span className="dashboard-card-eyebrow">Live Session Booting</span>
          <h2>Loading the procedure, saved session, and trainer settings.</h2>
          <p>Preparing the live session and restoring your saved setup.</p>
        </section>
      </AppFrame>
    );
  }

  if (!authUser || !procedure || !session || !currentStage || procedureError) {
    return (
      <AppFrame
        brandSubtitle="Simulation-only guided practice"
        footerSecondaryActions={[{ href: "/dashboard", icon: "dashboard", label: "Dashboard" }]}
        pageTitle="Live Session"
        sidebarItems={sharedSidebarItems}
        statusPill={{ icon: "play", label: "session unavailable" }}
        topItems={sharedTopItems}
        userName={authUser?.name ?? null}
      >
        <section className="dashboard-card dashboard-frame-panel">
          <span className="dashboard-card-eyebrow">Session Unavailable</span>
          <h2>We could not initialize the trainer right now.</h2>
          <p>
            {procedureError ??
              "The live session could not be prepared from the saved procedure data."}
          </p>
          <div className="dashboard-frame-actions">
            <Link className="dashboard-primary-button" href="/dashboard">
              Back to dashboard
            </Link>
          </div>
        </section>
      </AppFrame>
    );
  }

  return (
    <AppFrame
      brandSubtitle="Simulation-only guided practice"
      footerPrimaryAction={{
        icon: "play",
        label: "New Session",
        onClick: handleStartFreshSession,
        strong: true,
      }}
      footerSecondaryActions={[
        { href: reviewHref, icon: "review", label: "Open Review" },
        { icon: "logout", label: "Logout", onClick: handleLogout },
      ]}
      pageTitle="Live Session"
      sidebarItems={sharedSidebarItems}
      topActions={[
        ...(authUser.role === "admin"
          ? [{ href: "/admin/reviews", label: "Admin Queue" }]
          : []),
        { href: reviewHref, label: "Review" },
      ]}
      topItems={sharedTopItems}
      userName={authUser.name}
    >
      <section className="dashboard-card trainer-session-hero">
        <div className="trainer-session-hero-copy">
          <span className="dashboard-card-eyebrow">Live Practice</span>
          <h1 className="trainer-session-title">{currentStage.title}</h1>
          <p className="trainer-session-text">{currentStage.objective}</p>
          <div className="trainer-session-status-row">
            <span className={`status-badge ${getCameraStatusTone(cameraStatus.state)}`}>
              {cameraStatus.label}
            </span>
            <span className="pill">{captureProfileLabel}</span>
            <span className={`pill ${demoTimerTone}`}>{demoTimerLabel}</span>
            {liveSessionQuotaLabel ? <span className="pill">{liveSessionQuotaLabel}</span> : null}
          </div>
          <p className="trainer-session-note">
            {liveSessionAccessError ??
              (isSetupStage
                ? setupCheckMessage ??
                  "Use Check My Step to run a quick local system preflight before live training."
                : "Keep the surface centered and use Check My Step when the frame looks ready.")}
          </p>
        </div>

        <div className="trainer-session-hero-actions">
          <button
            className="button-primary trainer-session-action"
            disabled={cameraStatus.state === "requesting"}
            onClick={() => void handleCameraToggle()}
            type="button"
          >
            <CameraIcon className="live-action-icon" />
            {cameraToggleLabel}
          </button>
          <button
            className="button-secondary trainer-session-action"
            onClick={handleStartFreshSession}
            type="button"
          >
            <PlusIcon className="live-action-icon" />
            New Session
          </button>
        </div>
      </section>

      <section className="trainer-session-grid">
        <div className="trainer-session-main">
          <div className="live-hud-column trainer-session-hud">
            <article className="live-hud-card">
              <p className="live-hud-kicker">Confidence</p>
              <div className="live-hud-value-row">
                <strong>{liveStageConfidence ?? "--"}</strong>
                <span>%</span>
              </div>
              <div className="live-hud-meter">
                <span
                  className="live-hud-meter-fill"
                  style={{ width: `${liveStageConfidence ?? 0}%` }}
                />
              </div>
              <p className="live-hud-footnote">Latest frame read from the model.</p>
            </article>

            <article className="live-hud-card">
              <p className="live-hud-kicker">Attempts</p>
              <div className="live-hud-value-row">
                <strong>{currentStageAttempts}</strong>
                <span>stage</span>
              </div>
              <div className="live-mini-bars">
                {[24, 52, 76, 42, 64].map((height, index) => (
                  <span
                    className="live-mini-bar"
                    key={`attempt-bar-${height}-${index}`}
                    style={{ height: `${height}%` }}
                  />
                ))}
              </div>
            </article>
          </div>

          <div className="dashboard-card trainer-camera-card">
            <div className="camera-stage trainer-camera-stage">
              <div className="camera-surface">
                <CameraFeed
                  cheapPhoneMode={equityMode.cheapPhoneMode}
                  ref={cameraRef}
                  frozenFrameUrl={isAnalyzing ? frozenFrameUrl : null}
                  lowBandwidthMode={equityMode.lowBandwidthMode}
                  onMicrophoneIssue={setCoachError}
                  onReadyChange={handleCameraReadyChange}
                  onStartRequest={handleCameraToggle}
                  onStatusChange={handleCameraStatusChange}
                  primeMicrophoneOnStart={false}
                />
              </div>
            </div>
            <div className="trainer-camera-controls">
              <div className="trainer-camera-controls-copy">
                <p className="trainer-camera-controls-label">
                  {isPreviewCameraMode ? "Preview controls" : "Session controls"}
                </p>
                <p className="trainer-camera-controls-status">
                  {cameraStatus.label}
                </p>
              </div>
              <div className="trainer-camera-controls-actions">
                {isPreviewCameraMode ? (
                  <button
                    className="button-secondary"
                    disabled={cameraStatus.state === "requesting" || !cameraReady}
                    onClick={() => void handleCameraToggle()}
                    type="button"
                  >
                    Stop Preview
                  </button>
                ) : (
                  <>
                    <button
                      className="button-primary"
                      disabled={
                        cameraStatus.state === "requesting" ||
                        (!cameraReady && !isSessionPaused)
                      }
                      onClick={() => void handlePauseSessionToggle()}
                      type="button"
                    >
                      {isSessionPaused ? "Resume Session" : "Pause Session"}
                    </button>
                    <button
                      className="button-secondary"
                      disabled={
                        cameraStatus.state === "requesting" ||
                        (!cameraReady && !isSessionPaused)
                      }
                      onClick={handleEndSession}
                      type="button"
                    >
                      End Session
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div
            className={`live-bottom-bar trainer-session-bar ${
              showCheckAudioShortcut ? "has-audio-insight" : ""
            }`}
          >
            <div className="live-bottom-primary-row">
              <div className="live-waveform">
                {[40, 58, 92, 68, 52, 86, 100, 74, 62, 95, 76, 48, 84, 98, 80, 60, 42].map(
                  (height, index) => (
                    <span
                      className="live-wave-bar"
                      key={`wave-${height}-${index}`}
                      style={{
                        height: `${height}%`,
                        animationDelay: `${(index % 6) * 0.14}s`,
                      }}
                    />
                  ),
                )}
              </div>

              <div className="live-bottom-status">
                <span className={`status-badge live-status-chip ${liveStatusChip.tone}`}>
                  {liveStatusChip.label}
                </span>
                <div>
                  <p className="live-bottom-kicker">AI System Status</p>
                  <p className="live-bottom-headline">{liveBottomHeadline}</p>
                  <p className="live-bottom-copy">{liveBottomCopy}</p>
                </div>
              </div>

              <div className="live-bottom-actions">
                {showCheckAudioShortcut ? (
                  <>
                    <button
                      className="button-primary"
                      disabled={isCheckAudioShortcutDisabled}
                      onClick={() => void handleCheckAudioShortcut()}
                      type="button"
                    >
                      {checkAudioShortcutLabel}
                    </button>
                    {showStopAudioShortcut ? (
                      <button
                        className="button-danger"
                        onClick={() => void handleStopAudioShortcut()}
                        type="button"
                      >
                        Stop Audio Check
                      </button>
                    ) : null}
                  </>
                ) : null}
                <button
                  className="button-primary"
                  disabled={!canCheckCurrentStep}
                  onClick={() => void handleAnalyzeStep()}
                  type="button"
                >
                  {isAnalyzing
                    ? isSetupStage
                      ? "Running Setup Check..."
                      : "Analyzing Step..."
                    : isSetupStage
                      ? "Run Setup Check"
                      : "Check My Step"}
                </button>
                {canAdvance ? (
                  <button
                    className="button-secondary"
                    onClick={handleAdvance}
                    type="button"
                  >
                    Advance
                  </button>
                ) : null}
                {canFinishReview ? (
                  <button
                    className="button-secondary"
                    onClick={handleOpenReview}
                    type="button"
                  >
                    Review
                  </button>
                ) : null}
              </div>
            </div>

            {showCheckAudioShortcut ? (
              <div className={`live-audio-insight ${audioShortcutInsight.tone}`}>
                <div className="live-audio-insight-header">
                  <strong>{audioShortcutInsight.headline}</strong>
                  {audioShortcutInsight.meta.length > 0 ? (
                    <div className="trainer-defaults-list">
                      {audioShortcutInsight.meta.map((item) => (
                        <span className="pill" key={item}>
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <p className="live-audio-insight-copy">
                  {audioShortcutInsight.summary}
                </p>
                <div className="live-audio-insight-grid">
                  {audioShortcutInsight.sections.map((section) => (
                    <div
                      className={`live-audio-insight-card ${section.tone}`}
                      key={section.id}
                    >
                      <div className="live-audio-insight-card-header">
                        <strong>{section.title}</strong>
                        <span className={`status-badge ${section.tone}`}>
                          {section.statusLabel}
                        </span>
                      </div>
                      {section.meta.length > 0 ? (
                        <div className="trainer-defaults-list">
                          {section.meta.map((item) => (
                            <span className="pill" key={`${section.id}-${item}`}>
                              {item}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <p className="live-audio-insight-copy">
                        {section.summary}
                      </p>
                      {section.transcript ? (
                        <p className="live-audio-insight-transcript">
                          Transcript: &quot;{section.transcript}&quot;
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="trainer-session-panel">
          <div className="dashboard-card trainer-workspace-switcher">
            <button
              className={`trainer-workspace-tab ${activeWorkspacePanel === "checklist" ? "is-active" : ""}`}
              onClick={() => setActiveWorkspacePanel("checklist")}
              type="button"
            >
              <ChecklistIcon className="live-shell-icon" />
              <span>Checklist</span>
            </button>
            <button
              className={`trainer-workspace-tab ${activeWorkspacePanel === "analysis" ? "is-active" : ""}`}
              onClick={() => setActiveWorkspacePanel("analysis")}
              type="button"
            >
              <AnalysisIcon className="live-shell-icon" />
              <span>Analysis</span>
            </button>
            <button
              className={`trainer-workspace-tab ${activeWorkspacePanel === "coach" ? "is-active" : ""}`}
              onClick={() => setActiveWorkspacePanel("coach")}
              type="button"
            >
              <CoachIcon className="live-shell-icon" />
              <span>Coach</span>
            </button>
            <button
              className={`trainer-workspace-tab ${activeWorkspacePanel === "setup" ? "is-active" : ""}`}
              onClick={() => setActiveWorkspacePanel("setup")}
              type="button"
            >
              <SetupIcon className="live-shell-icon" />
              <span>Setup</span>
            </button>
          </div>

          <div className="trainer-session-panel-content">{activeWorkspaceContent}</div>
        </aside>
      </section>
    </AppFrame>
  );
}

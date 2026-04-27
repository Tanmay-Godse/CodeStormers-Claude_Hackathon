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
import {
  buildSharedSidebarItems,
  buildSharedTopItems,
  DEFAULT_TRAINING_HREF,
} from "@/lib/appShell";
import {
  startBrowserSpeechCapture,
  canUseBrowserSpeechRecognition,
  canUseVoiceRecording,
  isSpeechPlaybackInProgress,
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
  analyzeLiveFrame,
  coachChat,
  getHealthStatus,
  getProcedure,
  testTranscription,
} from "@/lib/api";
import { createDefaultCalibration } from "@/lib/geometry";
import {
  clearAuthUser,
  consumeAuthLiveSession,
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
  OfflinePracticeLog,
  ProcedureDefinition,
  SessionEvent,
  SessionRecord,
  SkillLevel,
  TranscriptionTestResponse,
} from "@/lib/types";

const AUTO_COACH_INTERVAL_MS = 1_000;
const DEMO_CAMERA_SESSION_LIMIT_MS = 2 * 60 * 1000;
const COACH_CONVERSATION_WINDOW = 4;
const VOICE_RECORDING_MAX_DURATION_MS = 10_000;
const AUDIO_SHORTCUT_MAX_DURATION_MS = 4_500;
const LIVE_VOICE_CAPTURE_MAX_DURATION_MS = 4_500;
const VOICE_RECORDING_MIN_SPEECH_MS = 220;
const VOICE_RECORDING_SILENCE_DURATION_MS = 320;
const VOICE_POST_SPEAK_LISTEN_DELAY_MS = 60;
const VOICE_RELISTEN_DELAY_MS = 120;
const VOICE_RECOVERY_RETRY_DELAY_MS = 250;
const VOICE_PROACTIVE_REPROMPT_DELAY_MS = 250;
const VOICE_PROACTIVE_REPROMPT_AFTER_SILENT_WINDOWS = 2;
const VOICE_MIN_GAP_BETWEEN_PROACTIVE_TURNS_MS = 3_500;
const COACH_IMAGE_REFRESH_WINDOW_MS = 12_000;
const VOICE_MAX_PENDING_TURNS = 6;
const BROWSER_AUDIO_CHECK_EARLY_EXIT_MS = 1_500;
const AUTO_STEP_CHECK_DELAY_MS = 2_500;
const STEP_CHECK_COOLDOWN_MS = 4_000;
const LIVE_MONITOR_INTERVAL_MS = 450;
const LIVE_MONITOR_WINDOW_MS = 4_000;
const LIVE_MONITOR_SPOKEN_CUE_COOLDOWN_MS = 6_500;
const LIVE_MONITOR_SPOKEN_CUE_MIN_STABILITY = 0.62;
const COACH_AUDIO_PLAYBACK_ERROR =
  "Coach guidance is available in text, but spoken playback did not start. Check browser/site audio output and run Preflight if needed.";

type VoiceSessionStatus =
  | "idle"
  | "starting"
  | "watching"
  | "speaking"
  | "listening"
  | "thinking"
  | "paused";

type WorkspacePanel = "checklist" | "analysis" | "setup";

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

type PendingLearnerTurn = {
  transcript: string;
  audioClip: RecordedVoiceClip | null;
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

function detectTrainerVoiceCommand(
  transcript: string,
): "analyze" | "advance" | null {
  const normalized = transcript
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return null;
  }

  const analyzeCommands = new Set([
    "check",
    "check step",
    "check my step",
    "check this step",
    "analyze step",
    "analyze my step",
    "analyse my step",
    "run analysis",
  ]);
  if (analyzeCommands.has(normalized)) {
    return "analyze";
  }

  const advanceCommands = new Set([
    "advance",
    "advance step",
    "go next",
    "move on",
    "next",
    "next step",
  ]);
  if (advanceCommands.has(normalized)) {
    return "advance";
  }

  return null;
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
    return "Camera ready";
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
  voiceSessionStatus: VoiceSessionStatus;
}): { label: string; tone: string } {
  if (options.demoSessionExpired) {
    return { label: "Ended", tone: "status-unsafe" };
  }

  if (options.isSessionPaused) {
    return { label: "Paused", tone: "status-retry" };
  }

  if (!options.cameraReady) {
    return { label: "Standby", tone: "status-retry" };
  }

  if (!options.isLiveSessionActive) {
    return { label: "Ready", tone: "status-retry" };
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
    useState<WorkspacePanel>("checklist");
  const [procedureError, setProcedureError] = useState<string | null>(null);
  const [isLoadingProcedure, setIsLoadingProcedure] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<AnalyzeFrameResponse | null>(null);
  const [liveMonitorFeedback, setLiveMonitorFeedback] =
    useState<AnalyzeFrameResponse | null>(null);
  const [feedbackStageId, setFeedbackStageId] = useState<string | null>(null);
  const [coachMessages, setCoachMessages] = useState<CoachChatMessage[]>([]);
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
  const voiceSessionStatusRef = useRef<VoiceSessionStatus>("idle");
  const [liveSessionAccessError, setLiveSessionAccessError] = useState<string | null>(
    null,
  );
  const [demoSessionExpired, setDemoSessionExpired] = useState(false);
  const [demoTimeRemainingMs, setDemoTimeRemainingMs] = useState(
    DEMO_CAMERA_SESSION_LIMIT_MS,
  );
  const [isSessionPaused, setIsSessionPaused] = useState(false);
  const [isLiveSessionActive, setIsLiveSessionActive] = useState(false);
  const activeVoiceCaptureRef = useRef<VoiceCaptureController | null>(null);
  const voiceCaptureInterruptedByCoachSpeechRef = useRef(false);
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
  const liveCaptureProfileRef = useRef<string | null>(null);
  const lastCoachMessageRef = useRef<{
    at: number;
    conversationStage: CoachChatResponse["conversation_stage"];
    signature: string;
  } | null>(null);
  const lastLiveMonitorSpokenRef = useRef<{
    at: number;
    signature: string;
    stepStatus: AnalyzeFrameResponse["step_status"];
  } | null>(null);
  const lastCoachTurnAtRef = useRef<number | null>(null);
  const lastCoachVisualAtRef = useRef<number | null>(null);
  const analyzeRequestInFlightRef = useRef(false);
  const liveMonitorRequestInFlightRef = useRef(false);
  const liveMonitorSpeechInFlightRef = useRef(false);
  const pendingLearnerTurnsRef = useRef<PendingLearnerTurn[]>([]);
  const lastStepCheckAtRef = useRef<number | null>(null);
  const lastStageAnalysisKeyRef = useRef<string | null>(null);
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
    voiceSessionStatusRef.current = voiceSessionStatus;
  }, [voiceSessionStatus]);

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

    if (micDiagnosticPhase !== "idle" || isRefreshingSetupChecks) {
      return;
    }

    audioShortcutStopRequestedRef.current = false;
    const setupSnapshot = await refreshSetupChecks();

    const shouldRunBrowser = browserSpeechRecognitionAvailable;
    const shouldRunBackend =
      Boolean(setupSnapshot.backendHealth?.transcription_ready) &&
      browserVoiceRecordingAvailable;
    const backendProviderLabel = getTranscriptionProviderLabel(
      setupSnapshot.backendHealth?.transcription_api_base_url,
    );

    if (shouldRunBrowser && shouldRunBackend) {
      await cancelMicDiagnostics();

      const runId = micDiagnosticRunIdRef.current + 1;
      micDiagnosticRunIdRef.current = runId;
      const sharedCaptureStartedAt = performance.now();
      const checkedAt = new Date().toISOString();

      setMicDiagnosticPhase("browser-listening");
      setBrowserMicDiagnostic({
        ...EMPTY_MIC_DIAGNOSTIC_RESULT,
        checkedAt,
        detail:
          "Listening locally and capturing one shared sample for Browser STT and backend transcription.",
      });
      setBackendMicDiagnostic({
        ...EMPTY_MIC_DIAGNOSTIC_RESULT,
        checkedAt,
        detail: `Recording the same mic sample for ${backendProviderLabel} comparison.`,
      });

      try {
        if (browserVoiceRecordingAvailable) {
          await primeVoiceRecordingPermission();
        }

        const [browserController, backendController] = await Promise.all([
          startBrowserSpeechCapture({
            language: equityMode.feedbackLanguage,
            maxDurationMs: AUDIO_SHORTCUT_MAX_DURATION_MS,
          }),
          startVoiceRecording({
            maxDurationMs: AUDIO_SHORTCUT_MAX_DURATION_MS,
            minSpeechDurationMs: VOICE_RECORDING_MIN_SPEECH_MS,
            silenceDurationMs: VOICE_RECORDING_SILENCE_DURATION_MS,
          }),
        ]);

        if (!browserController) {
          throw new Error(
            "Browser speech-to-text is not available here, so the shared audio check could not start.",
          );
        }

        if (!backendController) {
          throw new Error(
            "Microphone recording could not start for the backend comparison path.",
          );
        }

        browserMicDiagnosticControllerRef.current = browserController;
        backendMicDiagnosticControllerRef.current = backendController;

        const [browserCapture, backendCapture] = await Promise.all([
          browserController.result.catch(() => null),
          backendController.result.catch(() => null),
        ]);

        if (micDiagnosticRunIdRef.current !== runId) {
          return;
        }

        browserMicDiagnosticControllerRef.current = null;
        backendMicDiagnosticControllerRef.current = null;

        if (audioShortcutStopRequestedRef.current) {
          audioShortcutStopRequestedRef.current = false;
          setMicDiagnosticPhase("idle");
          return;
        }

        const sharedCaptureDurationMs = Math.max(
          0,
          Math.round(performance.now() - sharedCaptureStartedAt),
        );
        const browserTranscript = browserCapture?.transcript.trim() ?? "";
        const browserShouldFallback =
          !browserTranscript &&
          (sharedCaptureDurationMs <= BROWSER_AUDIO_CHECK_EARLY_EXIT_MS ||
            Boolean(browserCapture?.errorMessage));
        const browserProcessingMs = browserTranscript
          ? Math.max(120, Math.round(sharedCaptureDurationMs * 0.18))
          : null;

        setBrowserMicDiagnostic({
          ...EMPTY_MIC_DIAGNOSTIC_RESULT,
          checkedAt: new Date().toISOString(),
          clipDurationMs: sharedCaptureDurationMs,
          detail: browserTranscript
            ? "Browser speech-to-text completed locally from the shared audio sample."
            : browserShouldFallback
              ? "Browser speech-to-text did not finish in the shared check window. Run Preflight again if you want to retry it."
              : "The browser finished the shared audio sample but did not return a transcript.",
          error:
            browserTranscript.length > 0
              ? null
              : browserCapture?.errorMessage ??
                "No browser transcript was detected from the shared sample.",
          latencyMs: browserProcessingMs,
          processingMs: browserProcessingMs,
          roundTripMs: sharedCaptureDurationMs,
          transcript: browserTranscript,
        });

        if (!backendCapture) {
          setMicDiagnosticPhase("idle");
          setBackendMicDiagnostic({
            ...EMPTY_MIC_DIAGNOSTIC_RESULT,
            checkedAt: new Date().toISOString(),
            error:
              "No usable speech sample was captured for the backend comparison path. Try again and speak one short sentence.",
          });
          void refreshSetupChecks();
          return;
        }

        setMicDiagnosticPhase("backend-transcribing");
        setBackendMicDiagnostic({
          ...EMPTY_MIC_DIAGNOSTIC_RESULT,
          checkedAt: new Date().toISOString(),
          clipDurationMs: backendCapture.durationMs,
          detail: `Recorded ${formatLatency(backendCapture.durationMs) ?? "a short"} shared clip. Sending it to ${backendProviderLabel}.`,
        });

        const requestStartedAt = performance.now();
        const transcriptionResponse = await testTranscription({
          audio_base64: backendCapture.base64,
          audio_format: backendCapture.format,
        });

        if (micDiagnosticRunIdRef.current !== runId) {
          return;
        }

        setMicDiagnosticPhase("idle");
        setBackendMicDiagnostic({
          ...EMPTY_MIC_DIAGNOSTIC_RESULT,
          checkedAt: new Date().toISOString(),
          clipDurationMs: backendCapture.durationMs,
          detail: buildBackendDiagnosticDetail(
            transcriptionResponse,
            backendCapture.durationMs,
          ),
          error: null,
          latencyMs: transcriptionResponse.latency_ms,
          roundTripMs: Math.max(
            0,
            Math.round(performance.now() - requestStartedAt),
          ),
          transcript: transcriptionResponse.transcript,
        });
        void refreshSetupChecks();
        return;
      } catch (error) {
        if (micDiagnosticRunIdRef.current !== runId) {
          return;
        }

        browserMicDiagnosticControllerRef.current = null;
        backendMicDiagnosticControllerRef.current = null;
        setMicDiagnosticPhase("idle");

        const message =
          error instanceof Error
            ? error.message
            : "The shared audio check could not start.";

        setBrowserMicDiagnostic((current) =>
          hasMicDiagnosticTranscript(current) || current.error
            ? current
            : {
                ...EMPTY_MIC_DIAGNOSTIC_RESULT,
                checkedAt: new Date().toISOString(),
                error: message,
              },
        );
        setBackendMicDiagnostic((current) =>
          hasMicDiagnosticTranscript(current) || current.error
            ? current
            : {
                ...EMPTY_MIC_DIAGNOSTIC_RESULT,
                checkedAt: new Date().toISOString(),
                error: message,
              },
        );
        void refreshSetupChecks();
        return;
      }
    }

    let browserResult: MicDiagnosticResult | null = null;
    if (shouldRunBrowser) {
      browserResult = await handleBrowserMicDiagnostic();
    } else if (!browserSpeechRecognitionAvailable) {
      browserResult = await handleBrowserMicDiagnostic();
    }

    if (audioShortcutStopRequestedRef.current) {
      audioShortcutStopRequestedRef.current = false;
      return;
    }

    if (shouldRunBrowser && browserResult === null) {
      setBrowserMicDiagnostic((current) =>
        hasMicDiagnosticTranscript(current) || current.error
          ? current
          : {
              ...EMPTY_MIC_DIAGNOSTIC_RESULT,
              checkedAt: new Date().toISOString(),
              error:
                "Browser speech-to-text did not finish. Run Preflight again to retry it.",
              },
      );
      return;
    }

    if (shouldRunBackend) {
      const backendResult = await handleBackendMicDiagnostic();

      if (audioShortcutStopRequestedRef.current) {
        audioShortcutStopRequestedRef.current = false;
        return;
      }

      if (backendResult === null) {
        setBackendMicDiagnostic((current) =>
          hasMicDiagnosticTranscript(current) || current.error
              ? current
            : {
                ...EMPTY_MIC_DIAGNOSTIC_RESULT,
                checkedAt: new Date().toISOString(),
                error: `${getTranscriptionProviderLabel(
                  setupSnapshot.backendHealth?.transcription_api_base_url,
                )} did not finish. Run Preflight again to retry it.`,
              },
        );
      }
    } else if (
      !browserSpeechRecognitionAvailable &&
      !setupSnapshot.backendHealth?.transcription_ready
    ) {
      await handleBackendMicDiagnostic();
    }
  }, [
    activeWorkspacePanel,
    browserSpeechRecognitionAvailable,
    browserVoiceRecordingAvailable,
    cancelMicDiagnostics,
    equityMode.feedbackLanguage,
    handleBackendMicDiagnostic,
    handleBrowserMicDiagnostic,
    isRefreshingSetupChecks,
    micDiagnosticPhase,
    refreshSetupChecks,
  ]);

  const handleStopAudioShortcut = useCallback(async () => {
    audioShortcutStopRequestedRef.current = true;
    const hadBrowserCapture =
      micDiagnosticPhase === "browser-listening" ||
      Boolean(browserMicDiagnosticControllerRef.current);
    const hadBackendCapture =
      micDiagnosticPhase === "backend-recording" ||
      micDiagnosticPhase === "backend-transcribing" ||
      Boolean(backendMicDiagnosticControllerRef.current);

    await cancelMicDiagnostics();

    if (hadBrowserCapture) {
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

    if (hadBackendCapture) {
      setBackendMicDiagnostic((current) =>
        hasMicDiagnosticTranscript(current) || current.error
          ? current
          : {
              ...EMPTY_MIC_DIAGNOSTIC_RESULT,
              checkedAt: new Date().toISOString(),
              error:
                micDiagnosticPhase === "backend-transcribing"
                  ? `${getTranscriptionProviderLabel(
                      backendHealth?.transcription_api_base_url,
                    )} transcription was stopped before it returned a transcript.`
                  : "Backend audio check was stopped before transcription could begin.",
            },
      );
    }
  }, [
    backendHealth?.transcription_api_base_url,
    cancelMicDiagnostics,
    micDiagnosticPhase,
  ]);

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
  const currentStageAnalysisKey =
    session && currentStage ? `${session.id}:${currentStage.id}` : null;
  const canCheckCurrentStep = Boolean(
    currentStage &&
      !isAnalyzing &&
      simulationConfirmed &&
      cameraStatus.state !== "requesting" &&
      cameraReady,
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
  const hasLiveSessionLimitReached = Boolean(
    authUser &&
      authUser.liveSessionLimit !== null &&
      (authUser.liveSessionRemaining ?? 0) <= 0,
  );
  const cameraToggleLabel = cameraReady
    ? "Stop Camera"
    : isSessionPaused
      ? "Resume Session"
      : cameraStatus.state === "requesting"
        ? "Connecting Camera..."
        : cameraStatus.canRetry && cameraStatus.state !== "idle"
          ? "Retry Camera"
          : "Start Camera";
  const checkStepButtonLabel = isAnalyzing
    ? "Analyzing Step..."
    : isSetupStage
      ? "Check Setup"
      : "Check My Step";
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
              ? "API reachable; AI coach configured"
              : "API reachable, but AI coach config needs attention",
            detail: nextBackendHealth.ai_ready
              ? `Simulation-only mode is ${nextBackendHealth.simulation_only ? "on" : "off"}. Health verifies AI configuration; the first live coach turn verifies model reachability.`
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
    } else if (cameraReady) {
      checks.push({
        id: "camera",
        label: "Camera",
        status: "pass",
        summary: "Camera is live",
        detail:
          "The camera feed is active and ready for step analysis.",
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
              ? "The browser granted camera access, but the camera is not running yet."
              : "The browser reports camera support, but the feed has not been started yet.",
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
            : "The browser granted microphone access. Run Preflight if you want to verify spoken input.",
      });
    } else {
      checks.push({
        id: "microphone",
        label: "Microphone",
        status: "retry",
        summary: "Microphone permission not yet granted",
        detail:
          "The trainer can prompt for microphone access during preflight without requiring a spoken sample.",
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
        status: "retry",
        summary: "Browser speech-to-text available, not verified",
        detail:
          "Browser speech recognition is available and microphone permission is granted. Run Preflight to confirm it returns a usable transcript.",
      });
    } else if (backendSpeechReady && microphonePermissionGranted) {
      checks.push({
        id: "speech-path",
        label: "Speech path",
        status: "retry",
        summary: transcriptionUsesOpenAI
          ? "Backend OpenAI fallback available, not verified"
          : "Backend fallback available, not verified",
        detail: transcriptionUsesOpenAI
          ? "Browser speech-to-text is unavailable here, but the OpenAI transcription fallback is configured and microphone permission is granted. Run Preflight to confirm a spoken sample works."
          : "Browser speech-to-text is unavailable here, but the backend transcription fallback is configured and microphone permission is granted. Run Preflight to confirm a spoken sample works.",
      });
    } else if (browserSpeechRecognitionAvailable || backendSpeechReady) {
      checks.push({
        id: "speech-path",
        label: "Speech path",
        status: "retry",
        summary: "Speech path available, waiting for mic permission",
        detail:
          "Grant microphone permission during preflight so the trainer can enable the available speech path.",
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
  const microphoneSetupCheck =
    setupChecks.find((check) => check.id === "microphone") ?? null;
  const nextSetupCheckRequiringAttention =
    setupChecks.find((check) => check.status !== "pass") ?? null;
  const setupChecksUpdatedLabel = setupChecksUpdatedAt
    ? new Date(setupChecksUpdatedAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  const transcriptionProviderLabel = getTranscriptionProviderLabel(
    backendHealth?.transcription_api_base_url,
  );
  const hasBrowserMicTranscript = hasMicDiagnosticTranscript(browserMicDiagnostic);
  const hasBackendMicTranscript = hasMicDiagnosticTranscript(backendMicDiagnostic);
  const audioCheckUpdatedLabel = formatCheckedAtLabel(
    [browserMicDiagnostic.checkedAt, backendMicDiagnostic.checkedAt]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null,
  );
  const micDiagnosticSummaryTone =
    isRefreshingSetupChecks ||
    micDiagnosticPhase === "backend-transcribing" ||
    micDiagnosticPhase === "backend-recording" ||
    micDiagnosticPhase === "browser-listening"
      ? "status-retry"
      : browserMicDiagnostic.error ||
          backendMicDiagnostic.error ||
          setupSummaryTone === "status-unsafe"
        ? "status-unsafe"
        : !nextSetupCheckRequiringAttention &&
            (hasBrowserMicTranscript || hasBackendMicTranscript)
          ? "status-pass"
          : "status-retry";
  const micDiagnosticSummaryLabel =
    isRefreshingSetupChecks
      ? "refreshing checks"
      : micDiagnosticPhase === "browser-listening"
      ? "checking browser"
      : micDiagnosticPhase === "backend-recording"
        ? "recording sample"
        : micDiagnosticPhase === "backend-transcribing"
          ? "checking backend"
          : browserMicDiagnostic.error ||
              backendMicDiagnostic.error ||
              nextSetupCheckRequiringAttention
            ? "needs attention"
            : hasBrowserMicTranscript || hasBackendMicTranscript
              ? "passed"
              : "ready to test";
  const speechTestSummary =
    browserSpeechRecognitionAvailable && backendHealth?.transcription_ready
      ? `Browser speech-to-text and ${transcriptionProviderLabel} are available. Run Preflight to verify your microphone and system readiness.`
      : browserSpeechRecognitionAvailable
        ? "Browser speech-to-text is available. Run Preflight to verify your microphone and system readiness."
        : backendHealth?.transcription_ready
          ? `Browser speech-to-text is unavailable here, so learner replies will rely on ${transcriptionProviderLabel}. Run Preflight to verify your microphone and system readiness.`
          : "Neither browser speech-to-text nor backend transcription is ready yet.";
  const isRunningPreflight =
    isRefreshingSetupChecks || micDiagnosticPhase !== "idle";
  const deviceTestButtonLabel =
    isRunningPreflight ? "Running Preflight..." : "Run Preflight";
  const canRunDeviceTest = !isRunningPreflight;
  const showStopDeviceTest =
    micDiagnosticPhase === "browser-listening" ||
    micDiagnosticPhase === "backend-recording";
  const deviceTestSummary = useMemo(() => {
    if (isRefreshingSetupChecks) {
      return "Refreshing browser permissions, backend health, and network readiness before the audio checks begin.";
    }

    if (micDiagnosticPhase === "browser-listening") {
      return (
        browserMicDiagnostic.detail ??
        "Listening locally for a short browser speech-to-text sample."
      );
    }

    if (micDiagnosticPhase === "backend-recording") {
      return (
        backendMicDiagnostic.detail ??
        `Recording a short microphone sample for ${transcriptionProviderLabel}.`
      );
    }

    if (micDiagnosticPhase === "backend-transcribing") {
      return (
        backendMicDiagnostic.detail ??
        `Waiting for ${transcriptionProviderLabel} to return the transcript.`
      );
    }

    if (browserMicDiagnostic.error || backendMicDiagnostic.error) {
      if (browserMicDiagnostic.error && !backendMicDiagnostic.error) {
        return microphoneSetupCheck?.status === "pass"
          ? hasBackendMicTranscript
            ? `Microphone is ready, but browser speech-to-text still needs attention: ${browserMicDiagnostic.error} ${transcriptionProviderLabel} is ready as a fallback.`
            : `Microphone is ready, but browser speech-to-text still needs attention: ${browserMicDiagnostic.error}`
          : browserMicDiagnostic.error;
      }

      if (backendMicDiagnostic.error && !browserMicDiagnostic.error) {
        return hasBrowserMicTranscript
          ? `Browser speech-to-text is ready, but ${transcriptionProviderLabel} still needs attention: ${backendMicDiagnostic.error}`
          : backendMicDiagnostic.error;
      }

      return (
        browserMicDiagnostic.error ??
        backendMicDiagnostic.error ??
        "The preflight needs attention."
      );
    }

    if (nextSetupCheckRequiringAttention) {
      return hasBrowserMicTranscript || hasBackendMicTranscript
        ? `Audio is ready, but preflight still needs attention: ${nextSetupCheckRequiringAttention.label}. ${nextSetupCheckRequiringAttention.detail}`
        : `Preflight still needs attention: ${nextSetupCheckRequiringAttention.label}. ${nextSetupCheckRequiringAttention.detail}`;
    }

    if (hasBrowserMicTranscript && hasBackendMicTranscript) {
      return `Preflight passed. Browser speech-to-text and ${transcriptionProviderLabel} both returned a usable transcript.`;
    }

    if (hasBrowserMicTranscript) {
      return "Preflight passed. Browser speech-to-text is ready for live replies.";
    }

    if (hasBackendMicTranscript) {
      return `Preflight passed. ${transcriptionProviderLabel} is ready for live replies.`;
    }

    return speechTestSummary;
  }, [
    backendMicDiagnostic.detail,
    backendMicDiagnostic.error,
    browserMicDiagnostic.detail,
    browserMicDiagnostic.error,
    hasBackendMicTranscript,
    hasBrowserMicTranscript,
    isRefreshingSetupChecks,
    microphoneSetupCheck?.status,
    micDiagnosticPhase,
    nextSetupCheckRequiringAttention,
    speechTestSummary,
    transcriptionProviderLabel,
  ]);
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
  const liveBottomHeadline = demoSessionExpired
    ? "Session ended"
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
        voiceSessionStatus,
      }),
    [
      cameraReady,
      demoSessionExpired,
      equityMode.audioCoaching,
      isLiveSessionActive,
      isSessionPaused,
      voiceSessionStatus,
    ],
  );
  const analysisPanelResponse =
    feedbackStageId === currentStageId ? feedback : liveMonitorFeedback;
  const analysisPanelError =
    feedbackStageId === currentStageId ? analyzeError : null;
  const liveMonitorCopy =
    liveMonitorFeedback?.temporal_state && currentStage
      ? `${liveMonitorFeedback.coaching_message} Live monitor stability ${Math.round(
          liveMonitorFeedback.temporal_state.stability * 100,
        )}%.`
      : null;
  const liveBottomCopy = demoSessionExpired
    ? "This live run ended. Start the camera again when you are ready."
    : isSessionPaused
      ? "This run is paused. Resume when you are ready to continue."
    : isAnalyzing && isLiveSessionActive
      ? "The current frame is being checked and the next spoken cue is being prepared."
    : liveMonitorCopy
      ? liveMonitorCopy
    : isPreviewCameraMode
      ? "The camera is on. The trainer will auto-check once the field has been steady, or you can run a manual check."
    : cameraReady
      ? "Camera is live. Each new stage can auto-check after a steady view, and you can rerun a check if the frame changes."
    : "Start the camera to begin this guided practice block.";

  useEffect(() => {
    coachMessagesRef.current = coachMessages;
  }, [coachMessages]);

  useEffect(() => {
    demoSessionExpiredRef.current = demoSessionExpired;
  }, [demoSessionExpired]);

  useEffect(() => {
    setLiveMonitorFeedback(null);
    liveMonitorRequestInFlightRef.current = false;
    liveMonitorSpeechInFlightRef.current = false;
    voiceCaptureInterruptedByCoachSpeechRef.current = false;
    lastLiveMonitorSpokenRef.current = null;
  }, [cameraReady, currentStageId, isLiveSessionActive, session?.id]);

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
        "This account has no live sessions remaining right now. Please ask an admin to reset the limit.",
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
        lastStageAnalysisKeyRef.current = null;
        lastStepCheckAtRef.current = null;
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
        "Updating the camera to match the current capture profile.",
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
          "Camera stopped. Start it again when you are ready.",
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

    if (isResumingPausedSession) {
      return;
    }
  }, [
    demoSessionExpired,
    getDemoTimeRemainingSnapshot,
    isSessionPaused,
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
    setCoachError(null);
    setLiveSessionActiveState(false);
    setIsCoachLoading(false);
    cancelActiveVoiceCapture();
    stopSpeechPlayback();
    setVoiceSessionStatus("idle");
    setFrozenFrameUrl(null);
    setStudentQuestion("");
    setSimulationConfirmed(true);
    lastStageAnalysisKeyRef.current = null;
    lastStepCheckAtRef.current = null;
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

  const splitLearnerTranscriptIntoTurns = useCallback((transcript: string): string[] => {
    const normalized = transcript.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return [];
    }

    const sentenceLikeTurns = normalized
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (sentenceLikeTurns.length > 1) {
      return sentenceLikeTurns;
    }

    const conjunctionSplitTurns = normalized
      .split(/\s+(?:and then|then|next)\s+/i)
      .map((part) => part.trim())
      .filter(Boolean);
    return conjunctionSplitTurns.length > 1
      ? conjunctionSplitTurns
      : [normalized];
  }, []);

  const enqueueLearnerTurns = useCallback((turns: PendingLearnerTurn[]) => {
    if (turns.length === 0) {
      return;
    }

    const queue = pendingLearnerTurnsRef.current;
    queue.push(...turns);

    if (queue.length > VOICE_MAX_PENDING_TURNS) {
      queue.splice(0, queue.length - VOICE_MAX_PENDING_TURNS);
    }
  }, []);

  const speakCoachMessage = useCallback(async (
    message: string,
    options?: {
      addToTranscript?: boolean;
      conversationStage?: CoachChatResponse["conversation_stage"];
      setListeningAfter?: boolean;
      waitForCompletion?: boolean;
    },
  ): Promise<boolean> => {
    const trimmed = message.trim();
    if (!trimmed || !liveSessionActiveRef.current) {
      return false;
    }

    const addToTranscript = options?.addToTranscript ?? true;
    const setListeningAfter = options?.setListeningAfter ?? true;
    const waitForCompletion = options?.waitForCompletion ?? true;
    const coachSignature = buildCoachMessageSignature(trimmed);

    if (addToTranscript) {
      appendCoachMessage("assistant", trimmed);
    }

    if (activeVoiceCaptureRef.current) {
      voiceCaptureInterruptedByCoachSpeechRef.current = true;
    }
    cancelActiveVoiceCapture();
    setVoiceSessionStatus("speaking");

    const didSpeak = waitForCompletion
      ? await speakTextAndWait(
          trimmed,
          equityMode.feedbackLanguage,
          equityMode.coachVoice,
        )
      : await speakText(
          trimmed,
          equityMode.feedbackLanguage,
          equityMode.coachVoice,
        );

    if (!liveSessionActiveRef.current) {
      return didSpeak;
    }

    if (!didSpeak) {
      setCoachError(COACH_AUDIO_PLAYBACK_ERROR);
      setVoiceSessionStatus("paused");
      return false;
    }

    setCoachError((current) =>
      current === COACH_AUDIO_PLAYBACK_ERROR ? null : current,
    );
    lastCoachMessageRef.current = {
      at: Date.now(),
      conversationStage: options?.conversationStage ?? "guiding",
      signature: coachSignature,
    };
    lastCoachTurnAtRef.current = Date.now();

    if (setListeningAfter) {
      setVoiceSessionStatus("listening");
    }

    return true;
  }, [
    appendCoachMessage,
    cancelActiveVoiceCapture,
    equityMode.coachVoice,
    equityMode.feedbackLanguage,
  ]);

  const handleAnalyzeStep = useCallback(async (
    options?: {
      respectCooldown?: boolean;
    },
  ): Promise<boolean> => {
    if (!procedure || !currentStage || !session || !authUser) {
      return false;
    }

    if (analyzeRequestInFlightRef.current) {
      return false;
    }

    if (
      options?.respectCooldown &&
      currentStageAnalysisKey === lastStageAnalysisKeyRef.current &&
      lastStepCheckAtRef.current !== null &&
      Date.now() - lastStepCheckAtRef.current < STEP_CHECK_COOLDOWN_MS
    ) {
      return false;
    }

    setActiveWorkspacePanel("analysis");

    if (!simulationConfirmed) {
      setAnalyzeError(
        "Confirm that this is a simulation-only practice image before running analysis.",
      );
      return false;
    }

    if (cameraStatus.state === "requesting" || !cameraReady) {
      setAnalyzeError(
        "Turn on the camera and keep a visible frame before analyzing this step.",
      );
      return false;
    }

    analyzeRequestInFlightRef.current = true;
    setFrozenFrameUrl(null);
    setIsAnalyzing(true);
    let capturedFrame: Awaited<ReturnType<CameraFeedHandle["captureFrame"]>> =
      null;

    try {
      capturedFrame = (await cameraRef.current?.captureFrame({
        mode: "analysis",
      })) ?? null;

      if (!capturedFrame) {
        setAnalyzeError(
          "Turn on the camera and keep a visible frame before analyzing this step.",
        );
        return false;
      }

      if (currentStage.id !== "setup") {
        const didActivateLiveSession = await activateLiveSessionIfNeeded();
        if (!didActivateLiveSession) {
          setAnalyzeError(
            "Live training could not start yet. Resolve the session-access issue and try again.",
          );
          return false;
        }
      }

      lastStepCheckAtRef.current = Date.now();
      lastStageAnalysisKeyRef.current = `${session.id}:${currentStage.id}`;
      setAnalyzeError(null);
      setFrozenFrameUrl(capturedFrame.previewUrl);

      if (equityMode.offlinePracticeLogging && !isOnline) {
        appendOfflinePracticeLog(
          session,
          capturedFrame,
          "You are offline. This attempt was logged locally and can be revisited on the review page.",
        );
        return true;
      }

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

      if (
        currentStage.id === "setup" &&
        response.step_status === "pass" &&
        response.grading_decision === "graded"
      ) {
        const nextStageId = findNextStageId(procedure, currentStage.id);
        if (nextStageId) {
          if (cameraRef.current?.hasLiveStream()) {
            cameraStopModeRef.current = "idle";
            cameraRef.current.stopCamera(
              "Setup confirmed. Start the camera again when you are ready for the grip stage.",
            );
          }
          setFeedback(null);
          setFeedbackStageId(null);
          setCurrentStageId(nextStageId);
          setActiveWorkspacePanel("checklist");
          setLiveMonitorFeedback(null);
        }
        return true;
      }

      setFeedback(response);
      setFeedbackStageId(currentStage.id);

      if (
        currentStage.id !== "setup" &&
        equityMode.audioCoaching &&
        liveSessionActiveRef.current &&
        response.coaching_message.trim()
      ) {
        await speakCoachMessage(response.coaching_message, {
          conversationStage: "guiding",
        });
      }
      return true;
    } catch (error) {
      if (
        capturedFrame &&
        equityMode.offlinePracticeLogging &&
        typeof window !== "undefined" &&
        !window.navigator.onLine
      ) {
        appendOfflinePracticeLog(
          session,
          capturedFrame,
          "The network dropped during analysis. This attempt was saved locally for offline practice tracking.",
        );
        return true;
      }

      setAnalyzeError(
        error instanceof Error ? error.message : "The AI analysis request failed.",
      );
      return false;
    } finally {
      setIsAnalyzing(false);
      analyzeRequestInFlightRef.current = false;
    }
  }, [
    activateLiveSessionIfNeeded,
    appendOfflinePracticeLog,
    authUser,
    cameraReady,
    cameraStatus.state,
    calibration,
    currentStage,
    currentStageAnalysisKey,
    equityMode,
    isOnline,
    latestLearnerGoal,
    practiceSurface,
    procedure,
    persistSession,
    session,
    simulationConfirmed,
    skillLevel,
    speakCoachMessage,
    studentQuestion,
  ]);

  function handleLogout() {
    clearAuthUser();
    router.push("/login");
  }

  const handleAdvance = useCallback(() => {
    if (!procedure) {
      return;
    }

    const nextStageId = findNextStageId(procedure, currentStageId);

    if (nextStageId) {
      setCurrentStageId(nextStageId);
      setActiveWorkspacePanel("checklist");
    }
  }, [currentStageId, procedure]);

  function handleOpenReview() {
    if (!session) {
      return;
    }

    router.push(`/review/${session.id}`);
  }

  const handleVoiceCommand = useCallback(async (transcript: string) => {
    const command = detectTrainerVoiceCommand(transcript);

    if (command === "advance") {
      if (!canAdvance) {
        return false;
      }

      handleAdvance();
      return true;
    }

    if (command === "analyze") {
      if (!canCheckCurrentStep) {
        return false;
      }

      return handleAnalyzeStep({
        respectCooldown: true,
      });
    }

    return false;
  }, [canAdvance, canCheckCurrentStep, handleAdvance, handleAnalyzeStep]);

  const maybeSpeakLiveMonitorCue = useCallback(async (
    response: AnalyzeFrameResponse,
  ) => {
    const temporalState = response.temporal_state;
    const message = response.coaching_message.trim();

    if (
      !message ||
      !temporalState ||
      temporalState.analysis_source === "cached" ||
      !equityMode.audioCoaching ||
      !cameraReady ||
      !liveSessionActiveRef.current ||
      liveMonitorSpeechInFlightRef.current ||
      voiceSessionStatusRef.current === "speaking" ||
      voiceSessionStatusRef.current === "thinking" ||
      voiceSessionStatusRef.current === "paused"
    ) {
      return;
    }

    const now = Date.now();
    const signature = buildCoachMessageSignature(message);
    const lastSpokenCue = lastLiveMonitorSpokenRef.current;
    const lastCoachTurnAt = lastCoachTurnAtRef.current;
    const statusChanged = lastSpokenCue?.stepStatus !== response.step_status;
    const cooldownElapsed =
      !lastSpokenCue ||
      now - lastSpokenCue.at >= LIVE_MONITOR_SPOKEN_CUE_COOLDOWN_MS;
    const coachGapElapsed =
      lastCoachTurnAt === null ||
      now - lastCoachTurnAt >= VOICE_MIN_GAP_BETWEEN_PROACTIVE_TURNS_MS;
    const stableEnough =
      temporalState.stability >= LIVE_MONITOR_SPOKEN_CUE_MIN_STABILITY ||
      statusChanged ||
      response.step_status === "unsafe";

    if (
      !stableEnough ||
      (!statusChanged && !cooldownElapsed) ||
      (!statusChanged && !coachGapElapsed)
    ) {
      return;
    }

    if (
      lastSpokenCue?.signature === signature &&
      !statusChanged &&
      !cooldownElapsed
    ) {
      return;
    }

    if (
      lastCoachMessageRef.current?.signature === signature &&
      !cooldownElapsed
    ) {
      return;
    }

    liveMonitorSpeechInFlightRef.current = true;

    try {
      const didSpeak = await speakCoachMessage(message, {
        conversationStage: "guiding",
      });

      if (didSpeak) {
        lastLiveMonitorSpokenRef.current = {
          at: Date.now(),
          signature,
          stepStatus: response.step_status,
        };
      }
    } finally {
      liveMonitorSpeechInFlightRef.current = false;
    }
  }, [
    cameraReady,
    equityMode.audioCoaching,
    speakCoachMessage,
  ]);

  useEffect(() => {
    if (
      !currentStageAnalysisKey ||
      !canCheckCurrentStep ||
      analyzeRequestInFlightRef.current ||
      lastStageAnalysisKeyRef.current === currentStageAnalysisKey
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (
        analyzeRequestInFlightRef.current ||
        lastStageAnalysisKeyRef.current === currentStageAnalysisKey ||
        !cameraRef.current?.hasLiveStream()
      ) {
        return;
      }

      void handleAnalyzeStep({
        respectCooldown: true,
      });
    }, AUTO_STEP_CHECK_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    canCheckCurrentStep,
    currentStageAnalysisKey,
    handleAnalyzeStep,
  ]);

  useEffect(() => {
    if (
      activeWorkspacePanel === "setup" ||
      !authUser ||
      !currentStage ||
      !session ||
      !cameraReady ||
      !isLiveSessionActive ||
      !simulationConfirmed
    ) {
      return;
    }

    const liveMonitorAuthUser = authUser;
    const liveMonitorProcedure = procedure!;
    const liveMonitorSession = session;
    const liveMonitorStage = currentStage;
    let cancelled = false;

    async function runLiveMonitorLoop() {
      while (!cancelled) {
        if (
          !liveSessionActiveRef.current ||
          cameraStatus.state === "requesting" ||
          isAnalyzing ||
          analyzeRequestInFlightRef.current ||
          liveMonitorRequestInFlightRef.current
        ) {
          await waitForCoachLoop(LIVE_MONITOR_INTERVAL_MS);
          continue;
        }

        const capturedFrame = (await cameraRef.current?.captureFrame({
          mode: "coach",
        })) ?? null;

        if (cancelled) {
          return;
        }

        if (!capturedFrame) {
          await waitForCoachLoop(LIVE_MONITOR_INTERVAL_MS);
          continue;
        }

        liveMonitorRequestInFlightRef.current = true;
        let nextDelayMs = LIVE_MONITOR_INTERVAL_MS;

        try {
          const response = await analyzeLiveFrame({
            procedure_id: liveMonitorProcedure.id,
            stage_id: liveMonitorStage.id,
            skill_level: skillLevel,
            practice_surface: practiceSurface,
            image_base64: capturedFrame.base64,
            student_question: studentQuestion.trim() || latestLearnerGoal || undefined,
            simulation_confirmation: simulationConfirmed,
            session_id: liveMonitorSession.id,
            student_name: liveMonitorAuthUser.name,
            student_username: liveMonitorAuthUser.username,
            feedback_language: equityMode.feedbackLanguage,
            equity_mode: toApiEquityMode(equityMode),
            min_analysis_interval_ms: LIVE_MONITOR_INTERVAL_MS,
            state_window_ms: LIVE_MONITOR_WINDOW_MS,
          });

          if (cancelled) {
            return;
          }

          setLiveMonitorFeedback(response);
          void maybeSpeakLiveMonitorCue(response);
          nextDelayMs = Math.max(
            LIVE_MONITOR_INTERVAL_MS,
            response.temporal_state?.next_recommended_check_ms ??
              LIVE_MONITOR_INTERVAL_MS,
          );
        } catch {
          if (cancelled) {
            return;
          }
        } finally {
          liveMonitorRequestInFlightRef.current = false;
        }

        await waitForCoachLoop(nextDelayMs);
      }
    }

    void runLiveMonitorLoop();

    return () => {
      cancelled = true;
      liveMonitorRequestInFlightRef.current = false;
    };
  }, [
    activeWorkspacePanel,
    authUser,
    cameraReady,
    cameraStatus.state,
    currentStage,
    equityMode,
    isAnalyzing,
    isLiveSessionActive,
    latestLearnerGoal,
    maybeSpeakLiveMonitorCue,
    practiceSurface,
    procedure,
    session,
    simulationConfirmed,
    skillLevel,
    studentQuestion,
  ]);

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
        "This live run ended automatically. Start the camera again if you want another guided run.",
      );
      cameraRef.current?.stopCamera(
        "This live run ended automatically. Start the camera again to continue.",
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
    voiceCaptureInterruptedByCoachSpeechRef.current = false;
    pendingLearnerTurnsRef.current = [];
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
          includeImage: false,
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
            lastCoachMessage?.signature === coachSignature;

          if (!voiceChatEnabled && !isDuplicateGuidance) {
            appendCoachMessage("assistant", proactiveResponse.coach_message);
          }

          if (voiceChatEnabled) {
            if (isDuplicateGuidance) {
              setVoiceSessionStatus("listening");
              await waitForCoachLoop(VOICE_RELISTEN_DELAY_MS);
              shouldRequestCoachTurn = false;
              continue;
            }

            const didSpeakCoachTurn = await speakCoachMessage(
              proactiveResponse.coach_message,
              {
                conversationStage: proactiveResponse.conversation_stage,
                waitForCompletion: false,
              },
            );
            if (
              cancelled ||
              voiceLoopGenerationRef.current !== generation ||
              !liveSessionActiveRef.current
            ) {
              return;
            }
            if (!didSpeakCoachTurn) {
              setVoiceSessionStatus("paused");
              await waitForCoachLoop(VOICE_RECOVERY_RETRY_DELAY_MS);
              shouldRequestCoachTurn = true;
              continue;
            }

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
        const captureStartedAt = Date.now();
        try {
          voiceCaptureController = await startVoiceCapture({
            language: equityMode.feedbackLanguage,
            maxDurationMs: LIVE_VOICE_CAPTURE_MAX_DURATION_MS,
            minSpeechDurationMs: VOICE_RECORDING_MIN_SPEECH_MS,
            silenceDurationMs: VOICE_RECORDING_SILENCE_DURATION_MS,
            onSpeechDetected: () => {
              // Barge-in with a short guard window so trailing coach audio does
              // not instantly cut off newly started playback.
              if (
                Date.now() - captureStartedAt >= 450 &&
                isSpeechPlaybackInProgress()
              ) {
                stopSpeechPlayback();
              }
            },
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

        if (voiceCaptureInterruptedByCoachSpeechRef.current) {
          voiceCaptureInterruptedByCoachSpeechRef.current = false;
          while (
            !cancelled &&
            voiceLoopGenerationRef.current === generation &&
            liveMonitorSpeechInFlightRef.current
          ) {
            await waitForCoachLoop(VOICE_POST_SPEAK_LISTEN_DELAY_MS);
          }
          if (cancelled || voiceLoopGenerationRef.current !== generation) {
            return;
          }
          silentListenWindows = 0;
          shouldRequestCoachTurn = false;
          continue;
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

        if (learnerTranscript) {
          const handledVoiceCommand = await handleVoiceCommand(learnerTranscript);

          if (cancelled || voiceLoopGenerationRef.current !== generation) {
            return;
          }

          if (handledVoiceCommand) {
            silentListenWindows = 0;
            shouldRequestCoachTurn = false;
            continue;
          }
        }

        silentListenWindows = 0;
        const transcriptTurns = learnerTranscript
          ? splitLearnerTranscriptIntoTurns(learnerTranscript)
          : [];
        const queuedTurns: PendingLearnerTurn[] =
          transcriptTurns.length > 0
            ? transcriptTurns.map((turnTranscript) => ({
                transcript: turnTranscript,
                audioClip: null,
              }))
            : [
                {
                  transcript: "",
                  audioClip: learnerClip,
                },
              ];
        enqueueLearnerTurns(queuedTurns);

        let shouldRequestAfterQueue = false;
        while (
          pendingLearnerTurnsRef.current.length > 0 &&
          !cancelled &&
          voiceLoopGenerationRef.current === generation
        ) {
          const pendingTurn = pendingLearnerTurnsRef.current.shift();
          if (!pendingTurn) {
            break;
          }

          setVoiceSessionStatus("thinking");
          const learnerResponse = await requestCoachTurn({
            audioClip: pendingTurn.transcript ? null : pendingTurn.audioClip,
            includeImage: false,
            learnerMessage: pendingTurn.transcript,
            messages: coachMessagesRef.current.slice(-COACH_CONVERSATION_WINDOW),
          });

          if (cancelled || voiceLoopGenerationRef.current !== generation) {
            return;
          }

          if (!learnerResponse) {
            setVoiceSessionStatus("paused");
            await waitForCoachLoop(VOICE_RECOVERY_RETRY_DELAY_MS);
            shouldRequestAfterQueue = true;
            break;
          }

          const resolvedLearnerTranscript =
            pendingTurn.transcript || learnerResponse.learner_transcript.trim();
          if (!pendingTurn.transcript && resolvedLearnerTranscript) {
            const handledVoiceCommand =
              await handleVoiceCommand(resolvedLearnerTranscript);

            if (cancelled || voiceLoopGenerationRef.current !== generation) {
              return;
            }

            if (handledVoiceCommand) {
              silentListenWindows = 0;
              shouldRequestCoachTurn = false;
              continue;
            }
          }

          const learnerMessage =
            resolvedLearnerTranscript ||
            learnerResponse.learner_goal_summary.trim();

          if (learnerMessage) {
            appendCoachMessage(
              "user",
              learnerMessage,
            );
          }
          const learnerTurnWasCaptured = Boolean(
            pendingTurn.transcript || pendingTurn.audioClip,
          );
          const coachSignature = buildCoachMessageSignature(
            learnerResponse.coach_message,
          );
          const lastCoachMessage = lastCoachMessageRef.current;
          const isDuplicateGuidance =
            Boolean(coachSignature) &&
            Boolean(lastCoachMessage) &&
            lastCoachMessage?.signature === coachSignature;
          const shouldSuppressCoachReply =
            isDuplicateGuidance && !learnerTurnWasCaptured;

          if (!shouldSuppressCoachReply) {
            const didSpeakCoachTurn = await speakCoachMessage(
              learnerResponse.coach_message,
              {
                conversationStage: learnerResponse.conversation_stage,
                waitForCompletion: false,
              },
            );
            if (
              cancelled ||
              voiceLoopGenerationRef.current !== generation ||
              !liveSessionActiveRef.current
            ) {
              return;
            }
            if (!didSpeakCoachTurn) {
              setVoiceSessionStatus("paused");
              await waitForCoachLoop(VOICE_RECOVERY_RETRY_DELAY_MS);
              shouldRequestAfterQueue = true;
              break;
            }

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
        }

        silentListenWindows = 0;
        shouldRequestCoachTurn = shouldRequestAfterQueue ? true : false;
      }
    }

    void runVoiceCoachLoop();

    return () => {
      cancelled = true;
      pendingLearnerTurnsRef.current = [];
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
    enqueueLearnerTurns,
    equityMode.audioCoaching,
    equityMode.coachVoice,
    equityMode.feedbackLanguage,
    handleVoiceCommand,
    procedure,
    requestCoachTurn,
    session,
    simulationConfirmed,
    splitLearnerTranscriptIntoTurns,
    speakCoachMessage,
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
        autoSpeakEnabled={!voiceChatEnabled && feedbackStageId === currentStage.id}
        coachVoice={equityMode.coachVoice}
        error={analysisPanelError}
        feedbackLanguage={equityMode.feedbackLanguage}
        isAnalyzing={isAnalyzing}
        response={analysisPanelResponse}
        stageTitle={currentStage.title}
      />
    ) : (
      <article className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Preflight</h2>
            <p className="panel-copy">
              Keep device, speech, and backend readiness in one place before or during a live run.
            </p>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span className={`status-badge ${setupSummaryTone}`}>
              {isRefreshingSetupChecks ? "checking..." : setupSummaryLabel}
            </span>
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
            and device permissions are checked here before or during live training.
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
            <strong>Guided preflight</strong>
            <span className={`status-badge ${micDiagnosticSummaryTone}`}>
              {micDiagnosticSummaryLabel}
            </span>
          </div>
          <p className="feedback-copy" style={{ marginTop: 12 }}>
            {deviceTestSummary}
          </p>
          {audioCheckUpdatedLabel ? (
            <p className="feedback-copy" style={{ marginTop: 10 }}>
              {audioCheckUpdatedLabel}
            </p>
          ) : null}
          {coachError ? (
            <p
              className="feedback-copy"
              style={{ color: "#9a3d2d", marginTop: 10 }}
            >
              {coachError}
            </p>
          ) : null}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
            <button
              className="button-secondary"
              disabled={!canRunDeviceTest}
              onClick={() => void handleCheckAudioShortcut()}
              type="button"
            >
              {deviceTestButtonLabel}
            </button>
            {showStopDeviceTest ? (
              <button
                className="button-danger"
                onClick={() => void handleStopAudioShortcut()}
                type="button"
              >
                Stop Test
              </button>
            ) : null}
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
          <p>Preparing the live session and restoring your saved progress.</p>
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
          </div>
          <p className="trainer-session-note">
            {liveSessionAccessError ??
              coachError ??
              "Keep the surface centered. The trainer will auto-check once the view settles, and you can run a manual check anytime."}
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
                  {isPreviewCameraMode ? "Camera controls" : "Session controls"}
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
                    Stop Camera
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

          <div className="live-bottom-bar trainer-session-bar">
            <div className="live-bottom-primary-row">
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
                <button
                  className="button-primary"
                  disabled={!canCheckCurrentStep}
                  onClick={() => void handleAnalyzeStep()}
                  type="button"
                >
                  {checkStepButtonLabel}
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
              className={`trainer-workspace-tab ${activeWorkspacePanel === "setup" ? "is-active" : ""}`}
              onClick={() => setActiveWorkspacePanel("setup")}
              type="button"
            >
              <SetupIcon className="live-shell-icon" />
              <span>Preflight</span>
            </button>
          </div>

          <div className="trainer-session-panel-content">{activeWorkspaceContent}</div>
        </aside>
      </section>
    </AppFrame>
  );
}

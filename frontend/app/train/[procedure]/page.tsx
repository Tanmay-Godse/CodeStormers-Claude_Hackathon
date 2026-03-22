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
  speakTextAndWait,
  startVoiceRecording,
  stopSpeechPlayback,
  type RecordedVoiceClip,
  type VoiceRecordingController,
} from "@/lib/audio";
import { toApiEquityMode } from "@/lib/equity";
import { analyzeFrame, coachChat, getProcedure } from "@/lib/api";
import { createDefaultCalibration } from "@/lib/geometry";
import {
  clearAuthUser,
  consumeAuthLiveSession,
  createDefaultEquityMode,
  getAuthUser,
  getOrCreateActiveSession,
  saveSession,
  startFreshSession,
} from "@/lib/storage";
import type {
  AnalyzeFrameResponse,
  AuthUser,
  Calibration,
  CoachChatMessage,
  CoachChatResponse,
  EquityModeSettings,
  OfflinePracticeLog,
  ProcedureDefinition,
  SessionEvent,
  SessionRecord,
  SkillLevel,
} from "@/lib/types";

const AUTO_COACH_INTERVAL_MS = 1_000;
const DEMO_CAMERA_SESSION_LIMIT_MS = 2 * 60 * 1000;
const COACH_CONVERSATION_WINDOW = 4;
const VOICE_RECORDING_MAX_DURATION_MS = 10_000;
const VOICE_RECORDING_MIN_SPEECH_MS = 220;
const VOICE_RECORDING_SILENCE_DURATION_MS = 800;
const VOICE_POST_SPEAK_LISTEN_DELAY_MS = 120;
const VOICE_RELISTEN_DELAY_MS = 120;
const VOICE_RECOVERY_RETRY_DELAY_MS = 250;
const VOICE_PROACTIVE_REPROMPT_DELAY_MS = 500;
const VOICE_PROACTIVE_REPROMPT_AFTER_SILENT_WINDOWS = 3;
const VOICE_MIN_GAP_BETWEEN_PROACTIVE_TURNS_MS = 12_000;
const VOICE_DUPLICATE_GUIDANCE_COOLDOWN_MS = 20_000;

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

function buildCoachMessageSignature(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function getVoiceStatusHeadline(status: VoiceSessionStatus, cameraReady: boolean): string {
  if (!cameraReady) {
    return "Camera offline";
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
  const [voiceSessionStatus, setVoiceSessionStatus] =
    useState<VoiceSessionStatus>("idle");
  const [liveSessionAccessError, setLiveSessionAccessError] = useState<string | null>(
    null,
  );
  const [demoSessionExpired, setDemoSessionExpired] = useState(false);
  const [demoTimeRemainingMs, setDemoTimeRemainingMs] = useState(
    DEMO_CAMERA_SESSION_LIMIT_MS,
  );
  const activeVoiceRecordingRef = useRef<VoiceRecordingController | null>(null);
  const coachMessagesRef = useRef<CoachChatMessage[]>([]);
  const voiceLoopGenerationRef = useRef(0);
  const demoDeadlineRef = useRef<number | null>(null);
  const demoSessionExpiredRef = useRef(false);
  const liveCaptureProfileRef = useRef<string | null>(null);
  const autoSetupAnalysisAttemptedRef = useRef(false);
  const lastCoachMessageRef = useRef<{
    at: number;
    conversationStage: CoachChatResponse["conversation_stage"];
    signature: string;
  } | null>(null);
  const lastCoachTurnAtRef = useRef<number | null>(null);

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

  useEffect(() => {
    const nextUser = getAuthUser();

    if (!nextUser) {
      const nextPath = procedureId
        ? `/train/${procedureId}`
        : "/train/simple-interrupted-suture";
      router.replace(`/login?role=student&next=${encodeURIComponent(nextPath)}`);
      return;
    }

    setAuthUser(nextUser);
    setIsAuthLoading(false);
  }, [procedureId, router]);

  useEffect(() => {
    const activeProcedureId = procedureId;
    const currentUser = authUser;

    if (!currentUser) {
      return;
    }
    const currentUsername = currentUser.username;

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
  }, [authUser, procedureId]);

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
  const latestLearnerGoal = useMemo(
    () =>
      [...coachMessages]
        .reverse()
        .find((message) => message.role === "user")
        ?.content.trim() ?? "",
    [coachMessages],
  );
  const voiceChatEnabled = cameraReady && equityMode.audioCoaching;
  const captureProfileLabel = "Standard capture";
  const hasLiveSessionLimitReached = Boolean(
    authUser &&
      authUser.liveSessionLimit !== null &&
      (authUser.liveSessionRemaining ?? 0) <= 0,
  );
  const cameraToggleLabel = cameraReady
    ? "Stop Camera"
    : hasLiveSessionLimitReached
      ? "Live Session Limit Reached"
    : cameraStatus.state === "requesting"
      ? "Connecting Camera..."
      : cameraStatus.canRetry && cameraStatus.state !== "idle"
        ? "Retry Camera"
        : "Start Camera";
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
  const liveStageConfidence = useMemo(() => {
    if (!feedback || feedbackStageId !== currentStageId) {
      return null;
    }

    return Math.round(feedback.confidence * 100);
  }, [currentStageId, feedback, feedbackStageId]);
  const voiceStatusHeadline = useMemo(
    () => getVoiceStatusHeadline(voiceSessionStatus, cameraReady),
    [cameraReady, voiceSessionStatus],
  );
  const captureProfileSignature = "standard";
  const demoTimerLabel = useMemo(() => {
    if (demoSessionExpired) {
      return "Demo window ended";
    }

    if (cameraReady) {
      return `${formatDurationClock(demoTimeRemainingMs)} remaining`;
    }

    return "2-minute demo limit";
  }, [cameraReady, demoSessionExpired, demoTimeRemainingMs]);
  const demoTimerTone = demoSessionExpired
    ? "status-unsafe"
    : cameraReady && demoTimeRemainingMs <= 30_000
      ? "status-retry"
      : cameraReady
        ? "status-pass"
        : "";
  const liveBottomHeadline = demoSessionExpired
    ? "Demo window ended"
    : voiceStatusHeadline;
  const liveBottomCopy = demoSessionExpired
    ? "This hackathon preview auto-stopped after 2 minutes. Start the camera again for another guided run."
    : cameraReady
      ? `Hackathon demo timer: ${formatDurationClock(
          demoTimeRemainingMs,
        )} remaining. Coach voice is live.`
      : "Start the camera to begin this guided practice block.";

  useEffect(() => {
    coachMessagesRef.current = coachMessages;
  }, [coachMessages]);

  useEffect(() => {
    demoSessionExpiredRef.current = demoSessionExpired;
  }, [demoSessionExpired]);

  const persistSession = useCallback((nextSession: SessionRecord) => {
    saveSession(nextSession);
    setSession(nextSession);
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

  function cancelActiveVoiceRecording() {
    const activeRecording = activeVoiceRecordingRef.current;
    activeVoiceRecordingRef.current = null;

    if (!activeRecording) {
      return;
    }

    void activeRecording.cancel().catch(() => {});
  }

  async function waitForCoachLoop(delayMs: number) {
    await new Promise((resolve) => {
      window.setTimeout(resolve, delayMs);
    });
  }

  function handleCameraReadyChange(ready: boolean) {
    setCameraReady(ready);
    liveCaptureProfileRef.current = ready ? captureProfileSignature : null;
    autoSetupAnalysisAttemptedRef.current = false;

    if (ready) {
      demoDeadlineRef.current = Date.now() + DEMO_CAMERA_SESSION_LIMIT_MS;
      demoSessionExpiredRef.current = false;
      setDemoSessionExpired(false);
      setDemoTimeRemainingMs(DEMO_CAMERA_SESSION_LIMIT_MS);
    } else {
      demoDeadlineRef.current = null;
      setDemoTimeRemainingMs(
        demoSessionExpiredRef.current ? 0 : DEMO_CAMERA_SESSION_LIMIT_MS,
      );
    }

    if (!ready) {
      cancelActiveVoiceRecording();
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

  async function handleCameraToggle() {
    const camera = cameraRef.current;

    if (!camera) {
      return;
    }

    if (camera.hasLiveStream()) {
      setLiveSessionAccessError(null);
      camera.stopCamera();
      return;
    }

    if (
      hasLiveSessionLimitReached
    ) {
      setLiveSessionAccessError(
        "This demo account has used all 10 live sessions. Please ask an admin or the developer team to reset the limit.",
      );
      return;
    }

    try {
      await camera.startCamera();
    } catch (error) {
      setLiveSessionAccessError(
        error instanceof Error
          ? error.message
          : "The camera could not be started right now.",
      );
      return;
    }

    try {
      const nextUser = await consumeAuthLiveSession();
      setAuthUser(nextUser);
      setLiveSessionAccessError(null);
    } catch (error) {
      const nextMessage =
        error instanceof Error
          ? error.message
          : "This account could not start another live session.";
      setLiveSessionAccessError(nextMessage);
      camera.stopCamera(nextMessage);
    }
  }

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
    setIsCoachLoading(false);
    cancelActiveVoiceRecording();
    stopSpeechPlayback();
    setVoiceSessionStatus(cameraReady ? "starting" : "idle");
    setFrozenFrameUrl(null);
    setStudentQuestion("");
    setSimulationConfirmed(true);
    autoSetupAnalysisAttemptedRef.current = false;
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

    const capturedFrame = await cameraRef.current?.captureFrame({
      mode: "analysis",
    });

    if (!capturedFrame) {
      setAnalyzeError(
        "Turn on the camera and keep a visible frame before analyzing this step.",
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
        currentStage.id === "setup" &&
        response.step_status === "pass" &&
        response.grading_decision === "graded"
      ) {
        const nextStageId = findNextStageId(procedure, currentStage.id);
        if (nextStageId) {
          setCurrentStageId(nextStageId);
          setStudentQuestion("");
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
    appendOfflinePracticeLog,
    authUser,
    calibration,
    currentStage,
    equityMode,
    isOnline,
    latestLearnerGoal,
    practiceSurface,
    procedure,
    persistSession,
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
      setStudentQuestion("");
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
    messages,
  }: {
    audioClip?: RecordedVoiceClip | null;
    includeImage?: boolean;
    messages: CoachChatMessage[];
  }): Promise<CoachChatResponse | null> => {
    if (!procedure || !currentStage || !session || !authUser) {
      return null;
    }

    setIsCoachLoading(true);
    setCoachError(null);

    try {
      const capturedFrame =
        includeImage && cameraReady && simulationConfirmed
          ? await cameraRef.current?.captureFrame({
              mode: "coach",
            })
          : null;

      const response = await coachChat({
        procedure_id: procedure.id,
        stage_id: currentStage.id,
        skill_level: skillLevel,
        practice_surface: practiceSurface,
        feedback_language: equityMode.feedbackLanguage,
        simulation_confirmation: simulationConfirmed,
        image_base64: capturedFrame?.base64,
        audio_base64: audioClip?.base64,
        audio_format: audioClip?.format,
        session_id: session.id,
        student_name: authUser.name,
        equity_mode: toApiEquityMode(equityMode),
        messages,
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
    practiceSurface,
    procedure,
    session,
    simulationConfirmed,
    skillLevel,
  ]);

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

  useEffect(() => {
    setCoachTurn(null);
    setCoachMessages([]);
    coachMessagesRef.current = [];
    lastCoachMessageRef.current = null;
    lastCoachTurnAtRef.current = null;
    setVoiceSessionStatus(cameraReady ? "starting" : "idle");
  }, [cameraReady, currentStageId]);

  useEffect(() => {
    if (!cameraReady) {
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
  }, [cameraReady]);

  useEffect(() => {
    if (
      !cameraReady ||
      !procedure ||
      !session ||
      !currentStage ||
      currentStage.id !== "setup" ||
      isAnalyzing ||
      !simulationConfirmed
    ) {
      return;
    }

    const alreadyPassedSetup = session.events.some(
      (event) =>
        event.stageId === "setup" &&
        event.stepStatus === "pass" &&
        event.graded,
    );

    if (alreadyPassedSetup || autoSetupAnalysisAttemptedRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      autoSetupAnalysisAttemptedRef.current = true;
      void handleAnalyzeStep();
    }, 1400);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    cameraReady,
    currentStage,
    handleAnalyzeStep,
    isAnalyzing,
    procedure,
    session,
    simulationConfirmed,
  ]);

  useEffect(() => {
    const generation = voiceLoopGenerationRef.current + 1;
    voiceLoopGenerationRef.current = generation;
    cancelActiveVoiceRecording();
    stopSpeechPlayback();

    if (!cameraReady || !procedure || !currentStage || !session || !authUser) {
      setVoiceSessionStatus("idle");
      return () => {
        cancelActiveVoiceRecording();
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
            await speakTextAndWait(
              proactiveResponse.coach_message,
              equityMode.feedbackLanguage,
              equityMode.coachVoice,
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

        let recordingController: VoiceRecordingController | null = null;
        try {
          recordingController = await startVoiceRecording({
            maxDurationMs: VOICE_RECORDING_MAX_DURATION_MS,
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

        if (!recordingController) {
          setCoachError(
            "This browser does not support microphone recording for the voice coach.",
          );
          setVoiceSessionStatus("paused");
          await waitForCoachLoop(VOICE_RECOVERY_RETRY_DELAY_MS);
          shouldRequestCoachTurn = true;
          continue;
        }

        activeVoiceRecordingRef.current = recordingController;
        const learnerClip = await recordingController.result;
        if (activeVoiceRecordingRef.current === recordingController) {
          activeVoiceRecordingRef.current = null;
        }

        if (cancelled || voiceLoopGenerationRef.current !== generation) {
          return;
        }

        if (
          !learnerClip ||
          learnerClip.durationMs < VOICE_RECORDING_MIN_SPEECH_MS
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
          audioClip: learnerClip,
          includeImage: false,
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

        const learnerTranscript = learnerResponse.learner_transcript.trim();
        const learnerMessage =
          learnerTranscript || learnerResponse.learner_goal_summary.trim();

        if (learnerMessage) {
          appendCoachMessage(
            "user",
            learnerMessage,
          );
        }
        const coachSignature = buildCoachMessageSignature(
          learnerResponse.coach_message,
        );
        const lastCoachMessage = lastCoachMessageRef.current;
        const isDuplicateGuidance =
          Boolean(coachSignature) &&
          Boolean(lastCoachMessage) &&
          lastCoachMessage?.signature === coachSignature &&
          Date.now() - lastCoachMessage.at < VOICE_DUPLICATE_GUIDANCE_COOLDOWN_MS;

        if (!isDuplicateGuidance) {
          appendCoachMessage("assistant", learnerResponse.coach_message);
        }
        setVoiceSessionStatus("speaking");
        if (!isDuplicateGuidance) {
          await speakTextAndWait(
            learnerResponse.coach_message,
            equityMode.feedbackLanguage,
            equityMode.coachVoice,
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
      cancelActiveVoiceRecording();
      stopSpeechPlayback();
    };
  }, [
    appendCoachMessage,
    authUser,
    cameraReady,
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
              The demo now uses one fixed guided setup so learners can start faster.
            </p>
          </div>
          <span className="pill">demo defaults active</span>
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
            <strong>Fixed demo behavior</strong>
            <span className="status-badge status-pass">active</span>
          </div>
          <p className="feedback-copy" style={{ marginTop: 12 }}>
            Simulation-only confirmation, hands-free audio coaching, and offline-first
            logging are always on for this demo.
          </p>
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

  if (isAuthLoading || isLoadingProcedure) {
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
            <span className="pill">
              {simulationConfirmed ? "simulation confirmed" : "simulation only"}
            </span>
          </div>
          <p className="trainer-session-note">
            {liveSessionAccessError ??
              "Keep the surface centered and use Check My Step when the frame looks ready."}
          </p>
        </div>

        <div className="trainer-session-hero-actions">
          <button
            className="button-primary trainer-session-action"
            disabled={
              cameraStatus.state === "requesting" ||
              (!cameraReady && hasLiveSessionLimitReached)
            }
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
                  onStatusChange={handleCameraStatusChange}
                  primeMicrophoneOnStart={equityMode.audioCoaching}
                />
              </div>
            </div>
          </div>

          <div className="live-bottom-bar trainer-session-bar">
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
              <div className="live-mic-badge">MIC</div>
              <div>
                <p className="live-bottom-kicker">AI System Status</p>
                <p className="live-bottom-headline">{liveBottomHeadline}</p>
                <p className="live-bottom-copy">{liveBottomCopy}</p>
              </div>
            </div>

            <div className="live-bottom-actions">
              <button
                className="button-primary"
                disabled={!cameraReady || isAnalyzing || !simulationConfirmed}
                onClick={() => void handleAnalyzeStep()}
                type="button"
              >
                {isAnalyzing ? "Analyzing Step..." : "Check My Step"}
              </button>
              <button
                className="button-secondary"
                disabled={!canAdvance}
                onClick={handleAdvance}
                type="button"
              >
                Advance
              </button>
              <button
                className="button-secondary"
                disabled={!canFinishReview}
                onClick={handleOpenReview}
                type="button"
              >
                Review
              </button>
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

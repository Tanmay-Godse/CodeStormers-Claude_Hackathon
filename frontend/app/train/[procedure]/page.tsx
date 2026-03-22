"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CameraFeed, type CameraFeedHandle } from "@/components/CameraFeed";
import { CalibrationOverlay } from "@/components/CalibrationOverlay";
import { FeedbackCard } from "@/components/FeedbackCard";
import { OverlayRenderer } from "@/components/OverlayRenderer";
import { ProcedureStepper } from "@/components/ProcedureStepper";
import { VoiceCoachPanel } from "@/components/VoiceCoachPanel";
import {
  speakTextAndWait,
  startVoiceRecording,
  stopSpeechPlayback,
  type RecordedVoiceClip,
  type VoiceRecordingController,
} from "@/lib/audio";
import {
  FEEDBACK_LANGUAGE_OPTIONS,
  getFeedbackLanguageLabel,
  toApiEquityMode,
} from "@/lib/equity";
import { analyzeFrame, coachChat, getProcedure } from "@/lib/api";
import { createDefaultCalibration } from "@/lib/geometry";
import {
  clearAuthUser,
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
  CalibrationMode,
  CoachChatMessage,
  CoachChatResponse,
  EquityModeSettings,
  OfflinePracticeLog,
  ProcedureDefinition,
  SessionEvent,
  SessionRecord,
  SkillLevel,
} from "@/lib/types";

const CAMERA_OVERLAY_TIMEOUT_MS = 10_000;
const AUTO_COACH_INTERVAL_MS = 12_000;
const VOICE_RECORDING_MAX_DURATION_MS = 10_000;
const VOICE_RECORDING_MIN_SPEECH_MS = 400;
const VOICE_RECORDING_SILENCE_DURATION_MS = 1_100;
const VOICE_RELISTEN_DELAY_MS = 300;
const VOICE_PROACTIVE_REPROMPT_AFTER_SILENT_WINDOWS = 3;

type VoiceSessionStatus =
  | "idle"
  | "starting"
  | "watching"
  | "speaking"
  | "listening"
  | "thinking"
  | "paused";

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
  const [equityMode, setEquityMode] = useState<EquityModeSettings>(
    createDefaultEquityMode(),
  );
  const [calibration, setCalibration] = useState<Calibration>(
    createDefaultCalibration(),
  );
  const [calibrationMode, setCalibrationMode] =
    useState<CalibrationMode>("corners");
  const [cameraReady, setCameraReady] = useState(false);
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
  const [showCalibrationOverlay, setShowCalibrationOverlay] = useState(false);
  const [showFeedbackOverlay, setShowFeedbackOverlay] = useState(false);
  const [frozenFrameUrl, setFrozenFrameUrl] = useState<string | null>(null);
  const [studentQuestion, setStudentQuestion] = useState("");
  const [simulationConfirmed, setSimulationConfirmed] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [voiceSessionStatus, setVoiceSessionStatus] =
    useState<VoiceSessionStatus>("idle");
  const calibrationOverlayTimeoutRef = useRef<number | null>(null);
  const feedbackOverlayTimeoutRef = useRef<number | null>(null);
  const activeVoiceRecordingRef = useRef<VoiceRecordingController | null>(null);
  const coachMessagesRef = useRef<CoachChatMessage[]>([]);
  const voiceLoopGenerationRef = useRef(0);

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
    return () => {
      if (typeof window === "undefined") {
        return;
      }

      if (calibrationOverlayTimeoutRef.current !== null) {
        window.clearTimeout(calibrationOverlayTimeoutRef.current);
      }

      if (feedbackOverlayTimeoutRef.current !== null) {
        window.clearTimeout(feedbackOverlayTimeoutRef.current);
      }
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
        setEquityMode(activeSession.equityMode);
        setCalibration(activeSession.calibration);
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

  const currentStageAttempts = useMemo(() => {
    if (!session || !currentStageId) {
      return 0;
    }

    return session.events.filter((event) => event.stageId === currentStageId).length;
  }, [currentStageId, session]);

  const totalScore = useMemo(
    () =>
      session?.events.reduce((sum, event) => sum + event.scoreDelta, 0) ?? 0,
    [session],
  );

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
  const voiceChatEnabled =
    cameraReady && equityMode.enabled && equityMode.audioCoaching;

  useEffect(() => {
    coachMessagesRef.current = coachMessages;
  }, [coachMessages]);

  function persistSession(nextSession: SessionRecord) {
    saveSession(nextSession);
    setSession(nextSession);
  }

  function clearCalibrationOverlayTimer() {
    if (
      typeof window !== "undefined" &&
      calibrationOverlayTimeoutRef.current !== null
    ) {
      window.clearTimeout(calibrationOverlayTimeoutRef.current);
      calibrationOverlayTimeoutRef.current = null;
    }
  }

  function clearFeedbackOverlayTimer() {
    if (
      typeof window !== "undefined" &&
      feedbackOverlayTimeoutRef.current !== null
    ) {
      window.clearTimeout(feedbackOverlayTimeoutRef.current);
      feedbackOverlayTimeoutRef.current = null;
    }
  }

  function showCalibrationOverlayForTenSeconds(forceVisible = false) {
    if (typeof window === "undefined" || (!cameraReady && !forceVisible)) {
      return;
    }

    clearCalibrationOverlayTimer();
    setShowCalibrationOverlay(true);
    calibrationOverlayTimeoutRef.current = window.setTimeout(() => {
      setShowCalibrationOverlay(false);
      calibrationOverlayTimeoutRef.current = null;
    }, CAMERA_OVERLAY_TIMEOUT_MS);
  }

  function showFeedbackOverlayForTenSeconds() {
    if (typeof window === "undefined") {
      return;
    }

    clearFeedbackOverlayTimer();
    setShowFeedbackOverlay(true);
    feedbackOverlayTimeoutRef.current = window.setTimeout(() => {
      setShowFeedbackOverlay(false);
      feedbackOverlayTimeoutRef.current = null;
    }, CAMERA_OVERLAY_TIMEOUT_MS);
  }

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

    if (!ready) {
      cancelActiveVoiceRecording();
      stopSpeechPlayback();
      clearCalibrationOverlayTimer();
      clearFeedbackOverlayTimer();
      setShowCalibrationOverlay(false);
      setShowFeedbackOverlay(false);
      setVoiceSessionStatus("idle");
      return;
    }

    showCalibrationOverlayForTenSeconds(true);
  }

  function handleSkillLevelChange(nextSkillLevel: SkillLevel) {
    setSkillLevel(nextSkillLevel);

    if (!session) {
      return;
    }

    persistSession({
      ...session,
      skillLevel: nextSkillLevel,
      updatedAt: new Date().toISOString(),
    });
  }

  function handleEquityModeChange(nextEquityMode: EquityModeSettings) {
    setEquityMode(nextEquityMode);

    if (!session) {
      return;
    }

    persistSession({
      ...session,
      equityMode: nextEquityMode,
      debrief: undefined,
      updatedAt: new Date().toISOString(),
    });
  }

  function handleEquityOptionChange(
    key: "audioCoaching" | "lowBandwidthMode" | "cheapPhoneMode" | "offlinePracticeLogging",
    value: boolean,
  ) {
    handleEquityModeChange({
      ...equityMode,
      enabled: true,
      [key]: value,
    });
  }

  function handleFeedbackLanguageChange(language: EquityModeSettings["feedbackLanguage"]) {
    handleEquityModeChange({
      ...equityMode,
      enabled: true,
      feedbackLanguage: language,
    });
  }

  function handleCoachVoiceChange(voice: EquityModeSettings["coachVoice"]) {
    handleEquityModeChange({
      ...equityMode,
      coachVoice: voice,
    });
  }

  function handleCalibrationChange(nextCalibration: Calibration) {
    setCalibration(nextCalibration);

    if (!session) {
      return;
    }

    persistSession({
      ...session,
      calibration: nextCalibration,
      updatedAt: new Date().toISOString(),
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
      updatedAt: new Date().toISOString(),
    });
    setSession(freshSession);
    setCalibration(freshSession.calibration);
    setCurrentStageId(procedure.stages[0]?.id ?? "");
    setFeedback(null);
    setFeedbackStageId(null);
    setCoachMessages([]);
    setCoachTurn(null);
    setCoachError(null);
    setIsCoachLoading(false);
    cancelActiveVoiceRecording();
    stopSpeechPlayback();
    setVoiceSessionStatus(cameraReady ? "starting" : "idle");
    clearFeedbackOverlayTimer();
    setShowFeedbackOverlay(false);
    setFrozenFrameUrl(null);
    setStudentQuestion("");
    setSimulationConfirmed(false);
    setAnalyzeError(null);
  }

  function appendOfflinePracticeLog(
    sessionSnapshot: SessionRecord,
    frame: { width: number; height: number },
    reason: string,
  ) {
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
    clearFeedbackOverlayTimer();
    setShowFeedbackOverlay(false);
    setFeedback(null);
    setFeedbackStageId(null);
    setAnalyzeError(reason);
  }

  async function handleAnalyzeStep() {
    if (!procedure || !currentStage || !session || !authUser) {
      return;
    }

    if (!simulationConfirmed) {
      setAnalyzeError(
        "Confirm that this is a simulation-only practice image before running analysis.",
      );
      return;
    }

    const capturedFrame = await cameraRef.current?.captureFrame();

    if (!capturedFrame) {
      setAnalyzeError(
        "Turn on the camera and keep a visible frame before analyzing this step.",
      );
      return;
    }

    setAnalyzeError(null);
    setFrozenFrameUrl(capturedFrame.previewUrl);

    if (equityMode.enabled && equityMode.offlinePracticeLogging && !isOnline) {
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
        image_base64: capturedFrame.base64,
        student_question: studentQuestion.trim() || latestLearnerGoal || undefined,
        simulation_confirmation: simulationConfirmed,
        session_id: session.id,
        student_name: authUser.name,
        feedback_language: equityMode.feedbackLanguage,
        equity_mode: toApiEquityMode({
          ...equityMode,
          audioCoaching: equityMode.enabled && equityMode.audioCoaching,
          lowBandwidthMode: equityMode.enabled && equityMode.lowBandwidthMode,
          cheapPhoneMode: equityMode.enabled && equityMode.cheapPhoneMode,
          offlinePracticeLogging:
            equityMode.enabled && equityMode.offlinePracticeLogging,
        }),
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
      showFeedbackOverlayForTenSeconds();
    } catch (error) {
      if (
        equityMode.enabled &&
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
  }

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
    }
  }

  function handleOpenReview() {
    if (!session) {
      return;
    }

    router.push(`/review/${session.id}`);
  }

  function handleToggleCalibrationMode() {
    setCalibrationMode((current) => (current === "corners" ? "guide" : "corners"));
    showCalibrationOverlayForTenSeconds();
  }

  function handleShowCameraOverlay() {
    showCalibrationOverlayForTenSeconds();

    if (feedbackStageId === currentStageId && (feedback?.overlay_target_ids.length ?? 0) > 0) {
      showFeedbackOverlayForTenSeconds();
    }
  }

  const requestCoachTurn = useCallback(async ({
    audioClip,
    messages,
  }: {
    audioClip?: RecordedVoiceClip | null;
    messages: CoachChatMessage[];
  }): Promise<CoachChatResponse | null> => {
    if (!procedure || !currentStage || !session || !authUser) {
      return null;
    }

    setIsCoachLoading(true);
    setCoachError(null);

    try {
      const capturedFrame =
        cameraReady && simulationConfirmed
          ? await cameraRef.current?.captureFrame()
          : null;

      const response = await coachChat({
        procedure_id: procedure.id,
        stage_id: currentStage.id,
        skill_level: skillLevel,
        feedback_language: equityMode.feedbackLanguage,
        simulation_confirmation: simulationConfirmed,
        image_base64: capturedFrame?.base64,
        audio_base64: audioClip?.base64,
        audio_format: audioClip?.format,
        session_id: session.id,
        student_name: authUser.name,
        equity_mode: toApiEquityMode({
          ...equityMode,
          audioCoaching: equityMode.enabled && equityMode.audioCoaching,
          lowBandwidthMode: equityMode.enabled && equityMode.lowBandwidthMode,
          cheapPhoneMode: equityMode.enabled && equityMode.cheapPhoneMode,
          offlinePracticeLogging:
            equityMode.enabled && equityMode.offlinePracticeLogging,
        }),
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
    setVoiceSessionStatus(cameraReady ? "starting" : "idle");
  }, [cameraReady, currentStageId]);

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
          setVoiceSessionStatus(
            coachMessagesRef.current.length === 0 ? "starting" : "watching",
          );

          const proactiveResponse = await requestCoachTurn({
            messages: coachMessagesRef.current.slice(-6),
          });

          if (cancelled || voiceLoopGenerationRef.current !== generation) {
            return;
          }

          if (!proactiveResponse) {
            setVoiceSessionStatus("paused");
            await waitForCoachLoop(AUTO_COACH_INTERVAL_MS);
            continue;
          }

          appendCoachMessage("assistant", proactiveResponse.coach_message);

          if (voiceChatEnabled) {
            setVoiceSessionStatus("speaking");
            await speakTextAndWait(
              proactiveResponse.coach_message,
              equityMode.feedbackLanguage,
              equityMode.coachVoice,
            );

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
          await waitForCoachLoop(AUTO_COACH_INTERVAL_MS);
          shouldRequestCoachTurn = true;
          continue;
        }

        if (!recordingController) {
          setCoachError(
            "This browser does not support microphone recording for the voice coach.",
          );
          setVoiceSessionStatus("paused");
          await waitForCoachLoop(AUTO_COACH_INTERVAL_MS);
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
          setVoiceSessionStatus("listening");

          if (
            silentListenWindows >=
            VOICE_PROACTIVE_REPROMPT_AFTER_SILENT_WINDOWS
          ) {
            silentListenWindows = 0;
            await waitForCoachLoop(1_500);
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
          messages: coachMessagesRef.current.slice(-6),
        });

        if (cancelled || voiceLoopGenerationRef.current !== generation) {
          return;
        }

        if (!learnerResponse) {
          setVoiceSessionStatus("paused");
          await waitForCoachLoop(AUTO_COACH_INTERVAL_MS);
          shouldRequestCoachTurn = true;
          continue;
        }

        appendCoachMessage(
          "user",
          learnerResponse.learner_goal_summary.trim() || "Voice reply received.",
        );
        appendCoachMessage("assistant", learnerResponse.coach_message);
        setVoiceSessionStatus("speaking");
        await speakTextAndWait(
          learnerResponse.coach_message,
          equityMode.feedbackLanguage,
          equityMode.coachVoice,
        );

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
    equityMode.enabled,
    equityMode.feedbackLanguage,
    procedure,
    requestCoachTurn,
    session,
    simulationConfirmed,
    voiceChatEnabled,
  ]);

  if (isAuthLoading || isLoadingProcedure) {
    return (
      <main className="page-shell">
        <div className="page-inner trainer-shell">
          <div className="empty-state">
            <h1 className="trainer-title">Loading trainer</h1>
            <p className="review-subtle">
              Loading the procedure and trainer settings from the backend.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (!authUser || !procedure || !session || !currentStage || procedureError) {
    return (
      <main className="page-shell">
        <div className="page-inner trainer-shell">
          <div className="empty-state">
            <h1 className="trainer-title">Trainer unavailable</h1>
            <p className="review-subtle">
              {procedureError ??
                "We could not initialize the suturing trainer right now."}
            </p>
            <div
              className="review-actions"
              style={{ justifyContent: "center", marginTop: 18 }}
            >
              <Link className="button-primary" href="/">
                Back to Landing
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page-shell trainer-page-shell">
      <div className="page-inner trainer-shell">
        <header className="page-header">
          <div className="brand">
            <span className="brand-mark">AC</span>
            <span>{procedure.title}</span>
          </div>
          <div className="button-row">
            <span className="pill">Simulation-only</span>
            <span className="pill">{isOnline ? "Online" : "Offline"}</span>
            <span className="pill">
              {authUser.name} · {authUser.role}
            </span>
            <Link className="button-ghost" href="/">
              Home
            </Link>
            {authUser.role === "admin" ? (
              <Link className="button-ghost" href="/admin/reviews">
                Admin Queue
              </Link>
            ) : null}
            <button className="button-secondary" onClick={handleStartFreshSession}>
              Start Fresh Session
            </button>
            <button className="button-secondary" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </header>

        <section className="trainer-intro-strip">
          <div>
            <span className="eyebrow">Live practice</span>
            <h1 className="trainer-hero-title">
              Frame the field and check the current step.
            </h1>
          </div>
          <p className="body-copy">
            Keep the practice surface centered, capture one step at a time, and use the
            coaching panel to decide whether to retry, advance, or review the session.
          </p>
        </section>

        <section className="summary-grid">
          <article className="metric-card">
            <p className="metric-label">Current Stage</p>
            <p className="metric-value">{currentStage.title}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Attempts This Stage</p>
            <p className="metric-value">{currentStageAttempts}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Total Score</p>
            <p className="metric-value">{totalScore}</p>
          </article>
        </section>

        <div className="trainer-layout">
          <section>
            <article className="panel">
              <div className="panel-header">
                <div>
                  <span className="pill">Trainer camera</span>
                  <h1 className="trainer-title">{currentStage.title}</h1>
                  <p className="body-copy">{currentStage.objective}</p>
                </div>
                <div className="button-row">
                  <button
                    className="button-ghost"
                    onClick={handleToggleCalibrationMode}
                  >
                    {calibrationMode === "corners"
                      ? "Use Centered Guide"
                      : "Use Corner Calibration"}
                  </button>
                  <button
                    className="button-ghost"
                    disabled={!cameraReady}
                    onClick={handleShowCameraOverlay}
                    type="button"
                  >
                    Show Overlay for 10s
                  </button>
                </div>
              </div>

              <div className="camera-stage">
                <div className="camera-surface">
                  <CameraFeed
                    cheapPhoneMode={
                      equityMode.enabled && equityMode.cheapPhoneMode
                    }
                    ref={cameraRef}
                    frozenFrameUrl={isAnalyzing ? frozenFrameUrl : null}
                    lowBandwidthMode={
                      equityMode.enabled && equityMode.lowBandwidthMode
                    }
                    onMicrophoneIssue={setCoachError}
                    onReadyChange={handleCameraReadyChange}
                    primeMicrophoneOnStart={voiceChatEnabled}
                  />
                  {cameraReady && showCalibrationOverlay ? (
                    <CalibrationOverlay
                      mode={calibrationMode}
                      calibration={calibration}
                      disabled={!cameraReady}
                      onChange={handleCalibrationChange}
                    />
                  ) : null}
                  {cameraReady && showFeedbackOverlay ? (
                    <OverlayRenderer
                      mode={calibrationMode}
                      calibration={calibration}
                      targetIds={
                        feedbackStageId === currentStage.id
                          ? (feedback?.overlay_target_ids ?? [])
                          : []
                      }
                      targets={procedure.named_overlay_targets}
                    />
                  ) : null}
                </div>
              </div>
            </article>

            <article className="panel" style={{ marginTop: 20 }}>
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">Practice setup</h2>
                  <p className="panel-copy">
                    Adjust the learner profile, accessibility settings, and simulation
                    confirmation before you send a frame for analysis.
                  </p>
                </div>
              </div>

              <div className="inline-form-row">
                <label className="field-label">
                  Skill level
                  <select
                    value={skillLevel}
                    onChange={(event) =>
                      handleSkillLevelChange(event.target.value as SkillLevel)
                    }
                  >
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                  </select>
                </label>
                <label className="field-label">
                  Practice surface
                  <select value={procedure.practice_surface} disabled>
                    <option>{procedure.practice_surface}</option>
                  </select>
                </label>
              </div>

              <label className="safety-confirm-card" style={{ marginTop: 18 }}>
                <input
                  checked={equityMode.enabled}
                  onChange={(event) =>
                    handleEquityModeChange({
                      ...equityMode,
                      enabled: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                <div>
                  <strong>Equity mode</strong>
                  <p className="panel-copy">
                    Turn on access-focused settings for multilingual, lower-bandwidth,
                    and lower-cost-device practice.
                  </p>
                </div>
              </label>

              <div className="inline-form-row" style={{ marginTop: 18 }}>
                <label className="field-label">
                  Feedback language
                  <select
                    onChange={(event) =>
                      handleFeedbackLanguageChange(
                        event.target.value as EquityModeSettings["feedbackLanguage"],
                      )
                    }
                    value={equityMode.feedbackLanguage}
                  >
                    {FEEDBACK_LANGUAGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <article className="metric-card compact-metric-card">
                  <p className="metric-label">Access Profile</p>
                  <p className="metric-value">
                    {equityMode.enabled
                      ? getFeedbackLanguageLabel(equityMode.feedbackLanguage)
                      : "Standard"}
                  </p>
                  <p className="panel-copy" style={{ marginTop: 10 }}>
                    {equityMode.enabled
                      ? "Plain-language coaching tuned for lower-resource practice contexts."
                      : "Default camera, bandwidth, and review settings. Choose any option below to turn equity mode on."}
                  </p>
                </article>
              </div>

              <div className="equity-toggle-grid" style={{ marginTop: 18 }}>
                <label className="safety-confirm-card">
                  <input
                    checked={equityMode.audioCoaching}
                    onChange={(event) =>
                      handleEquityOptionChange("audioCoaching", event.target.checked)
                    }
                    type="checkbox"
                  />
                  <div>
                    <strong>Audio coaching</strong>
                    <p className="panel-copy">
                      Speak coach replies and live stage cues aloud so the learner can keep working hands-free.
                    </p>
                  </div>
                </label>

                <label className="safety-confirm-card">
                  <input
                    checked={equityMode.lowBandwidthMode}
                    onChange={(event) =>
                      handleEquityOptionChange("lowBandwidthMode", event.target.checked)
                    }
                    type="checkbox"
                  />
                  <div>
                    <strong>Low-bandwidth image mode</strong>
                    <p className="panel-copy">
                      Shrink capture resolution and JPEG quality to reduce upload weight.
                    </p>
                  </div>
                </label>

                <label className="safety-confirm-card">
                  <input
                    checked={equityMode.cheapPhoneMode}
                    onChange={(event) =>
                      handleEquityOptionChange("cheapPhoneMode", event.target.checked)
                    }
                    type="checkbox"
                  />
                  <div>
                    <strong>Cheap-phone compatibility</strong>
                    <p className="panel-copy">
                      Request a lighter camera profile that is friendlier to older devices.
                    </p>
                  </div>
                </label>

                <label className="safety-confirm-card">
                  <input
                    checked={equityMode.offlinePracticeLogging}
                    onChange={(event) =>
                      handleEquityOptionChange(
                        "offlinePracticeLogging",
                        event.target.checked,
                      )
                    }
                    type="checkbox"
                  />
                  <div>
                    <strong>Offline-first practice logging</strong>
                    <p className="panel-copy">
                      Save local practice attempts when the network is unavailable.
                    </p>
                  </div>
                </label>
              </div>

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

              <label className="safety-confirm-card" style={{ marginTop: 18 }}>
                <input
                  checked={simulationConfirmed}
                  onChange={(event) => setSimulationConfirmed(event.target.checked)}
                  type="checkbox"
                />
                <div>
                  <strong>Simulation-only confirmation</strong>
                  <p className="panel-copy">
                    I confirm this image shows a practice surface such as an orange,
                    banana, foam pad, or bench model, not a real patient or clinical
                    scene.
                  </p>
                </div>
              </label>

              <div className="trainer-control-row" style={{ marginTop: 18 }}>
                <button
                  className="button-primary"
                  disabled={!cameraReady || isAnalyzing || !simulationConfirmed}
                  onClick={() => void handleAnalyzeStep()}
                >
                  {isAnalyzing ? "Analyzing Step..." : "Check My Step"}
                </button>
                <button
                  className="button-secondary"
                  disabled={!canAdvance}
                  onClick={handleAdvance}
                >
                  Advance to Next Stage
                </button>
                <button
                  className="button-secondary"
                  disabled={!canFinishReview}
                  onClick={handleOpenReview}
                >
                  Open Review
                </button>
              </div>

              <p className="fine-print" style={{ marginTop: 16 }}>
                Camera overlays now auto-hide after 10 seconds. Use{" "}
                <em>Show Overlay for 10s</em> whenever you want to see calibration or
                feedback targets again. Equity settings are saved with the session and
                carried into review.
              </p>
            </article>
          </section>

          <section>
            <ProcedureStepper
              canAdvance={canAdvance}
              currentStageId={currentStage.id}
              events={session.events}
              onAdvance={handleAdvance}
              onSelectStage={setCurrentStageId}
              stages={procedure.stages}
            />

            <div style={{ marginTop: 20 }}>
              <FeedbackCard
                attemptCount={currentStageAttempts}
                audioEnabled={equityMode.enabled && equityMode.audioCoaching}
                coachVoice={equityMode.coachVoice}
                error={analyzeError}
                feedbackLanguage={equityMode.feedbackLanguage}
                isAnalyzing={isAnalyzing}
                response={feedbackStageId === currentStage.id ? feedback : null}
                stageTitle={currentStage.title}
              />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { CameraFeed, type CameraFeedHandle } from "@/components/CameraFeed";
import { CalibrationOverlay } from "@/components/CalibrationOverlay";
import { FeedbackCard } from "@/components/FeedbackCard";
import { OverlayRenderer } from "@/components/OverlayRenderer";
import { ProcedureStepper } from "@/components/ProcedureStepper";
import { analyzeFrame, getProcedure } from "@/lib/api";
import { createDefaultCalibration } from "@/lib/geometry";
import {
  getOrCreateActiveSession,
  saveSession,
  startFreshSession,
} from "@/lib/storage";
import type {
  AnalyzeFrameResponse,
  Calibration,
  CalibrationMode,
  ProcedureDefinition,
  SessionEvent,
  SessionRecord,
  SkillLevel,
} from "@/lib/types";

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
  const [procedure, setProcedure] = useState<ProcedureDefinition | null>(null);
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [currentStageId, setCurrentStageId] = useState("");
  const [skillLevel, setSkillLevel] = useState<SkillLevel>("beginner");
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
  const [frozenFrameUrl, setFrozenFrameUrl] = useState<string | null>(null);
  const [studentQuestion, setStudentQuestion] = useState("");

  useEffect(() => {
    const activeProcedureId = procedureId;

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

        const activeSession = getOrCreateActiveSession(nextProcedure.id, "beginner");
        setProcedure(nextProcedure);
        setSession(activeSession);
        setSkillLevel(activeSession.skillLevel);
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
  }, [procedureId]);

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
    Boolean(procedure && findNextStageId(procedure, currentStageId));

  const canFinishReview =
    feedbackStageId === currentStageId &&
    feedback?.step_status === "pass" &&
    procedure &&
    !findNextStageId(procedure, currentStageId);

  function persistSession(nextSession: SessionRecord) {
    saveSession(nextSession);
    setSession(nextSession);
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

    const freshSession = startFreshSession(procedure.id, skillLevel);
    setSession(freshSession);
    setCalibration(freshSession.calibration);
    setCurrentStageId(procedure.stages[0]?.id ?? "");
    setFeedback(null);
    setFeedbackStageId(null);
    setFrozenFrameUrl(null);
    setStudentQuestion("");
    setAnalyzeError(null);
  }

  async function handleAnalyzeStep() {
    if (!procedure || !currentStage || !session) {
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
    setIsAnalyzing(true);

    try {
      const response = await analyzeFrame({
        procedure_id: procedure.id,
        stage_id: currentStage.id,
        skill_level: skillLevel,
        image_base64: capturedFrame.base64,
        student_question: studentQuestion.trim() || undefined,
      });

      const attempt =
        session.events.filter((event) => event.stageId === currentStage.id).length + 1;
      const event: SessionEvent = {
        stageId: currentStage.id,
        attempt,
        stepStatus: response.step_status,
        issues: response.issues,
        scoreDelta: response.score_delta,
        coachingMessage: response.coaching_message,
        overlayTargetIds: response.overlay_target_ids,
        visibleObservations: response.visible_observations,
        nextAction: response.next_action,
        confidence: response.confidence,
        createdAt: new Date().toISOString(),
      };

      persistSession({
        ...session,
        skillLevel,
        calibration,
        debrief: undefined,
        events: [...session.events, event],
        updatedAt: new Date().toISOString(),
      });

      setFeedback(response);
      setFeedbackStageId(currentStage.id);
    } catch (error) {
      setAnalyzeError(
        error instanceof Error ? error.message : "The AI analysis request failed.",
      );
    } finally {
      setIsAnalyzing(false);
    }
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

  if (isLoadingProcedure) {
    return (
      <main className="page-shell">
        <div className="page-inner trainer-shell">
          <div className="empty-state">
            <h1 className="trainer-title">Loading trainer</h1>
            <p className="review-subtle">
              Fetching the suturing procedure metadata from the FastAPI service.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (!procedure || !session || !currentStage || procedureError) {
    return (
      <main className="page-shell">
        <div className="page-inner trainer-shell">
          <div className="empty-state">
            <h1 className="trainer-title">Trainer unavailable</h1>
            <p className="review-subtle">
              {procedureError ??
                "We could not initialize the simple interrupted suturing flow."}
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
    <main className="page-shell">
      <div className="page-inner trainer-shell">
        <header className="page-header">
          <div className="brand">
            <span className="brand-mark">AC</span>
            <span>{procedure.title}</span>
          </div>
          <div className="button-row">
            <span className="pill">Simulation-only</span>
            <Link className="button-ghost" href="/">
              Landing
            </Link>
            <button className="button-secondary" onClick={handleStartFreshSession}>
              Start Fresh Session
            </button>
          </div>
        </header>

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
                    onClick={() =>
                      setCalibrationMode((current) =>
                        current === "corners" ? "guide" : "corners",
                      )
                    }
                  >
                    {calibrationMode === "corners"
                      ? "Use Centered Guide"
                      : "Use Corner Calibration"}
                  </button>
                </div>
              </div>

              <div className="camera-stage">
                <div className="camera-surface">
                  <CameraFeed
                    ref={cameraRef}
                    frozenFrameUrl={isAnalyzing ? frozenFrameUrl : null}
                    onReadyChange={setCameraReady}
                  />
                  <CalibrationOverlay
                    mode={calibrationMode}
                    calibration={calibration}
                    disabled={!cameraReady}
                    onChange={handleCalibrationChange}
                  />
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
                </div>
              </div>
            </article>

            <article className="panel" style={{ marginTop: 20 }}>
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">Stage controls</h2>
                  <p className="panel-copy">
                    Phase 3 keeps the capture flow stable, the scoring deterministic, and
                    the overlay targets aligned with the backend rubric while the configured
                    model server handles the stage coaching.
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

              <label className="field-label" style={{ marginTop: 14 }}>
                Optional student question
                <textarea
                  value={studentQuestion}
                  onChange={(event) => setStudentQuestion(event.target.value)}
                  placeholder="Example: Am I holding the needle too close to the tip?"
                />
              </label>

              <div className="trainer-control-row" style={{ marginTop: 18 }}>
                <button
                  className="button-primary"
                  disabled={!cameraReady || isAnalyzing}
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
                If four-corner calibration feels unstable, switch to the centered guide. The
                overlay renderer and AI coaching flow work in both modes.
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
                error={analyzeError}
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

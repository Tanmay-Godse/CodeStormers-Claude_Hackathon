"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ReviewSummary } from "@/components/ReviewSummary";
import { toApiEquityMode } from "@/lib/equity";
import {
  buildLearnerProfileSnapshot,
  buildLocalAdaptiveDrill,
  inferEventGraded,
} from "@/lib/learnerProfile";
import { generateDebrief, getProcedure, listReviewCases } from "@/lib/api";
import {
  buildSessionReviewSignature,
  clearAuthUser,
  getAuthUser,
  getCachedDebrief,
  getSession,
  listSessionsForOwnerProcedure,
  saveSessionDebrief,
} from "@/lib/storage";
import type {
  AdaptiveDrill,
  AuthUser,
  DebriefRequest,
  DebriefResponse,
  LearnerProfileSnapshot,
  ProcedureDefinition,
  ReviewCase,
  SessionRecord,
} from "@/lib/types";

const pendingDebriefRequests = new Map<string, Promise<DebriefResponse>>();

function buildDebriefPayload(
  session: SessionRecord,
  learnerProfile: LearnerProfileSnapshot | null,
): DebriefRequest {
  return {
    session_id: session.id,
    procedure_id: session.procedureId,
    skill_level: session.skillLevel,
    feedback_language: session.equityMode.feedbackLanguage,
    equity_mode: toApiEquityMode(session.equityMode),
    learner_profile: learnerProfile ?? undefined,
    events: session.events.map((event) => ({
      stage_id: event.stageId,
      attempt: event.attempt,
      step_status: event.stepStatus,
      analysis_mode: event.analysisMode ?? "coaching",
      graded: inferEventGraded(event),
      grading_reason: event.gradingReason,
      issues: event.issues,
      score_delta: event.scoreDelta,
      coaching_message: event.coachingMessage,
      overlay_target_ids: event.overlayTargetIds,
      visible_observations: event.visibleObservations ?? [],
      next_action: event.nextAction,
      confidence: event.confidence,
      created_at: event.createdAt,
    })),
  };
}

function getDebriefRequestKey(
  session: SessionRecord,
  learnerProfile: LearnerProfileSnapshot | null,
): string {
  return `${session.id}:${buildSessionReviewSignature(session, learnerProfile)}`;
}

function requestSessionDebrief(
  session: SessionRecord,
  learnerProfile: LearnerProfileSnapshot | null,
): Promise<DebriefResponse> {
  const requestKey = getDebriefRequestKey(session, learnerProfile);
  const existingRequest = pendingDebriefRequests.get(requestKey);

  if (existingRequest) {
    return existingRequest;
  }

  const nextRequest = generateDebrief(
    buildDebriefPayload(session, learnerProfile),
  ).finally(() => {
    pendingDebriefRequests.delete(requestKey);
  });

  pendingDebriefRequests.set(requestKey, nextRequest);
  return nextRequest;
}

export default function ReviewPage() {
  const params = useParams();
  const router = useRouter();
  const sessionParam = params.sessionId;
  const sessionId =
    typeof sessionParam === "string" ? sessionParam : sessionParam?.[0];

  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [reviewCases, setReviewCases] = useState<ReviewCase[]>([]);
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [procedure, setProcedure] = useState<ProcedureDefinition | null>(null);
  const [learnerProfile, setLearnerProfile] = useState<LearnerProfileSnapshot | null>(
    null,
  );
  const [localAdaptiveDrill, setLocalAdaptiveDrill] = useState<AdaptiveDrill | null>(
    null,
  );
  const [debrief, setDebrief] = useState<DebriefResponse | null>(null);
  const [debriefError, setDebriefError] = useState<string | null>(null);
  const [isDebriefLoading, setIsDebriefLoading] = useState(false);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);

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
      const nextPath = sessionId ? `/review/${sessionId}` : "/review";
      router.replace(`/login?role=student&next=${encodeURIComponent(nextPath)}`);
      return;
    }

    setAuthUser(nextUser);
  }, [router, sessionId]);

  useEffect(() => {
    if (!authUser) {
      return;
    }

    if (!sessionId) {
      setSession(null);
      setDebrief(null);
      setDebriefError(null);
      setIsDebriefLoading(false);
      setIsSessionLoading(false);
      return;
    }

    const existingSession = getSession(sessionId);
    setSession(existingSession);
    setDebrief(existingSession ? getCachedDebrief(existingSession, null) : null);
    setDebriefError(null);
    setIsDebriefLoading(false);
    setIsSessionLoading(false);
  }, [authUser, sessionId]);

  useEffect(() => {
    if (!authUser || !session) {
      setLearnerProfile(null);
      setLocalAdaptiveDrill(null);
      return;
    }

    const relatedSessions = listSessionsForOwnerProcedure(
      authUser.username,
      session.procedureId,
    );
    const sessionsForProfile = relatedSessions.some(
      (item) => item.id === session.id,
    )
      ? relatedSessions
      : [...relatedSessions, session];
    const nextProfile = buildLearnerProfileSnapshot(
      sessionsForProfile,
      session.equityMode.feedbackLanguage,
    );

    setLearnerProfile(nextProfile);
    setLocalAdaptiveDrill(
      buildLocalAdaptiveDrill(nextProfile, session.equityMode.feedbackLanguage),
    );
  }, [authUser, session]);

  useEffect(() => {
    const procedureId = session?.procedureId;

    if (!procedureId) {
      setProcedure(null);
      return;
    }

    const procedureIdSnapshot = procedureId;

    let cancelled = false;

    async function loadProcedure() {
      try {
        const procedureResponse = await getProcedure(procedureIdSnapshot);
        if (!cancelled) {
          setProcedure(procedureResponse);
        }
      } catch {
        if (!cancelled) {
          setProcedure(null);
        }
      }
    }

    void loadProcedure();

    return () => {
      cancelled = true;
    };
  }, [session?.procedureId]);

  useEffect(() => {
    if (!session) {
      setReviewCases([]);
      setDebrief(null);
      setDebriefError(null);
      setIsDebriefLoading(false);
      return;
    }

    const sessionSnapshot = session;

    const cachedDebrief = getCachedDebrief(sessionSnapshot, learnerProfile);
    if (cachedDebrief) {
      setDebrief(cachedDebrief);
      setDebriefError(null);
      setIsDebriefLoading(false);
      return;
    }

    if (sessionSnapshot.events.length === 0) {
      setDebrief(null);
      setDebriefError(null);
      setIsDebriefLoading(false);
      return;
    }

    if (
      !isOnline &&
      sessionSnapshot.equityMode.enabled &&
      sessionSnapshot.equityMode.offlinePracticeLogging
    ) {
      setDebrief(null);
      setDebriefError(
        "Offline mode is active. Your practice history is still saved locally, and the AI debrief will retry once the device reconnects.",
      );
      setIsDebriefLoading(false);
      return;
    }

    let cancelled = false;

    async function hydrateDebrief() {
      setDebrief(null);
      setDebriefError(null);
      setIsDebriefLoading(true);

      try {
        const debriefResponse = await requestSessionDebrief(
          sessionSnapshot,
          learnerProfile,
        );

        if (cancelled) {
          return;
        }

        setDebrief(debriefResponse);

        const updatedSession = saveSessionDebrief(
          sessionSnapshot.id,
          debriefResponse,
          learnerProfile,
        );
        if (updatedSession) {
          setSession(updatedSession);
        }
      } catch (error) {
        if (!cancelled) {
          setDebriefError(
            error instanceof Error
              ? error.message
              : "The session debrief request failed.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsDebriefLoading(false);
        }
      }
    }

    void hydrateDebrief();

    return () => {
      cancelled = true;
    };
  }, [isOnline, learnerProfile, session]);

  useEffect(() => {
    if (!session) {
      setReviewCases([]);
      return;
    }

    const sessionSnapshot = session;
    let cancelled = false;

    async function loadReviewCases() {
      try {
        const response = await listReviewCases({ sessionId: sessionSnapshot.id });
        if (!cancelled) {
          setReviewCases(response);
        }
      } catch {
        if (!cancelled) {
          setReviewCases([]);
        }
      }
    }

    void loadReviewCases();

    return () => {
      cancelled = true;
    };
  }, [session]);

  function handleLogout() {
    clearAuthUser();
    router.push("/login");
  }

  if (!authUser || isSessionLoading) {
    return (
      <main className="page-shell">
        <div className="page-inner review-shell">
          <div className="empty-state">
            <h1 className="review-title">Loading review</h1>
            <p className="review-subtle">
              Loading the saved training session from browser storage.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="page-shell">
        <div className="page-inner review-shell">
          <div className="empty-state">
            <h1 className="review-title">No local session found</h1>
            <p className="review-subtle">
              Start a training session first so the review page has recorded attempts to load.
            </p>
            <div
              className="review-actions"
              style={{ justifyContent: "center", marginTop: 18 }}
            >
              <Link className="button-primary" href="/train/simple-interrupted-suture">
                Return to Trainer
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page-shell review-page-shell">
      <div className="page-inner review-shell">
        <header className="page-header">
          <div className="brand">
            <span className="brand-mark">AC</span>
            <span>Session Review</span>
          </div>
          <div className="button-row">
            <span className="pill">Phase 3 session review</span>
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
            <Link className="button-secondary" href={`/train/${session.procedureId}`}>
              Back to Trainer
            </Link>
            <button className="button-secondary" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </header>

        <section className="trainer-intro-strip review-intro-strip">
          <div>
            <span className="eyebrow">Session review</span>
            <h1 className="trainer-hero-title">
              Review what happened and plan the next reps.
            </h1>
          </div>
          <p className="body-copy">
            Keep the attempt timeline, AI summary, and drill plan in one place so you can
            quickly decide what to repeat in the next practice block.
          </p>
        </section>

        <ReviewSummary
          adaptiveDrill={debrief?.adaptive_drill ?? localAdaptiveDrill}
          debrief={debrief}
          debriefError={debriefError}
          isDebriefLoading={isDebriefLoading}
          isOnline={isOnline}
          learnerProfile={learnerProfile}
          procedure={procedure}
          reviewCases={reviewCases}
          session={session}
        />
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ReviewSummary } from "@/components/ReviewSummary";
import { toApiEquityMode } from "@/lib/equity";
import { generateDebrief, getProcedure, listReviewCases } from "@/lib/api";
import {
  buildSessionReviewSignature,
  clearAuthUser,
  getAuthUser,
  getCachedDebrief,
  getSession,
  saveSessionDebrief,
} from "@/lib/storage";
import type {
  AuthUser,
  DebriefRequest,
  DebriefResponse,
  ProcedureDefinition,
  ReviewCase,
  SessionRecord,
} from "@/lib/types";

const pendingDebriefRequests = new Map<string, Promise<DebriefResponse>>();

function buildDebriefPayload(session: SessionRecord): DebriefRequest {
  return {
    session_id: session.id,
    procedure_id: session.procedureId,
    skill_level: session.skillLevel,
    feedback_language: session.equityMode.feedbackLanguage,
    equity_mode: toApiEquityMode(session.equityMode),
    events: session.events.map((event) => ({
      stage_id: event.stageId,
      attempt: event.attempt,
      step_status: event.stepStatus,
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

function getDebriefRequestKey(session: SessionRecord): string {
  return `${session.id}:${buildSessionReviewSignature(session)}`;
}

function requestSessionDebrief(session: SessionRecord): Promise<DebriefResponse> {
  const requestKey = getDebriefRequestKey(session);
  const existingRequest = pendingDebriefRequests.get(requestKey);

  if (existingRequest) {
    return existingRequest;
  }

  const nextRequest = generateDebrief(buildDebriefPayload(session)).finally(() => {
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
    setDebrief(existingSession ? getCachedDebrief(existingSession) : null);
    setDebriefError(null);
    setIsDebriefLoading(false);
    setIsSessionLoading(false);
  }, [authUser, sessionId]);

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

    const cachedDebrief = getCachedDebrief(sessionSnapshot);
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
        const debriefResponse = await requestSessionDebrief(sessionSnapshot);

        if (cancelled) {
          return;
        }

        setDebrief(debriefResponse);

        const updatedSession = saveSessionDebrief(
          sessionSnapshot.id,
          debriefResponse,
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
  }, [isOnline, session]);

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
              Reconstructing the local training session from browser storage.
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
              This review page depends on the browser session record created during
              training.
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
              Landing
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
            <span className="eyebrow">Session archive</span>
            <h1 className="trainer-hero-title">Turn one practice run into a usable study record.</h1>
          </div>
          <p className="body-copy">
            The review view keeps the attempt timeline, AI debrief, and quiz in one place
            so the session feels more like a reusable notebook than a disposable result page.
          </p>
        </section>

        <ReviewSummary
          debrief={debrief}
          debriefError={debriefError}
          isDebriefLoading={isDebriefLoading}
          isOnline={isOnline}
          procedure={procedure}
          reviewCases={reviewCases}
          session={session}
        />
      </div>
    </main>
  );
}

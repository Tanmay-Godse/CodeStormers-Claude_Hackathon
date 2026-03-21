"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ReviewSummary } from "@/components/ReviewSummary";
import { generateDebrief, getProcedure } from "@/lib/api";
import {
  buildSessionReviewSignature,
  getCachedDebrief,
  getSession,
  saveSessionDebrief,
} from "@/lib/storage";
import type {
  DebriefRequest,
  DebriefResponse,
  ProcedureDefinition,
  SessionRecord,
} from "@/lib/types";

const pendingDebriefRequests = new Map<string, Promise<DebriefResponse>>();

function buildDebriefPayload(session: SessionRecord): DebriefRequest {
  return {
    session_id: session.id,
    procedure_id: session.procedureId,
    skill_level: session.skillLevel,
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
  const sessionParam = params.sessionId;
  const sessionId =
    typeof sessionParam === "string" ? sessionParam : sessionParam?.[0];

  const [session, setSession] = useState<SessionRecord | null>(null);
  const [procedure, setProcedure] = useState<ProcedureDefinition | null>(null);
  const [debrief, setDebrief] = useState<DebriefResponse | null>(null);
  const [debriefError, setDebriefError] = useState<string | null>(null);
  const [isDebriefLoading, setIsDebriefLoading] = useState(false);
  const [isSessionLoading, setIsSessionLoading] = useState(true);

  useEffect(() => {
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
  }, [sessionId]);

  useEffect(() => {
    const procedureId = session?.procedureId;

    if (!procedureId) {
      setProcedure(null);
      return;
    }

    let cancelled = false;

    async function loadProcedure() {
      try {
        const procedureResponse = await getProcedure(procedureId);
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
      setDebrief(null);
      setDebriefError(null);
      setIsDebriefLoading(false);
      return;
    }

    const cachedDebrief = getCachedDebrief(session);
    if (cachedDebrief) {
      setDebrief(cachedDebrief);
      setDebriefError(null);
      setIsDebriefLoading(false);
      return;
    }

    if (session.events.length === 0) {
      setDebrief(null);
      setDebriefError(null);
      setIsDebriefLoading(false);
      return;
    }

    let cancelled = false;

    async function hydrateDebrief() {
      setDebrief(null);
      setDebriefError(null);
      setIsDebriefLoading(true);

      try {
        const debriefResponse = await requestSessionDebrief(session);

        if (cancelled) {
          return;
        }

        setDebrief(debriefResponse);

        const updatedSession = saveSessionDebrief(session.id, debriefResponse);
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
  }, [session]);

  if (isSessionLoading) {
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
    <main className="page-shell">
      <div className="page-inner review-shell">
        <header className="page-header">
          <div className="brand">
            <span className="brand-mark">AC</span>
            <span>Session Review</span>
          </div>
          <div className="button-row">
            <span className="pill">Phase 3 session review</span>
            <Link className="button-ghost" href="/">
              Landing
            </Link>
            <Link className="button-secondary" href={`/train/${session.procedureId}`}>
              Back to Trainer
            </Link>
          </div>
        </header>

        <ReviewSummary
          debrief={debrief}
          debriefError={debriefError}
          isDebriefLoading={isDebriefLoading}
          procedure={procedure}
          session={session}
        />
      </div>
    </main>
  );
}

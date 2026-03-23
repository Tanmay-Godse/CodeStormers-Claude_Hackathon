"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppFrame } from "@/components/AppFrame";
import { ReviewSummary } from "@/components/ReviewSummary";
import {
  buildSharedSidebarItems,
  buildSharedTopItems,
  DEFAULT_TRAINING_HREF,
} from "@/lib/appShell";
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
  syncLearningStateFromBackend,
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

    const authUsername = authUser.username;
    let cancelled = false;

    async function hydrateSession() {
      if (!sessionId) {
        setSession(null);
        setDebrief(null);
        setDebriefError(null);
        setIsDebriefLoading(false);
        setIsSessionLoading(false);
        return;
      }

      setIsSessionLoading(true);

      try {
        await syncLearningStateFromBackend();
      } catch {
        // Fall back to the local cache if the learning-state hydrate fails.
      }

      if (cancelled) {
        return;
      }

      const existingSession = getSession(sessionId);
      const ownedSession =
        existingSession?.ownerUsername === authUsername
          ? existingSession
          : null;
      setSession(ownedSession);
      setDebrief(ownedSession ? getCachedDebrief(ownedSession, null) : null);
      setDebriefError(null);
      setIsDebriefLoading(false);
      setIsSessionLoading(false);
    }

    void hydrateSession();

    return () => {
      cancelled = true;
    };
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

    if (!isOnline && sessionSnapshot.equityMode.offlinePracticeLogging) {
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

  const reviewHref = session ? `/review/${session.id}` : DEFAULT_TRAINING_HREF;
  const sharedSidebarItems = buildSharedSidebarItems({
    active: "review",
    isDeveloper: authUser?.isDeveloper === true,
    reviewHref,
    userRole: authUser?.role ?? null,
  });
  const sharedTopItems = buildSharedTopItems({
    isDeveloper: authUser?.isDeveloper === true,
    reviewHref,
    userRole: authUser?.role ?? null,
  });

  if (!authUser || isSessionLoading) {
    return (
      <AppFrame
        brandSubtitle="Deliberate review workflow"
        pageTitle="Session Review"
        sidebarItems={sharedSidebarItems}
        statusPill={{ icon: "review", label: "loading session" }}
        topItems={sharedTopItems}
        userName={authUser?.name ?? null}
      >
        <section className="dashboard-card dashboard-frame-panel">
          <span className="dashboard-card-eyebrow">Preparing Review</span>
          <h2>Loading the saved training session.</h2>
          <p>Loading the attempts, review trail, and latest debrief.</p>
        </section>
      </AppFrame>
    );
  }

  if (!session) {
    return (
      <AppFrame
        brandSubtitle="Deliberate review workflow"
        footerPrimaryAction={{
          href: DEFAULT_TRAINING_HREF,
          icon: "play",
          label: "Start New Session",
          strong: true,
        }}
        footerSecondaryActions={[{ href: "/dashboard", icon: "dashboard", label: "Dashboard" }]}
        pageTitle="Session Review"
        sidebarItems={sharedSidebarItems}
        statusPill={{ icon: "review", label: "no saved session" }}
        topActions={[{ href: DEFAULT_TRAINING_HREF, label: "Open Trainer", strong: true }]}
        topItems={sharedTopItems}
        userName={authUser.name}
      >
        <section className="dashboard-card dashboard-frame-panel">
          <span className="dashboard-card-eyebrow">No Local Review Found</span>
          <h2>There is no saved session attached to this review link.</h2>
          <p>Start a training session first so there is something to review.</p>
          <div className="dashboard-frame-actions">
            <Link className="dashboard-primary-button" href={DEFAULT_TRAINING_HREF}>
              Start training
            </Link>
            <Link className="dashboard-action-pill" href="/dashboard">
              Back to dashboard
            </Link>
          </div>
        </section>
      </AppFrame>
    );
  }

  return (
    <AppFrame
      brandSubtitle="Deliberate review workflow"
      footerPrimaryAction={{
        href: DEFAULT_TRAINING_HREF,
        icon: "play",
        label: "Start New Session",
        strong: true,
      }}
      footerSecondaryActions={[
        { href: "/dashboard", icon: "dashboard", label: "Dashboard" },
        { icon: "logout", label: "Logout", onClick: handleLogout },
      ]}
      pageTitle="Session Review"
      sidebarItems={sharedSidebarItems}
      topActions={[
        ...(authUser.role === "admin"
          ? [{ href: "/admin/reviews", label: "Admin Queue" }]
          : []),
        { href: `/train/${session.procedureId}`, label: "Back to Trainer", strong: true },
      ]}
      topItems={sharedTopItems}
      userName={authUser.name}
    >
      <section className="dashboard-card review-shell-banner">
        <div className="review-shell-banner-copy">
          <div>
            <span className="dashboard-card-eyebrow">Session Review</span>
            <h2 className="review-shell-banner-title">Review the attempt and pick the next rep.</h2>
          </div>
          <p className="review-shell-banner-text">
            Keep the timeline, AI summary, and drill plan in one place.
          </p>
        </div>
        <div className="review-shell-banner-meta">
          <span className="dashboard-meta-chip">{session.procedureId.replaceAll("-", " ")}</span>
          <span className="dashboard-meta-chip">{session.skillLevel}</span>
          <span className="dashboard-meta-chip">
            {authUser.name} · {authUser.role}
          </span>
        </div>
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
    </AppFrame>
  );
}

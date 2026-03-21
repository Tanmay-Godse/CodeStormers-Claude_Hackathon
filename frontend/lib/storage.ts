import { createDefaultCalibration } from "@/lib/geometry";
import type { DebriefResponse, SessionRecord, SkillLevel } from "@/lib/types";

const SESSIONS_KEY = "ai-clinical-skills-coach:sessions";

function activeSessionKey(procedureId: string) {
  return `ai-clinical-skills-coach:active:${procedureId}`;
}

function readSessions(): Record<string, SessionRecord> {
  if (typeof window === "undefined") {
    return {};
  }

  const raw = window.localStorage.getItem(SESSIONS_KEY);

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as Record<string, SessionRecord>;
  } catch {
    return {};
  }
}

function writeSessions(sessions: Record<string, SessionRecord>) {
  window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

export function saveSession(session: SessionRecord): SessionRecord {
  const sessions = readSessions();
  sessions[session.id] = session;
  writeSessions(sessions);
  window.localStorage.setItem(activeSessionKey(session.procedureId), session.id);
  return session;
}

export function getSession(sessionId: string): SessionRecord | null {
  return readSessions()[sessionId] ?? null;
}

export function buildSessionReviewSignature(session: SessionRecord): string {
  return JSON.stringify({
    events: session.events,
    skillLevel: session.skillLevel,
  });
}

export function getCachedDebrief(session: SessionRecord): DebriefResponse | null {
  if (!session.debrief) {
    return null;
  }

  return session.debrief.reviewSignature === buildSessionReviewSignature(session)
    ? session.debrief.response
    : null;
}

export function saveSessionDebrief(
  sessionId: string,
  response: DebriefResponse,
): SessionRecord | null {
  const session = getSession(sessionId);

  if (!session) {
    return null;
  }

  return saveSession({
    ...session,
    debrief: {
      response,
      reviewSignature: buildSessionReviewSignature(session),
      generatedAt: new Date().toISOString(),
    },
  });
}

export function createSession(
  procedureId: string,
  skillLevel: SkillLevel,
): SessionRecord {
  const timestamp = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    procedureId,
    skillLevel,
    calibration: createDefaultCalibration(),
    events: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function startFreshSession(
  procedureId: string,
  skillLevel: SkillLevel,
): SessionRecord {
  const session = createSession(procedureId, skillLevel);
  return saveSession(session);
}

export function getOrCreateActiveSession(
  procedureId: string,
  skillLevel: SkillLevel,
): SessionRecord {
  const activeId = window.localStorage.getItem(activeSessionKey(procedureId));

  if (activeId) {
    const existing = getSession(activeId);
    if (existing) {
      return existing;
    }
  }

  return startFreshSession(procedureId, skillLevel);
}

import { createDefaultCalibration } from "@/lib/geometry";
import {
  createPersistedAuthAccount,
  previewPersistedAuthAccount,
  signInPersistedAuthAccount,
  type PersistedAuthAccount,
} from "@/lib/api";
import type {
  AuthUser,
  CreateAuthAccountInput,
  DebriefResponse,
  EquityModeSettings,
  LearnerProfileSnapshot,
  LoginAuthInput,
  OfflinePracticeLog,
  SessionRecord,
  SkillLevel,
} from "@/lib/types";

const SESSIONS_KEY = "ai-clinical-skills-coach:sessions";
const AUTH_USER_KEY = "ai-clinical-skills-coach:auth-user";

function activeSessionKey(procedureId: string) {
  return `ai-clinical-skills-coach:active:${procedureId}`;
}

export function createDefaultEquityMode(): EquityModeSettings {
  return {
    enabled: false,
    feedbackLanguage: "en",
    audioCoaching: false,
    coachVoice: "guide_male",
    lowBandwidthMode: false,
    cheapPhoneMode: false,
    offlinePracticeLogging: true,
  };
}

function ensureBrowserStorage() {
  if (typeof window === "undefined") {
    throw new Error("Authentication is available only in the browser.");
  }
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
    const parsed = JSON.parse(raw) as Record<string, Partial<SessionRecord>>;
    const normalized: Record<string, SessionRecord> = {};

    for (const [sessionId, session] of Object.entries(parsed)) {
      const nextSession = normalizeSessionRecord(sessionId, session);
      if (nextSession) {
        normalized[sessionId] = nextSession;
      }
    }

    return normalized;
  } catch {
    return {};
  }
}

function writeSessions(sessions: Record<string, SessionRecord>) {
  window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function normalizeSessionRecord(
  sessionId: string,
  session: Partial<SessionRecord>,
): SessionRecord | null {
  if (
    typeof session?.procedureId !== "string" ||
    typeof session?.skillLevel !== "string" ||
    !Array.isArray(session?.events) ||
    typeof session?.createdAt !== "string" ||
    typeof session?.updatedAt !== "string"
  ) {
    return null;
  }

  const equityMode = session.equityMode
    ? {
        ...createDefaultEquityMode(),
        ...session.equityMode,
      }
    : createDefaultEquityMode();

  return {
    id: session.id ?? sessionId,
    procedureId: session.procedureId,
    ownerUsername:
      typeof session.ownerUsername === "string" ? session.ownerUsername : undefined,
    skillLevel: session.skillLevel,
    calibration: session.calibration ?? createDefaultCalibration(),
    equityMode,
    events: session.events,
    offlinePracticeLogs: Array.isArray(session.offlinePracticeLogs)
      ? (session.offlinePracticeLogs as OfflinePracticeLog[])
      : [],
    debrief: session.debrief,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function validateUsername(username: string): string {
  const normalized = normalizeUsername(username);
  if (normalized.length < 3) {
    throw new Error("Username must be at least 3 characters.");
  }
  if (!/^[a-z0-9._@-]+$/.test(normalized)) {
    throw new Error(
      "Username can use letters, numbers, periods, underscores, hyphens, and @.",
    );
  }
  return normalized;
}

function validatePassword(password: string): string {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  return password;
}

function toAuthUser(account: PersistedAuthAccount): AuthUser {
  return {
    id: crypto.randomUUID(),
    accountId: account.id,
    name: account.name,
    username: account.username,
    role: account.role,
    createdAt: new Date().toISOString(),
  };
}

function persistAuthUser(user: AuthUser): AuthUser {
  window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  return user;
}

function isValidDebriefResponse(response: Partial<DebriefResponse>): response is DebriefResponse {
  return (
    typeof response.feedback_language === "string" &&
    typeof response.graded_attempt_count === "number" &&
    typeof response.not_graded_attempt_count === "number" &&
    Array.isArray(response.error_fingerprint) &&
    typeof response.adaptive_drill === "object" &&
    response.adaptive_drill !== null &&
    Array.isArray(response.strengths) &&
    Array.isArray(response.improvement_areas) &&
    Array.isArray(response.practice_plan) &&
    Array.isArray(response.equity_support_plan) &&
    typeof response.audio_script === "string" &&
    Array.isArray(response.quiz)
  );
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

export function listSessions(): SessionRecord[] {
  return Object.values(readSessions()).sort((left, right) =>
    left.createdAt < right.createdAt ? 1 : -1,
  );
}

export function listSessionsForOwnerProcedure(
  ownerUsername: string,
  procedureId: string,
): SessionRecord[] {
  return listSessions().filter(
    (session) =>
      session.procedureId === procedureId && session.ownerUsername === ownerUsername,
  );
}

export async function createAuthAccount(
  input: CreateAuthAccountInput,
): Promise<AuthUser> {
  ensureBrowserStorage();

  const name = input.name.trim();
  if (!name) {
    throw new Error("Display name is required.");
  }

  const username = validateUsername(input.username);
  const password = validatePassword(input.password);
  const account = await createPersistedAuthAccount({
    name,
    username,
    password,
    role: input.role,
  });
  return persistAuthUser(toAuthUser(account));
}

export async function signInAuthUser(input: LoginAuthInput): Promise<AuthUser> {
  ensureBrowserStorage();

  const identifier = input.username.trim();
  if (identifier.length < 3) {
    throw new Error("Enter the username or display name for this workspace account.");
  }

  const password = validatePassword(input.password);
  const account = await signInPersistedAuthAccount({
    identifier,
    password,
    role: input.role,
  });
  return persistAuthUser(toAuthUser(account));
}

export async function previewAuthAccount(
  identifier: string,
): Promise<{ name: string; role: AuthUser["role"]; username: string } | null> {
  ensureBrowserStorage();

  const trimmedIdentifier = identifier.trim();
  if (trimmedIdentifier.length < 3) {
    throw new Error("Enter the username or display name for this workspace account.");
  }

  const account = await previewPersistedAuthAccount(trimmedIdentifier);

  if (!account) {
    return null;
  }

  return {
    name: account.name,
    role: account.role,
    username: account.username,
  };
}

export function getAuthUser(): AuthUser | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(AUTH_USER_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AuthUser>;
    if (
      typeof parsed?.name !== "string" ||
      typeof parsed?.role !== "string" ||
      typeof parsed?.createdAt !== "string"
    ) {
      return null;
    }

    return {
      id:
        typeof parsed.id === "string" && parsed.id.trim()
          ? parsed.id
          : crypto.randomUUID(),
      accountId:
        typeof parsed.accountId === "string" && parsed.accountId.trim()
          ? parsed.accountId
          : typeof parsed.id === "string" && parsed.id.trim()
            ? parsed.id
            : crypto.randomUUID(),
      name: parsed.name,
      username:
        typeof parsed.username === "string" && parsed.username.trim()
          ? parsed.username
          : normalizeUsername(parsed.name),
      role: parsed.role,
      createdAt: parsed.createdAt,
    };
  } catch {
    return null;
  }
}

export function clearAuthUser() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(AUTH_USER_KEY);
}

export function buildSessionReviewSignature(
  session: SessionRecord,
  learnerProfile?: LearnerProfileSnapshot | null,
): string {
  return JSON.stringify({
    events: session.events,
    skillLevel: session.skillLevel,
    equityMode: session.equityMode,
    learnerProfile,
  });
}

export function getCachedDebrief(
  session: SessionRecord,
  learnerProfile?: LearnerProfileSnapshot | null,
): DebriefResponse | null {
  if (!session.debrief) {
    return null;
  }

  if (!isValidDebriefResponse(session.debrief.response)) {
    return null;
  }

  return session.debrief.reviewSignature === buildSessionReviewSignature(session, learnerProfile)
    ? session.debrief.response
    : null;
}

export function saveSessionDebrief(
  sessionId: string,
  response: DebriefResponse,
  learnerProfile?: LearnerProfileSnapshot | null,
): SessionRecord | null {
  const session = getSession(sessionId);

  if (!session) {
    return null;
  }

  return saveSession({
    ...session,
    debrief: {
      response,
      reviewSignature: buildSessionReviewSignature(session, learnerProfile),
      generatedAt: new Date().toISOString(),
    },
  });
}

export function createSession(
  procedureId: string,
  skillLevel: SkillLevel,
  ownerUsername?: string,
): SessionRecord {
  const timestamp = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    procedureId,
    ownerUsername,
    skillLevel,
    calibration: createDefaultCalibration(),
    equityMode: createDefaultEquityMode(),
    events: [],
    offlinePracticeLogs: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function startFreshSession(
  procedureId: string,
  skillLevel: SkillLevel,
  ownerUsername?: string,
): SessionRecord {
  const session = createSession(procedureId, skillLevel, ownerUsername);
  return saveSession(session);
}

export function getOrCreateActiveSession(
  procedureId: string,
  skillLevel: SkillLevel,
  ownerUsername?: string,
): SessionRecord {
  const activeId = window.localStorage.getItem(activeSessionKey(procedureId));

  if (activeId) {
    const existing = getSession(activeId);
    if (existing) {
      return existing;
    }
  }

  return startFreshSession(procedureId, skillLevel, ownerUsername);
}

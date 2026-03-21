import { createDefaultCalibration } from "@/lib/geometry";
import type {
  AuthAccount,
  AuthUser,
  CreateAuthAccountInput,
  DebriefResponse,
  EquityModeSettings,
  LoginAuthInput,
  OfflinePracticeLog,
  SessionRecord,
  SkillLevel,
} from "@/lib/types";

const SESSIONS_KEY = "ai-clinical-skills-coach:sessions";
const AUTH_USER_KEY = "ai-clinical-skills-coach:auth-user";
const AUTH_ACCOUNTS_KEY = "ai-clinical-skills-coach:auth-accounts";

function activeSessionKey(procedureId: string) {
  return `ai-clinical-skills-coach:active:${procedureId}`;
}

export function createDefaultEquityMode(): EquityModeSettings {
  return {
    enabled: false,
    feedbackLanguage: "en",
    audioCoaching: false,
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

function readAuthAccounts(): AuthAccount[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(AUTH_ACCOUNTS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const data = JSON.parse(raw) as AuthAccount[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeAuthAccounts(accounts: AuthAccount[]) {
  window.localStorage.setItem(AUTH_ACCOUNTS_KEY, JSON.stringify(accounts));
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

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest("SHA-256", encoder.encode(password));
  return Array.from(new Uint8Array(buffer), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function toAuthUser(account: AuthAccount): AuthUser {
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
  const accounts = readAuthAccounts();

  if (accounts.some((account) => account.username === username)) {
    throw new Error("That username is already registered. Sign in instead.");
  }

  const account: AuthAccount = {
    id: crypto.randomUUID(),
    name,
    username,
    passwordHash: await hashPassword(password),
    role: input.role,
    createdAt: new Date().toISOString(),
  };

  writeAuthAccounts([...accounts, account]);
  return persistAuthUser(toAuthUser(account));
}

export async function signInAuthUser(input: LoginAuthInput): Promise<AuthUser> {
  ensureBrowserStorage();

  const username = validateUsername(input.username);
  const password = validatePassword(input.password);
  const accounts = readAuthAccounts();

  if (accounts.length === 0) {
    throw new Error("No local accounts exist yet. Create an account first.");
  }

  const account = accounts.find((entry) => entry.username === username);
  if (!account) {
    throw new Error("No account was found for that username.");
  }

  const passwordHash = await hashPassword(password);
  if (account.passwordHash !== passwordHash) {
    throw new Error("Incorrect password. Try again.");
  }

  if (input.role && account.role !== input.role) {
    throw new Error(
      `This account is registered as ${account.role}. Switch roles or use a different account.`,
    );
  }

  return persistAuthUser(toAuthUser(account));
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

export function buildSessionReviewSignature(session: SessionRecord): string {
  return JSON.stringify({
    events: session.events,
    skillLevel: session.skillLevel,
    equityMode: session.equityMode,
  });
}

export function getCachedDebrief(session: SessionRecord): DebriefResponse | null {
  if (!session.debrief) {
    return null;
  }

  if (!isValidDebriefResponse(session.debrief.response)) {
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

import { createDefaultCalibration } from "@/lib/geometry";
import {
  consumeLiveSessionAllowance,
  createPersistedAuthAccount,
  getCurrentPersistedAuthAccount,
  getPersistedLearningState,
  listDemoAccounts,
  resetDemoAccountQuota,
  savePersistedKnowledgeProgress,
  savePersistedLearningSession,
  signInPersistedAuthAccount,
  updatePersistedAuthAccount,
  type PersistedAuthAccount,
} from "@/lib/api";
import type {
  AuthUser,
  CoachVoicePreset,
  CreateAuthAccountInput,
  DebriefResponse,
  DemoAccountQuotaResetInput,
  EquityModeSettings,
  KnowledgeProgress,
  LearningStateSnapshot,
  LearnerProfileSnapshot,
  LoginAuthInput,
  OfflinePracticeLog,
  SessionRecord,
  SkillLevel,
  UpdateAuthAccountInput,
} from "@/lib/types";

const SESSIONS_KEY = "ai-clinical-skills-coach:sessions";
const AUTH_USER_KEY = "ai-clinical-skills-coach:auth-user";
const KNOWLEDGE_PROGRESS_PREFIX = "ai-clinical-skills-coach:knowledge-progress";
const WORKSPACE_USER_CHANGE_EVENT = "workspace-user-change";
const KNOWLEDGE_HISTORY_LIMIT = 48;

let activeLearningStateSyncKey: string | null = null;
let activeLearningStateSyncPromise: Promise<LearningStateSnapshot | null> | null =
  null;

type SaveSessionOptions = {
  makeActive?: boolean;
  sync?: boolean;
};

function activeSessionKey(procedureId: string, ownerUsername?: string) {
  const normalizedOwner =
    typeof ownerUsername === "string" && ownerUsername.trim()
      ? normalizeUsername(ownerUsername)
      : "";

  return normalizedOwner
    ? `ai-clinical-skills-coach:active:${normalizedOwner}:${procedureId}`
    : `ai-clinical-skills-coach:active:${procedureId}`;
}

function knowledgeProgressKey(ownerUsername: string) {
  return `${KNOWLEDGE_PROGRESS_PREFIX}:${normalizeUsername(ownerUsername)}`;
}

function normalizeCoachVoicePreset(value: unknown): CoachVoicePreset {
  if (value === "guide_male") {
    return "guide_male";
  }

  if (value === "mentor_male") {
    return "guide_male";
  }

  if (
    value === "guide_male" ||
    value === "guide_female" ||
    value === "mentor_female" ||
    value === "system_default"
  ) {
    return value;
  }

  return "guide_female";
}

export function createDefaultEquityMode(): EquityModeSettings {
  return {
    enabled: false,
    feedbackLanguage: "en",
    audioCoaching: true,
    coachVoice: "guide_female",
    lowBandwidthMode: false,
    cheapPhoneMode: false,
    offlinePracticeLogging: true,
  };
}

export function createDefaultKnowledgeProgress(): KnowledgeProgress {
  return {
    answeredCount: 0,
    completedQuizRounds: 0,
    correctCount: 0,
    flashcardsMastered: 0,
    perfectRounds: 0,
    rapidfireBestStreak: 0,
    totalPoints: 0,
    recentQuestionPrompts: [],
    recentFlashcardFronts: [],
  };
}

function ensureBrowserStorage() {
  if (typeof window === "undefined") {
    throw new Error("Authentication is available only in the browser.");
  }
}

function emitWorkspaceUserChange() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(WORKSPACE_USER_CHANGE_EVENT));
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

function writeSessions(
  sessions: Record<string, SessionRecord>,
  options?: { emitChange?: boolean },
) {
  window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  if (options?.emitChange !== false) {
    emitWorkspaceUserChange();
  }
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
        coachVoice: normalizeCoachVoicePreset(session.equityMode.coachVoice),
      }
    : createDefaultEquityMode();

  return {
    id: session.id ?? sessionId,
    procedureId: session.procedureId,
    ownerUsername:
      typeof session.ownerUsername === "string"
        ? normalizeUsername(session.ownerUsername)
        : undefined,
    skillLevel: session.skillLevel,
    practiceSurface:
      typeof session.practiceSurface === "string" ? session.practiceSurface : undefined,
    simulationConfirmed: true,
    learnerFocus:
      typeof session.learnerFocus === "string" ? session.learnerFocus : undefined,
    calibration: session.calibration ?? createDefaultCalibration(),
    equityMode: {
      ...equityMode,
      enabled: false,
      feedbackLanguage: "en",
      audioCoaching: true,
      lowBandwidthMode: false,
      cheapPhoneMode: false,
      offlinePracticeLogging: true,
    },
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

function normalizeKnowledgeHistoryList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const cleaned = item.trim();
    if (!cleaned || normalized.includes(cleaned)) {
      continue;
    }
    normalized.push(cleaned);
  }

  return normalized.slice(-KNOWLEDGE_HISTORY_LIMIT);
}

function readKnowledgeProgress(ownerUsername: string): KnowledgeProgress {
  if (typeof window === "undefined") {
    return createDefaultKnowledgeProgress();
  }

  const raw = window.localStorage.getItem(knowledgeProgressKey(ownerUsername));
  if (!raw) {
    return createDefaultKnowledgeProgress();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<KnowledgeProgress>;
    return {
      answeredCount:
        typeof parsed.answeredCount === "number" ? parsed.answeredCount : 0,
      completedQuizRounds:
        typeof parsed.completedQuizRounds === "number"
          ? parsed.completedQuizRounds
          : 0,
      correctCount:
        typeof parsed.correctCount === "number" ? parsed.correctCount : 0,
      flashcardsMastered:
        typeof parsed.flashcardsMastered === "number"
          ? parsed.flashcardsMastered
          : 0,
      perfectRounds:
        typeof parsed.perfectRounds === "number" ? parsed.perfectRounds : 0,
      rapidfireBestStreak:
        typeof parsed.rapidfireBestStreak === "number"
          ? parsed.rapidfireBestStreak
          : 0,
      totalPoints:
        typeof parsed.totalPoints === "number" ? parsed.totalPoints : 0,
      recentQuestionPrompts: normalizeKnowledgeHistoryList(
        parsed.recentQuestionPrompts,
      ),
      recentFlashcardFronts: normalizeKnowledgeHistoryList(
        parsed.recentFlashcardFronts,
      ),
    };
  } catch {
    return createDefaultKnowledgeProgress();
  }
}

function writeKnowledgeProgress(
  ownerUsername: string,
  progress: KnowledgeProgress,
  options?: { emitChange?: boolean },
) {
  window.localStorage.setItem(
    knowledgeProgressKey(ownerUsername),
    JSON.stringify(progress),
  );

  if (options?.emitChange !== false) {
    emitWorkspaceUserChange();
  }
}

function toAuthUser(account: PersistedAuthAccount): AuthUser {
  return {
    id: account.id,
    accountId: account.id,
    name: account.name,
    username: account.username,
    role: account.role,
    isDeveloper: account.isDeveloper,
    isSeeded: account.isSeeded,
    requestedRole: account.requestedRole ?? null,
    adminApprovalStatus: account.adminApprovalStatus,
    liveSessionLimit: account.liveSessionLimit ?? null,
    liveSessionUsed: account.liveSessionUsed,
    liveSessionRemaining: account.liveSessionRemaining ?? null,
    sessionToken: account.sessionToken ?? null,
    createdAt: account.createdAt,
  };
}

function persistAuthUser(user: AuthUser): AuthUser {
  window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  emitWorkspaceUserChange();
  return user;
}

function getCurrentLearningSyncKey(user: AuthUser): string {
  return `${user.accountId}:${user.sessionToken ?? "anonymous"}`;
}

function compareTimestamps(left?: string, right?: string): number {
  const leftTime = Date.parse(left ?? "");
  const rightTime = Date.parse(right ?? "");

  if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) {
    return 0;
  }
  if (Number.isNaN(leftTime)) {
    return -1;
  }
  if (Number.isNaN(rightTime)) {
    return 1;
  }
  return leftTime - rightTime;
}

function mergeKnowledgeProgress(
  localProgress: KnowledgeProgress,
  remoteProgress: KnowledgeProgress,
): KnowledgeProgress {
  return {
    answeredCount: Math.max(localProgress.answeredCount, remoteProgress.answeredCount),
    completedQuizRounds: Math.max(
      localProgress.completedQuizRounds,
      remoteProgress.completedQuizRounds,
    ),
    correctCount: Math.max(localProgress.correctCount, remoteProgress.correctCount),
    flashcardsMastered: Math.max(
      localProgress.flashcardsMastered,
      remoteProgress.flashcardsMastered,
    ),
    perfectRounds: Math.max(localProgress.perfectRounds, remoteProgress.perfectRounds),
    rapidfireBestStreak: Math.max(
      localProgress.rapidfireBestStreak,
      remoteProgress.rapidfireBestStreak,
    ),
    totalPoints: Math.max(localProgress.totalPoints, remoteProgress.totalPoints),
    recentQuestionPrompts: normalizeKnowledgeHistoryList([
      ...remoteProgress.recentQuestionPrompts,
      ...localProgress.recentQuestionPrompts,
    ]),
    recentFlashcardFronts: normalizeKnowledgeHistoryList([
      ...remoteProgress.recentFlashcardFronts,
      ...localProgress.recentFlashcardFronts,
    ]),
  };
}

function clearActiveSessionKeysForOwner(ownerUsername: string) {
  const normalizedOwner = normalizeUsername(ownerUsername);
  const prefix = `ai-clinical-skills-coach:active:${normalizedOwner}:`;
  const keysToRemove: string[] = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(prefix)) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    window.localStorage.removeItem(key);
  }
}

function applyLearningStateSnapshotToCache(
  ownerUsername: string,
  snapshot: LearningStateSnapshot,
) {
  const normalizedOwner = normalizeUsername(ownerUsername);
  const sessions = readSessions();
  const ownerSessions = Object.values(sessions).filter(
    (session) => session.ownerUsername === normalizedOwner,
  );
  const mergedOwnerSessions = new Map<string, SessionRecord>();

  for (const session of ownerSessions) {
    mergedOwnerSessions.set(session.id, session);
  }

  for (const session of snapshot.sessions) {
    const normalizedSession = normalizeSessionRecord(session.id, {
      ...session,
      ownerUsername: normalizedOwner,
    });
    if (!normalizedSession) {
      continue;
    }

    const existingLocalSession = mergedOwnerSessions.get(normalizedSession.id);
    if (
      existingLocalSession &&
      compareTimestamps(existingLocalSession.updatedAt, normalizedSession.updatedAt) > 0
    ) {
      continue;
    }

    mergedOwnerSessions.set(normalizedSession.id, normalizedSession);
  }

  for (const [sessionId, session] of Object.entries(sessions)) {
    if (session.ownerUsername === normalizedOwner) {
      delete sessions[sessionId];
    }
  }

  for (const [sessionId, session] of mergedOwnerSessions.entries()) {
    sessions[sessionId] = session;
  }

  writeSessions(sessions, { emitChange: false });
  clearActiveSessionKeysForOwner(normalizedOwner);

  const activeSessionsByProcedure = new Map<string, SessionRecord>();
  const remoteActiveProcedureIds = new Set(
    Object.keys(snapshot.activeSessionIds),
  );

  for (const [procedureId, sessionId] of Object.entries(snapshot.activeSessionIds)) {
    const candidate = mergedOwnerSessions.get(sessionId);
    if (candidate) {
      activeSessionsByProcedure.set(procedureId, candidate);
    }
  }

  for (const session of mergedOwnerSessions.values()) {
    if (remoteActiveProcedureIds.has(session.procedureId)) {
      continue;
    }

    const currentActive = activeSessionsByProcedure.get(session.procedureId);
    if (
      !currentActive ||
      compareTimestamps(session.updatedAt, currentActive.updatedAt) > 0
    ) {
      activeSessionsByProcedure.set(session.procedureId, session);
    }
  }

  for (const [procedureId, session] of activeSessionsByProcedure.entries()) {
    window.localStorage.setItem(
      activeSessionKey(procedureId, normalizedOwner),
      session.id,
    );
  }

  const localKnowledgeProgress = readKnowledgeProgress(normalizedOwner);
  const mergedKnowledgeProgress = mergeKnowledgeProgress(
    localKnowledgeProgress,
    snapshot.knowledgeProgress,
  );
  writeKnowledgeProgress(normalizedOwner, mergedKnowledgeProgress, {
    emitChange: false,
  });
  emitWorkspaceUserChange();
}

async function syncSessionRecordToBackend(
  session: SessionRecord,
  options?: { makeActive?: boolean },
) {
  const currentUser = getAuthUser();
  if (!currentUser?.sessionToken) {
    return;
  }

  const normalizedOwner = session.ownerUsername
    ? normalizeUsername(session.ownerUsername)
    : null;
  if (normalizedOwner && normalizedOwner !== normalizeUsername(currentUser.username)) {
    return;
  }

  const persistedSession = await savePersistedLearningSession({
    accountId: currentUser.accountId,
    sessionToken: currentUser.sessionToken,
    session: {
      ...session,
      ownerUsername: normalizedOwner ?? normalizeUsername(currentUser.username),
    },
    makeActive: options?.makeActive ?? false,
  });

  const normalizedSession = normalizeSessionRecord(persistedSession.id, persistedSession);
  if (!normalizedSession) {
    return;
  }

  const currentCachedSession = getSession(normalizedSession.id);
  if (
    currentCachedSession &&
    compareTimestamps(currentCachedSession.updatedAt, normalizedSession.updatedAt) > 0
  ) {
    void syncSessionRecordToBackend(currentCachedSession, options).catch(() => {});
    return;
  }

  const sessions = readSessions();
  sessions[normalizedSession.id] = normalizedSession;
  writeSessions(sessions, { emitChange: false });
  if (options?.makeActive) {
    window.localStorage.setItem(
      activeSessionKey(normalizedSession.procedureId, normalizedSession.ownerUsername),
      normalizedSession.id,
    );
  }
  emitWorkspaceUserChange();
}

async function syncKnowledgeProgressToBackend(
  ownerUsername: string,
  progress: KnowledgeProgress,
) {
  const currentUser = getAuthUser();
  if (!currentUser?.sessionToken) {
    return;
  }

  if (normalizeUsername(currentUser.username) !== normalizeUsername(ownerUsername)) {
    return;
  }

  const persistedProgress = await savePersistedKnowledgeProgress({
    accountId: currentUser.accountId,
    sessionToken: currentUser.sessionToken,
    progress,
  });

  const currentLocalProgress = readKnowledgeProgress(ownerUsername);
  const mergedProgress = mergeKnowledgeProgress(
    currentLocalProgress,
    persistedProgress,
  );
  writeKnowledgeProgress(ownerUsername, mergedProgress);

  if (JSON.stringify(mergedProgress) !== JSON.stringify(persistedProgress)) {
    void syncKnowledgeProgressToBackend(ownerUsername, mergedProgress).catch(() => {});
  }
}

function migrateOwnerSessions(previousUsername: string, nextUsername: string) {
  const previousNormalized = normalizeUsername(previousUsername);
  const nextNormalized = normalizeUsername(nextUsername);

  if (!previousNormalized || previousNormalized === nextNormalized) {
    return;
  }

  const sessions = readSessions();
  const touchedProcedures = new Set<string>();

  for (const [sessionId, session] of Object.entries(sessions)) {
    if (session.ownerUsername !== previousNormalized) {
      continue;
    }

    sessions[sessionId] = {
      ...session,
      ownerUsername: nextNormalized,
      updatedAt: new Date().toISOString(),
    };
    touchedProcedures.add(session.procedureId);
  }

  writeSessions(sessions, { emitChange: false });

  for (const procedureId of touchedProcedures) {
    const previousKey = activeSessionKey(procedureId, previousNormalized);
    const nextKey = activeSessionKey(procedureId, nextNormalized);
    const previousActiveId = window.localStorage.getItem(previousKey);

    if (previousActiveId) {
      window.localStorage.setItem(nextKey, previousActiveId);
      window.localStorage.removeItem(previousKey);
      continue;
    }

    const candidate = Object.values(sessions).find(
      (session) =>
        session.procedureId === procedureId && session.ownerUsername === nextNormalized,
    );

    if (candidate) {
      window.localStorage.setItem(nextKey, candidate.id);
    }
  }

  const previousKnowledgeProgressKey = knowledgeProgressKey(previousNormalized);
  const nextKnowledgeProgressKey = knowledgeProgressKey(nextNormalized);
  const previousKnowledgeProgress =
    window.localStorage.getItem(previousKnowledgeProgressKey);

  if (previousKnowledgeProgress) {
    if (!window.localStorage.getItem(nextKnowledgeProgressKey)) {
      window.localStorage.setItem(nextKnowledgeProgressKey, previousKnowledgeProgress);
    }

    window.localStorage.removeItem(previousKnowledgeProgressKey);
  }

  emitWorkspaceUserChange();
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

export function saveSession(
  session: SessionRecord,
  options?: SaveSessionOptions,
): SessionRecord {
  ensureBrowserStorage();

  const normalizedSession = normalizeSessionRecord(session.id, session);
  if (!normalizedSession) {
    throw new Error("Session payload is missing required fields.");
  }

  const sessions = readSessions();
  sessions[normalizedSession.id] = normalizedSession;
  writeSessions(sessions, { emitChange: false });
  if (options?.makeActive) {
    window.localStorage.setItem(
      activeSessionKey(
        normalizedSession.procedureId,
        normalizedSession.ownerUsername,
      ),
      normalizedSession.id,
    );
  }
  emitWorkspaceUserChange();

  if (options?.sync !== false) {
    void syncSessionRecordToBackend(normalizedSession, {
      makeActive: options?.makeActive,
    }).catch(() => {});
  }

  return normalizedSession;
}

export function getSession(sessionId: string): SessionRecord | null {
  return readSessions()[sessionId] ?? null;
}

export function listSessions(): SessionRecord[] {
  return Object.values(readSessions()).sort((left, right) =>
    left.createdAt < right.createdAt ? 1 : -1,
  );
}

export function listSessionsForOwner(ownerUsername: string): SessionRecord[] {
  const normalizedOwner = normalizeUsername(ownerUsername);
  return listSessions().filter(
    (session) => session.ownerUsername === normalizedOwner,
  );
}

export function listSessionsForOwnerProcedure(
  ownerUsername: string,
  procedureId: string,
): SessionRecord[] {
  const normalizedOwner = normalizeUsername(ownerUsername);
  return listSessions().filter(
    (session) =>
      session.procedureId === procedureId &&
      session.ownerUsername === normalizedOwner,
  );
}

export function getKnowledgeProgress(ownerUsername: string): KnowledgeProgress {
  return readKnowledgeProgress(ownerUsername);
}

export function saveKnowledgeProgress(
  ownerUsername: string,
  progress: KnowledgeProgress,
): KnowledgeProgress {
  ensureBrowserStorage();

  const normalizedOwner = normalizeUsername(ownerUsername);
  writeKnowledgeProgress(normalizedOwner, progress);
  void syncKnowledgeProgressToBackend(normalizedOwner, progress).catch(() => {});
  return progress;
}

export async function syncLearningStateFromBackend(
  options?: { force?: boolean },
): Promise<LearningStateSnapshot | null> {
  ensureBrowserStorage();

  const currentUser = getAuthUser();
  if (!currentUser?.sessionToken) {
    return null;
  }

  const syncKey = getCurrentLearningSyncKey(currentUser);
  if (
    !options?.force &&
    activeLearningStateSyncKey === syncKey &&
    activeLearningStateSyncPromise
  ) {
    return activeLearningStateSyncPromise;
  }

  const syncPromise = getPersistedLearningState({
    accountId: currentUser.accountId,
    sessionToken: currentUser.sessionToken,
  })
    .then((snapshot) => {
      applyLearningStateSnapshotToCache(currentUser.username, snapshot);
      return snapshot;
    })
    .finally(() => {
      if (activeLearningStateSyncPromise === syncPromise) {
        activeLearningStateSyncKey = null;
        activeLearningStateSyncPromise = null;
      }
    });

  activeLearningStateSyncKey = syncKey;
  activeLearningStateSyncPromise = syncPromise;

  return syncPromise;
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
  const user = persistAuthUser(toAuthUser(account));
  try {
    await syncLearningStateFromBackend({ force: true });
  } catch {
    // Keep sign-in usable even if the initial learning-state hydrate fails.
  }
  return user;
}

export async function signInAuthUser(input: LoginAuthInput): Promise<AuthUser> {
  ensureBrowserStorage();

  const identifier = input.username.trim();
  if (identifier.length < 3) {
    throw new Error("Enter the username for this workspace account.");
  }

  const password = validatePassword(input.password);
  const account = await signInPersistedAuthAccount({
    identifier,
    password,
    role: input.role,
  });
  const user = persistAuthUser(toAuthUser(account));
  try {
    await syncLearningStateFromBackend({ force: true });
  } catch {
    // Keep sign-in usable even if the initial learning-state hydrate fails.
  }
  return user;
}

export async function refreshAuthUser(): Promise<AuthUser | null> {
  ensureBrowserStorage();

  const currentUser = getAuthUser();
  if (!currentUser) {
    return null;
  }

  if (!currentUser.sessionToken) {
    clearAuthUser();
    return null;
  }

  const account = await getCurrentPersistedAuthAccount({
    accountId: currentUser.accountId,
    sessionToken: currentUser.sessionToken,
  });
  if (!account) {
    clearAuthUser();
    return null;
  }

  const nextUser = persistAuthUser({
    ...currentUser,
    accountId: account.id,
    name: account.name,
    username: account.username,
    role: account.role,
    isDeveloper: account.isDeveloper,
    isSeeded: account.isSeeded,
    requestedRole: account.requestedRole ?? null,
    adminApprovalStatus: account.adminApprovalStatus,
    liveSessionLimit: account.liveSessionLimit ?? null,
    liveSessionUsed: account.liveSessionUsed,
    liveSessionRemaining: account.liveSessionRemaining ?? null,
    sessionToken: account.sessionToken ?? currentUser.sessionToken ?? null,
    createdAt: account.createdAt,
  });

  try {
    await syncLearningStateFromBackend({ force: true });
  } catch {
    // Keep account refresh usable even if the learning-state hydrate fails.
  }

  return nextUser;
}

export async function updateAuthUserProfile(
  input: UpdateAuthAccountInput,
): Promise<AuthUser> {
  ensureBrowserStorage();

  const currentUser = getAuthUser();
  if (!currentUser) {
    throw new Error("Sign in again before editing the workspace profile.");
  }

  const name = input.name.trim();
  if (!name) {
    throw new Error("Display name is required.");
  }

  const username = validateUsername(input.username);
  const currentPassword = validatePassword(input.currentPassword);
  const newPassword = input.newPassword?.trim()
    ? validatePassword(input.newPassword)
    : undefined;

  const account = await updatePersistedAuthAccount(currentUser.accountId, {
    name,
    username,
    currentPassword,
    newPassword,
  });

  migrateOwnerSessions(currentUser.username, account.username);

  const nextUser = persistAuthUser({
    ...currentUser,
    accountId: account.id,
    name: account.name,
    username: account.username,
    role: account.role,
    isDeveloper: account.isDeveloper,
    isSeeded: account.isSeeded,
    requestedRole: account.requestedRole ?? null,
    adminApprovalStatus: account.adminApprovalStatus,
    liveSessionLimit: account.liveSessionLimit ?? null,
    liveSessionUsed: account.liveSessionUsed,
    liveSessionRemaining: account.liveSessionRemaining ?? null,
    sessionToken: account.sessionToken ?? currentUser.sessionToken ?? null,
    createdAt: account.createdAt,
  });

  try {
    await syncLearningStateFromBackend({ force: true });
  } catch {
    // Keep profile updates usable even if the learning-state hydrate fails.
  }

  return nextUser;
}

export async function consumeAuthLiveSession(): Promise<AuthUser> {
  ensureBrowserStorage();

  const currentUser = getAuthUser();
  if (!currentUser?.sessionToken) {
    throw new Error("Sign in again before starting another live session.");
  }

  const account = await consumeLiveSessionAllowance({
    accountId: currentUser.accountId,
    sessionToken: currentUser.sessionToken,
  });

  return persistAuthUser({
    ...currentUser,
    accountId: account.id,
    name: account.name,
    username: account.username,
    role: account.role,
    isDeveloper: account.isDeveloper,
    isSeeded: account.isSeeded,
    requestedRole: account.requestedRole ?? null,
    adminApprovalStatus: account.adminApprovalStatus,
    liveSessionLimit: account.liveSessionLimit ?? null,
    liveSessionUsed: account.liveSessionUsed,
    liveSessionRemaining: account.liveSessionRemaining ?? null,
    sessionToken: account.sessionToken ?? currentUser.sessionToken ?? null,
    createdAt: account.createdAt,
  });
}

export async function listManageableDemoAccounts(): Promise<AuthUser[]> {
  ensureBrowserStorage();

  const currentUser = getAuthUser();
  if (!currentUser?.sessionToken) {
    throw new Error("Sign in again before managing live-session limits.");
  }
  if (!currentUser.isDeveloper && currentUser.role !== "admin") {
    throw new Error("Only admin or developer accounts can manage live-session limits.");
  }

  const accounts = await listDemoAccounts(
    currentUser.accountId,
    currentUser.sessionToken,
  );

  return accounts.map((account) => ({
    id: crypto.randomUUID(),
    accountId: account.id,
    name: account.name,
    username: account.username,
    role: account.role,
    isDeveloper: account.isDeveloper,
    isSeeded: account.isSeeded,
    requestedRole: account.requestedRole ?? null,
    adminApprovalStatus: account.adminApprovalStatus,
    liveSessionLimit: account.liveSessionLimit ?? null,
    liveSessionUsed: account.liveSessionUsed,
    liveSessionRemaining: account.liveSessionRemaining ?? null,
    sessionToken: null,
    createdAt: account.createdAt,
  }));
}

export async function resetManagedDemoAccountQuota(
  accountId: string,
  input: DemoAccountQuotaResetInput,
): Promise<AuthUser> {
  ensureBrowserStorage();

  const account = await resetDemoAccountQuota(accountId, input);
  const currentUser = getAuthUser();

  if (currentUser && currentUser.accountId === account.id) {
    persistAuthUser({
      ...currentUser,
      name: account.name,
      username: account.username,
      role: account.role,
      isDeveloper: account.isDeveloper,
      isSeeded: account.isSeeded,
      requestedRole: account.requestedRole ?? null,
      adminApprovalStatus: account.adminApprovalStatus,
    liveSessionLimit: account.liveSessionLimit ?? null,
    liveSessionUsed: account.liveSessionUsed,
    liveSessionRemaining: account.liveSessionRemaining ?? null,
    sessionToken: account.sessionToken ?? currentUser.sessionToken ?? null,
    createdAt: account.createdAt,
  });
  }

  return {
    id: crypto.randomUUID(),
    accountId: account.id,
    name: account.name,
    username: account.username,
    role: account.role,
    isDeveloper: account.isDeveloper,
    isSeeded: account.isSeeded,
    requestedRole: account.requestedRole ?? null,
    adminApprovalStatus: account.adminApprovalStatus,
    liveSessionLimit: account.liveSessionLimit ?? null,
    liveSessionUsed: account.liveSessionUsed,
    liveSessionRemaining: account.liveSessionRemaining ?? null,
    sessionToken: null,
    createdAt: account.createdAt,
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
      isDeveloper: parsed.isDeveloper === true,
      isSeeded: parsed.isSeeded === true,
      requestedRole: parsed.requestedRole === "admin" ? "admin" : null,
      adminApprovalStatus:
        parsed.adminApprovalStatus === "pending" ||
        parsed.adminApprovalStatus === "rejected"
          ? parsed.adminApprovalStatus
          : "none",
      liveSessionLimit:
        typeof parsed.liveSessionLimit === "number" ? parsed.liveSessionLimit : null,
      liveSessionUsed:
        typeof parsed.liveSessionUsed === "number" ? parsed.liveSessionUsed : 0,
      liveSessionRemaining:
        typeof parsed.liveSessionRemaining === "number"
          ? parsed.liveSessionRemaining
          : typeof parsed.liveSessionLimit === "number"
            ? parsed.liveSessionLimit
            : null,
      sessionToken:
        typeof parsed.sessionToken === "string" && parsed.sessionToken.trim()
          ? parsed.sessionToken
          : null,
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
  activeLearningStateSyncKey = null;
  activeLearningStateSyncPromise = null;
  emitWorkspaceUserChange();
}

export function buildSessionReviewSignature(
  session: SessionRecord,
  learnerProfile?: LearnerProfileSnapshot | null,
): string {
  return JSON.stringify({
    events: session.events,
    skillLevel: session.skillLevel,
    equityMode: session.equityMode,
    practiceSurface: session.practiceSurface,
    simulationConfirmed: session.simulationConfirmed,
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
  }, {
    makeActive: false,
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
    simulationConfirmed: true,
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
  return saveSession(session, { makeActive: true });
}

export function getOrCreateActiveSession(
  procedureId: string,
  skillLevel: SkillLevel,
  ownerUsername?: string,
): SessionRecord {
  const normalizedOwner =
    typeof ownerUsername === "string" && ownerUsername.trim()
      ? normalizeUsername(ownerUsername)
      : undefined;
  const preferredKeys = normalizedOwner
    ? [
        activeSessionKey(procedureId, normalizedOwner),
        activeSessionKey(procedureId),
      ]
    : [activeSessionKey(procedureId)];

  for (const key of preferredKeys) {
    const activeId = window.localStorage.getItem(key);
    if (!activeId) {
      continue;
    }

    const existing = getSession(activeId);
    if (!existing) {
      continue;
    }

    if (!normalizedOwner) {
      return existing;
    }

    if (existing.ownerUsername === normalizedOwner) {
      return existing;
    }

    if (!existing.ownerUsername) {
      return saveSession({
        ...existing,
        ownerUsername: normalizedOwner,
        updatedAt: new Date().toISOString(),
      }, {
        makeActive: true,
      });
    }
  }

  return startFreshSession(procedureId, skillLevel, ownerUsername);
}

import type {
  AdminApprovalStatus,
  AdminRequestDecisionInput,
  AnalyzeFrameRequest,
  AnalyzeFrameResponse,
  CreateAuthAccountInput,
  CoachChatRequest,
  CoachChatResponse,
  CoachSpeechRequest,
  DebriefRequest,
  DebriefResponse,
  DemoAccountQuotaResetInput,
  HealthStatus,
  KnowledgeProgress,
  KnowledgePackRequest,
  KnowledgePackResponse,
  LearningStateSnapshot,
  SessionRecord,
  TranscriptionTestRequest,
  TranscriptionTestResponse,
  UserRole,
  ProcedureDefinition,
  ResolveReviewCaseRequest,
  ReviewCase,
  UpdateAuthAccountInput,
} from "@/lib/types";

const API_BASE_URL =
  process.env.NODE_ENV === "development"
    ? process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
      "http://localhost:8001/api/v1"
    : "/api/proxy";

function buildApiUrl(path: string): string {
  if (!API_BASE_URL) {
    throw new Error(
      "NEXT_PUBLIC_API_BASE_URL is not configured for this deployment.",
    );
  }

  return `${API_BASE_URL}${path}`;
}

type AuthAccountApiResponse = {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  is_developer: boolean;
  is_seeded: boolean;
  requested_role?: "admin" | null;
  admin_approval_status: AdminApprovalStatus;
  live_session_limit?: number | null;
  live_session_used: number;
  live_session_remaining?: number | null;
  session_token?: string | null;
  created_at: string;
};

export type PersistedAuthAccount = {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  isDeveloper: boolean;
  isSeeded: boolean;
  requestedRole?: "admin" | null;
  adminApprovalStatus: AdminApprovalStatus;
  liveSessionLimit?: number | null;
  liveSessionUsed: number;
  liveSessionRemaining?: number | null;
  sessionToken?: string | null;
  createdAt: string;
};

type LearningStateApiResponse = {
  sessions: SessionRecord[];
  active_session_ids: Record<string, string>;
  knowledge_progress: KnowledgeProgress;
};

function toPersistedAuthAccount(
  response: AuthAccountApiResponse,
): PersistedAuthAccount {
  return {
    id: response.id,
    name: response.name,
    username: response.username,
    role: response.role,
    isDeveloper: response.is_developer,
    isSeeded: response.is_seeded,
    requestedRole: response.requested_role ?? null,
    adminApprovalStatus: response.admin_approval_status,
    liveSessionLimit: response.live_session_limit ?? null,
    liveSessionUsed: response.live_session_used,
    liveSessionRemaining: response.live_session_remaining ?? null,
    sessionToken: response.session_token ?? null,
    createdAt: response.created_at,
  };
}

function buildSessionHeaders(payload: {
  accountId: string;
  sessionToken: string;
}): Record<string, string> {
  return {
    "X-Account-Id": payload.accountId,
    "X-Session-Token": payload.sessionToken,
  };
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const fallbackMessage = `Request failed with status ${response.status}.`;

    try {
      const data = (await response.json()) as { detail?: string };
      throw new Error(data.detail ?? fallbackMessage);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new Error(fallbackMessage);
    }
  }

  return (await response.json()) as T;
}

export async function getProcedure(procedureId: string): Promise<ProcedureDefinition> {
  const response = await fetch(buildApiUrl(`/procedures/${procedureId}`), {
    cache: "no-store",
  });

  return readJson<ProcedureDefinition>(response);
}

export async function getHealthStatus(): Promise<HealthStatus> {
  const response = await fetch(buildApiUrl("/health"), {
    cache: "no-store",
  });

  return readJson<HealthStatus>(response);
}

export async function testTranscription(
  payload: TranscriptionTestRequest,
): Promise<TranscriptionTestResponse> {
  const response = await fetch(buildApiUrl("/transcription/test"), {
    body: JSON.stringify(payload),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  return readJson<TranscriptionTestResponse>(response);
}

export async function generateKnowledgePack(
  payload: KnowledgePackRequest,
): Promise<KnowledgePackResponse> {
  const response = await fetch(buildApiUrl("/knowledge-pack"), {
    body: JSON.stringify(payload),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  return readJson<KnowledgePackResponse>(response);
}

export async function getCurrentPersistedAuthAccount(payload: {
  accountId: string;
  sessionToken: string;
}): Promise<PersistedAuthAccount | null> {
  const response = await fetch(buildApiUrl("/auth/session"), {
    cache: "no-store",
    headers: buildSessionHeaders(payload),
  });

  if (response.status === 403 || response.status === 404) {
    return null;
  }

  const data = await readJson<AuthAccountApiResponse>(response);
  return toPersistedAuthAccount(data);
}

export async function createPersistedAuthAccount(
  payload: CreateAuthAccountInput,
): Promise<PersistedAuthAccount> {
  const response = await fetch(buildApiUrl("/auth/accounts"), {
    body: JSON.stringify(payload),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const data = await readJson<AuthAccountApiResponse>(response);
  return toPersistedAuthAccount(data);
}

export async function signInPersistedAuthAccount(payload: {
  identifier: string;
  password: string;
  role?: UserRole;
}): Promise<PersistedAuthAccount> {
  const response = await fetch(buildApiUrl("/auth/sign-in"), {
    body: JSON.stringify(payload),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const data = await readJson<AuthAccountApiResponse>(response);
  return toPersistedAuthAccount(data);
}

export async function updatePersistedAuthAccount(
  accountId: string,
  payload: UpdateAuthAccountInput,
): Promise<PersistedAuthAccount> {
  const response = await fetch(buildApiUrl(`/auth/accounts/${accountId}`), {
    body: JSON.stringify({
      name: payload.name,
      username: payload.username,
      current_password: payload.currentPassword,
      new_password: payload.newPassword?.trim() ? payload.newPassword : undefined,
    }),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "PUT",
  });

  const data = await readJson<AuthAccountApiResponse>(response);
  return toPersistedAuthAccount(data);
}

export async function listPendingAdminRequests(
  developerAccountId: string,
  developerSessionToken: string,
): Promise<PersistedAuthAccount[]> {
  const response = await fetch(buildApiUrl("/auth/admin-requests"), {
    cache: "no-store",
    headers: buildSessionHeaders({
      accountId: developerAccountId,
      sessionToken: developerSessionToken,
    }),
  });

  const data = await readJson<AuthAccountApiResponse[]>(response);
  return data.map(toPersistedAuthAccount);
}

async function resolveAdminRequest(
  accountId: string,
  path: "approve" | "reject",
  payload: AdminRequestDecisionInput,
): Promise<PersistedAuthAccount> {
  const response = await fetch(
    buildApiUrl(`/auth/admin-requests/${accountId}/${path}`),
    {
      body: JSON.stringify({
        developer_account_id: payload.developerAccountId,
        developer_session_token: payload.developerSessionToken,
      }),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );

  const data = await readJson<AuthAccountApiResponse>(response);
  return toPersistedAuthAccount(data);
}

export async function approveAdminRequest(
  accountId: string,
  payload: AdminRequestDecisionInput,
): Promise<PersistedAuthAccount> {
  return resolveAdminRequest(accountId, "approve", payload);
}

export async function rejectAdminRequest(
  accountId: string,
  payload: AdminRequestDecisionInput,
): Promise<PersistedAuthAccount> {
  return resolveAdminRequest(accountId, "reject", payload);
}

export async function listDemoAccounts(
  actorAccountId: string,
  actorSessionToken: string,
): Promise<PersistedAuthAccount[]> {
  const response = await fetch(buildApiUrl("/auth/demo-accounts"), {
    cache: "no-store",
    headers: buildSessionHeaders({
      accountId: actorAccountId,
      sessionToken: actorSessionToken,
    }),
  });

  const data = await readJson<AuthAccountApiResponse[]>(response);
  return data.map(toPersistedAuthAccount);
}

export async function consumeLiveSessionAllowance(payload: {
  accountId: string;
  sessionToken: string;
}): Promise<PersistedAuthAccount> {
  const response = await fetch(buildApiUrl("/auth/live-sessions/consume"), {
    body: JSON.stringify({
      account_id: payload.accountId,
      session_token: payload.sessionToken,
    }),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const data = await readJson<AuthAccountApiResponse>(response);
  return toPersistedAuthAccount(data);
}

export async function resetDemoAccountQuota(
  accountId: string,
  payload: DemoAccountQuotaResetInput,
): Promise<PersistedAuthAccount> {
  const response = await fetch(buildApiUrl(`/auth/accounts/${accountId}/reset-live-sessions`), {
    body: JSON.stringify({
      actor_account_id: payload.actorAccountId,
      actor_session_token: payload.actorSessionToken,
    }),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const data = await readJson<AuthAccountApiResponse>(response);
  return toPersistedAuthAccount(data);
}

export async function getPersistedLearningState(payload: {
  accountId: string;
  sessionToken: string;
}): Promise<LearningStateSnapshot> {
  const response = await fetch(buildApiUrl("/learning-state"), {
    cache: "no-store",
    headers: buildSessionHeaders(payload),
  });

  const data = await readJson<LearningStateApiResponse>(response);
  return {
    sessions: data.sessions,
    activeSessionIds: data.active_session_ids,
    knowledgeProgress: data.knowledge_progress,
  };
}

export async function savePersistedLearningSession(payload: {
  accountId: string;
  sessionToken: string;
  session: SessionRecord;
  makeActive?: boolean;
}): Promise<SessionRecord> {
  const response = await fetch(
    buildApiUrl(`/learning-state/sessions/${payload.session.id}`),
    {
      body: JSON.stringify({
        account_id: payload.accountId,
        session_token: payload.sessionToken,
        session: payload.session,
        make_active: payload.makeActive ?? false,
      }),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      method: "PUT",
    },
  );

  return readJson<SessionRecord>(response);
}

export async function savePersistedKnowledgeProgress(payload: {
  accountId: string;
  sessionToken: string;
  progress: KnowledgeProgress;
}): Promise<KnowledgeProgress> {
  const response = await fetch(buildApiUrl("/learning-state/knowledge-progress"), {
    body: JSON.stringify({
      account_id: payload.accountId,
      session_token: payload.sessionToken,
      progress: payload.progress,
    }),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "PUT",
  });

  return readJson<KnowledgeProgress>(response);
}

export async function analyzeFrame(
  payload: AnalyzeFrameRequest,
): Promise<AnalyzeFrameResponse> {
  const response = await fetch(buildApiUrl("/analyze-frame"), {
    body: JSON.stringify(payload),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  return readJson<AnalyzeFrameResponse>(response);
}

export async function coachChat(
  payload: CoachChatRequest,
): Promise<CoachChatResponse> {
  const response = await fetch(buildApiUrl("/coach-chat"), {
    body: JSON.stringify(payload),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  return readJson<CoachChatResponse>(response);
}

export async function synthesizeCoachSpeech(
  payload: CoachSpeechRequest,
): Promise<Blob> {
  const response = await fetch(buildApiUrl("/tts"), {
    body: JSON.stringify(payload),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const fallbackMessage = `Request failed with status ${response.status}.`;

    try {
      const data = (await response.json()) as { detail?: string };
      throw new Error(data.detail ?? fallbackMessage);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new Error(fallbackMessage);
    }
  }

  return response.blob();
}

export async function generateDebrief(
  payload: DebriefRequest,
): Promise<DebriefResponse> {
  const response = await fetch(buildApiUrl("/debrief"), {
    body: JSON.stringify(payload),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  return readJson<DebriefResponse>(response);
}

export async function listReviewCases(filters?: {
  status?: "pending" | "resolved";
  sessionId?: string;
}): Promise<ReviewCase[]> {
  const params = new URLSearchParams();
  if (filters?.status) {
    params.set("status", filters.status);
  }
  if (filters?.sessionId) {
    params.set("session_id", filters.sessionId);
  }

  const query = params.toString();
  const response = await fetch(buildApiUrl(`/review-cases${query ? `?${query}` : ""}`), {
    cache: "no-store",
  });

  return readJson<ReviewCase[]>(response);
}

export async function resolveReviewCase(
  caseId: string,
  payload: ResolveReviewCaseRequest,
): Promise<ReviewCase> {
  const response = await fetch(buildApiUrl(`/review-cases/${caseId}/resolve`), {
    body: JSON.stringify(payload),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  return readJson<ReviewCase>(response);
}

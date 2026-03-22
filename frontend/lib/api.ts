import type {
  AnalyzeFrameRequest,
  AnalyzeFrameResponse,
  CreateAuthAccountInput,
  CoachChatRequest,
  CoachChatResponse,
  CoachSpeechRequest,
  DebriefRequest,
  DebriefResponse,
  HealthStatus,
  UserRole,
  ProcedureDefinition,
  ResolveReviewCaseRequest,
  ReviewCase,
} from "@/lib/types";

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8001/api/v1"
).replace(/\/$/, "");

type AuthAccountApiResponse = {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  created_at: string;
};

export type PersistedAuthAccount = {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  createdAt: string;
};

function toPersistedAuthAccount(
  response: AuthAccountApiResponse,
): PersistedAuthAccount {
  return {
    id: response.id,
    name: response.name,
    username: response.username,
    role: response.role,
    createdAt: response.created_at,
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
  const response = await fetch(`${API_BASE_URL}/procedures/${procedureId}`, {
    cache: "no-store",
  });

  return readJson<ProcedureDefinition>(response);
}

export async function getHealthStatus(): Promise<HealthStatus> {
  const response = await fetch(`${API_BASE_URL}/health`, {
    cache: "no-store",
  });

  return readJson<HealthStatus>(response);
}

export async function previewPersistedAuthAccount(
  identifier: string,
): Promise<PersistedAuthAccount | null> {
  const params = new URLSearchParams({ identifier });
  const response = await fetch(`${API_BASE_URL}/auth/accounts/preview?${params}`, {
    cache: "no-store",
  });

  if (response.status === 404) {
    return null;
  }

  const data = await readJson<AuthAccountApiResponse>(response);
  return toPersistedAuthAccount(data);
}

export async function createPersistedAuthAccount(
  payload: CreateAuthAccountInput,
): Promise<PersistedAuthAccount> {
  const response = await fetch(`${API_BASE_URL}/auth/accounts`, {
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
  const response = await fetch(`${API_BASE_URL}/auth/sign-in`, {
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

export async function analyzeFrame(
  payload: AnalyzeFrameRequest,
): Promise<AnalyzeFrameResponse> {
  const response = await fetch(`${API_BASE_URL}/analyze-frame`, {
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
  const response = await fetch(`${API_BASE_URL}/coach-chat`, {
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
  const response = await fetch(`${API_BASE_URL}/tts`, {
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
  const response = await fetch(`${API_BASE_URL}/debrief`, {
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
  const response = await fetch(
    `${API_BASE_URL}/review-cases${query ? `?${query}` : ""}`,
    {
      cache: "no-store",
    },
  );

  return readJson<ReviewCase[]>(response);
}

export async function resolveReviewCase(
  caseId: string,
  payload: ResolveReviewCaseRequest,
): Promise<ReviewCase> {
  const response = await fetch(`${API_BASE_URL}/review-cases/${caseId}/resolve`, {
    body: JSON.stringify(payload),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  return readJson<ReviewCase>(response);
}

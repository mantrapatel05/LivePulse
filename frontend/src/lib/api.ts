import { API_URL } from "./config";
import { getSupabase } from "./supabaseClient";

export type LPProject = {
  _id: string;
  name: string;
  // Only ever present in the createProject/rotateKey response bodies —
  // the backend stores nothing but a hash from that point on, so any
  // other read (listProjects, a page refresh) will not include this.
  apiKey?: string;
  apiKeyPrefix?: string;
  supabaseUserId?: string;
  analyticsBackend?: "mongo" | "dual" | "clickhouse";
  createdAt?: string;
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Pulls the current Supabase access token, or throws a clear error. */
async function getAccessToken(): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new ApiError("Auth is not configured.", 0);
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new ApiError("Your session has expired. Sign in again.", 401);
  return data.session.access_token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
  } catch {
    throw new ApiError(
      `Can't reach the LivePulse collector at ${API_URL}. Make sure the backend is running.`,
      0,
    );
  }
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const detail =
      body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : "";
    const msg = detail || `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

/** Same as request(), but attaches the signed-in founder's session token. */
async function dashboardRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  return request<T>(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/* ---------- project endpoints (dashboard session required) ---------- */

export type Json = Record<string, unknown>;

export function listProjects() {
  return dashboardRequest<{ projects: LPProject[] } | LPProject[]>(`/api/projects`).then((r) =>
    Array.isArray(r) ? r : (r.projects ?? []),
  );
}

function unwrapProject(r: { project: LPProject } | LPProject): LPProject {
  return "project" in r ? r.project : r;
}

export function createProject(name: string) {
  return dashboardRequest<{ project: LPProject } | LPProject>("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  }).then(unwrapProject);
}

export function rotateKey(projectId: string) {
  return dashboardRequest<{ project: LPProject } | LPProject>(
    `/api/projects/${projectId}/rotate-key`,
    { method: "POST" },
  ).then(unwrapProject);
}

/**
 * The snippet *template* only — the backend can no longer supply the real
 * key here (it only ever exists as a hash after creation/rotation). The
 * caller must substitute the plaintext key it captured from the create/
 * rotate response itself; see InstallPanel in ControlRoom.tsx.
 */
export function getEmbedSnippet(projectId: string) {
  return dashboardRequest<{
    projectId: string;
    apiKeyPrefix: string | null;
    backendOrigin: string;
    snippetTemplate: string;
  }>(`/api/projects/${projectId}/embed`);
}

/* ---------- analytics / sessions / chat (dashboard session required) ---------- */

export function livepulseApi(projectId: string) {
  const get = <T = Json>(path: string) => dashboardRequest<T>(path);

  return {
    activeSessions: (windowMinutes = 5) =>
      get(`/api/sessions/${projectId}/active?windowMinutes=${windowMinutes}`),
    overview: () => get(`/api/analytics/${projectId}/overview`),
    topPages: () => get(`/api/analytics/${projectId}/top-pages`),
    breakdown: () => get(`/api/analytics/${projectId}/event-breakdown`),
    errors: () => get(`/api/analytics/${projectId}/error-clusters`),
    eventsOverTime: () => get(`/api/analytics/${projectId}/events-over-time`),
    sessionTimeline: (sessionId: string) =>
      get(`/api/analytics/${projectId}/sessions/${sessionId}/timeline`),
    chatHistory: (sessionId: string) => get(`/api/chat/${projectId}/${sessionId}/history`),
  };
}

export { getAccessToken };

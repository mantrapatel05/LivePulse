import { API_URL } from "./config";
import { getSupabase } from "./supabaseClient";
import { peekReferral, clearReferral } from "./referral";

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
  publicId?: string;
  badge?: BadgeSettings;
  aiInsights?: { enabled: boolean };
  referredBy?: string | null;
  createdAt?: string;
};

export type BadgeSettings = { enabled: boolean; minCount: number };
export type BadgeStats = {
  publicId: string | null;
  badge: BadgeSettings;
  today: { impressions: number; landingHits: number };
  last7Days: { day: string; impressions: number; landingHits: number }[];
  referralProjects: number;
};

export class ApiError extends Error {
  status: number;
  retryAfterSeconds?: number;
  resetsAt?: string;
  constructor(message: string, status: number, retryAfterSeconds?: number, resetsAt?: string) {
    super(message);
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.resetsAt = resetsAt;
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

export function createProject(
  name: string,
  referredBy: string | null | undefined = peekReferral(),
) {
  return dashboardRequest<{ project: LPProject } | LPProject>("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name, ...(referredBy ? { referredBy } : {}) }),
  }).then((r) => {
    clearReferral(); // attribution applies to the first project only
    return unwrapProject(r);
  });
}

export function updateBadge(projectId: string, patch: Partial<BadgeSettings>) {
  return dashboardRequest<{ project: LPProject }>(`/api/projects/${projectId}/badge`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  }).then((r) => r.project);
}

export function updateAiInsights(projectId: string, enabled: boolean) {
  return dashboardRequest<{ project: Pick<LPProject, "_id" | "aiInsights"> }>(
    `/api/projects/${projectId}/ai-insights`,
    { method: "PATCH", body: JSON.stringify({ enabled }) },
  ).then((response) => response.project);
}

export function getBadgeStats(projectId: string) {
  return dashboardRequest<BadgeStats>(`/api/projects/${projectId}/badge`);
}

/** Fire-and-forget: top of the referral funnel. Never throws, never awaited on a critical path. */
export function recordLandingHit(publicId: string): void {
  try {
    void fetch(`${API_URL}/api/public/${encodeURIComponent(publicId)}/landing-hit`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
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

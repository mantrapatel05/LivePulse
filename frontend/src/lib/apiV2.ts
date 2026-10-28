import { API_URL } from "./config";
import { getAccessToken, ApiError } from "./api";

export type Range = {
  from: string;
  to: string;
  timezone: string;
  label?: string;
  interval?: string;
};
export type Envelope<T> = { data: T; generatedAt: string; range: Range | null };

export type OverviewV2 = {
  totalEvents: number;
  uniqueVisitors: number;
  errors: number;
  avgEngagedSeconds: number;
  activeNow: number;
};

export type TimeseriesPoint = { bucket: string; count: number };
export type TopPageV2 = { path: string; views: number; sessions: number };
export type EventBreakdownV2 = { event_type: string; count: number };
export type ErrorClusterV2 = {
  signature: string;
  message: string;
  occurrences: number;
  affected_sessions: number;
  last_seen: string;
};
export type ActiveSessionV2 = {
  sessionId: string;
  userId: string;
  currentUrl: string;
  lastSeenAt: number;
  startedAt: number;
};
export type HistoricalSessionV2 = {
  session_id: string;
  started_at: string;
  last_seen_at: string;
  events: number;
  errors: number;
  entry_url: string;
  exit_url: string;
  engaged_seconds: number;
};
export type SessionTimelineV2 = {
  sessionId: string;
  startedAt: string;
  lastSeenAt: string;
  eventCount: number;
  errorCount: number;
  entryUrl: string;
  exitUrl: string;
  engagedSeconds: number;
  events: Array<{
    event_id: string;
    event_type: string;
    url: string;
    element: string | null;
    properties: string;
    occurred_at: string;
  }>;
};
export type ProjectHealthV2 = {
  analyticsBackend: "mongo" | "dual" | "clickhouse";
  redisOk: boolean;
  clickhouseOk: boolean;
  streamPendingCountProcessWide: number;
  liveNow: number;
};

export type EngagementDriftMetric = {
  name: "sessions" | "events" | "avg_engaged_seconds" | "rage_clicks" | "error_rate";
  cur: number;
  prev: number;
  deltaPct: number | null;
};
export type EngagementDriftPage = {
  path: string;
  cur: number;
  prev: number;
  deltaPct: number | null;
};
export type EngagementDrift = {
  status: "ok" | "watch" | "drop" | "insufficient_data";
  metrics: EngagementDriftMetric[];
  topDecliners: EngagementDriftPage[];
  summary: string;
  cached: boolean;
};

export type SessionInsight = {
  headline: string;
  narrative: string;
  outcome: "converted" | "engaged" | "bounced" | "frustrated" | "unclear";
  friction: {
    kind: string;
    note: string;
    evidenceIds: string[];
    eventIds: string[];
    evidenceRefs?: string[];
  }[];
  suggestedActions: string[];
};
export type ErrorInsight = {
  summary: string;
  likelyCause: string;
  userImpact: string;
  suggestedFix: string;
  confidence: "low" | "medium" | "high";
};
export type InsightResult<T> = {
  insight: T;
  cached: boolean;
  model: string | null;
  generatedAt: string;
  degraded?: boolean;
};
export type PendingInsightResponse = { status: "pending" };

export type DateRangePreset = "last_hour" | "last_24h" | "last_7d" | "custom";

export function presetToRange(
  preset: DateRangePreset,
  custom?: { from: string; to: string },
): { from: string; to: string } {
  const to = new Date();
  if (preset === "custom" && custom) return custom;
  const hoursBack = preset === "last_24h" ? 24 : preset === "last_7d" ? 24 * 7 : 1;
  const from = new Date(to.getTime() - hoursBack * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function v2Request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const details =
      body && typeof body === "object"
        ? (body as {
            message?: unknown;
            retryAfterSeconds?: unknown;
            resetsAt?: unknown;
          })
        : {};
    const retryHeader = Number(res.headers?.get?.("Retry-After"));
    const retryBody = Number(details.retryAfterSeconds);
    throw new ApiError(
      typeof details.message === "string" ? details.message : `Request failed (${res.status})`,
      res.status,
      Number.isFinite(retryHeader) && retryHeader > 0
        ? retryHeader
        : Number.isFinite(retryBody) && retryBody > 0
          ? retryBody
          : undefined,
      typeof details.resetsAt === "string" ? details.resetsAt : undefined,
    );
  }
  return body as T;
}

function qs(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export function analyticsV2(projectId: string) {
  const base = `/api/v2/projects/${projectId}`;

  return {
    overview: (from: string, to: string, timezone: string) =>
      v2Request<Envelope<OverviewV2>>(`${base}/overview${qs({ from, to, timezone })}`),

    timeseries: (from: string, to: string, timezone: string, interval = "hour") =>
      v2Request<Envelope<TimeseriesPoint[]>>(
        `${base}/timeseries${qs({ from, to, timezone, interval })}`,
      ),

    topPages: (from: string, to: string, timezone: string, limit = 10) =>
      v2Request<Envelope<TopPageV2[]>>(`${base}/top-pages${qs({ from, to, timezone, limit })}`),

    eventBreakdown: (from: string, to: string, timezone: string) =>
      v2Request<Envelope<EventBreakdownV2[]>>(
        `${base}/event-breakdown${qs({ from, to, timezone })}`,
      ),

    errorClusters: (from: string, to: string, timezone: string, limit = 20) =>
      v2Request<Envelope<ErrorClusterV2[]>>(
        `${base}/error-clusters${qs({ from, to, timezone, limit })}`,
      ),

    activeSessions: () =>
      v2Request<Envelope<ActiveSessionV2[]>>(`${base}/sessions${qs({ state: "active" })}`),

    historicalSessions: (from: string, to: string, timezone: string) =>
      v2Request<Envelope<HistoricalSessionV2[]>>(
        `${base}/sessions${qs({ state: "historical", from, to, timezone })}`,
      ),

    sessionTimeline: (sessionId: string) =>
      v2Request<Envelope<SessionTimelineV2>>(`${base}/sessions/${sessionId}/timeline`),

    explainSession: (sessionId: string) =>
      v2Request<Envelope<InsightResult<SessionInsight>> | PendingInsightResponse>(
        `${base}/sessions/${encodeURIComponent(sessionId)}/insight`,
        {
          method: "POST",
        },
      ),

    explainErrorCluster: (signature: string, from: string, to: string, timezone: string) =>
      v2Request<Envelope<InsightResult<ErrorInsight>> | PendingInsightResponse>(
        `${base}/error-clusters/insight`,
        {
          method: "POST",
          body: JSON.stringify({ signature, from, to, timezone }),
        },
      ),

    health: () => v2Request<Envelope<ProjectHealthV2>>(`${base}/health`),

    engagementDrift: () => v2Request<Envelope<EngagementDrift>>(`${base}/engagement-drift`),
  };
}

import { useEffect, useMemo, useState } from "react";
import type { LPProject } from "../../lib/api";
import { ApiError } from "../../lib/api";
import {
  analyticsV2,
  presetToRange,
  type DateRangePreset,
  type ErrorInsight,
  type InsightResult,
} from "../../lib/apiV2";
import { API_URL } from "../../lib/config";
import {
  getDashboardSocket,
  normaliseEvent,
  shouldRenderInStream,
  type LiveEvent,
} from "../../lib/socket";
import { clock, timeAgo, usePolling } from "../../lib/usePolling";
import { Bars, Empty, Panel, Spark, Stat } from "./Panel";
import { ChatDock } from "./ChatDock";
import { InstallPanel } from "./ControlRoom";
import { SessionTimelineDialog } from "./SessionTimelineDialog";

const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const PRESETS: { key: DateRangePreset; label: string }[] = [
  { key: "last_hour", label: "last hour" },
  { key: "last_24h", label: "24h" },
  { key: "last_7d", label: "7d" },
  { key: "custom", label: "custom" },
];

export function ControlRoomV2({ project }: { project: LPProject }) {
  const pid = project._id;
  const api = useMemo(() => analyticsV2(pid), [pid]);

  const [preset, setPreset] = useState<DateRangePreset>("last_hour");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const range = useMemo(
    () =>
      presetToRange(
        preset,
        customFrom && customTo
          ? {
              from: new Date(customFrom).toISOString(),
              to: new Date(customTo).toISOString(),
            }
          : undefined,
      ),
    [preset, customFrom, customTo],
  );

  const [sessionMode, setSessionMode] = useState<"live" | "historical">("live");
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [stream, setStream] = useState<LiveEvent[]>([]);
  const [live, setLive] = useState(false);
  const [clusterInsightState, setClusterInsightState] = useState<
    Record<
      string,
      {
        result?: InsightResult<ErrorInsight>;
        error?: string;
        loading?: boolean;
      }
    >
  >({});

  const overview = usePolling(
    () => api.overview(range.from, range.to, TIMEZONE),
    [api, range.from, range.to],
    15000,
  );
  const timeseries = usePolling(
    () => api.timeseries(range.from, range.to, TIMEZONE),
    [api, range.from, range.to],
    30000,
  );
  const topPages = usePolling(
    () => api.topPages(range.from, range.to, TIMEZONE),
    [api, range.from, range.to],
    30000,
  );
  const breakdown = usePolling(
    () => api.eventBreakdown(range.from, range.to, TIMEZONE),
    [api, range.from, range.to],
    30000,
  );
  const errorClusters = usePolling(
    () => api.errorClusters(range.from, range.to, TIMEZONE),
    [api, range.from, range.to],
    20000,
  );
  const health = usePolling(() => api.health(), [api], 15000);

  const liveSessions = usePolling(() => api.activeSessions(), [api], 8000);
  const historicalSessions = usePolling(
    () => api.historicalSessions(range.from, range.to, TIMEZONE),
    [api, range.from, range.to],
    30000,
  );

  type HealthPush = {
    redisOk: boolean;
    clickhouseOk: boolean;
    streamPendingCountProcessWide: number;
  };
  const [liveHealthPush, setLiveHealthPush] = useState<HealthPush | null>(null);

  useEffect(() => {
    const socket = getDashboardSocket();
    const joinThisProject = () => {
      socket.emit("join_project", { projectId: pid }, (ack: { ok: boolean }) => setLive(!!ack?.ok));
    };
    const onConnect = () => joinThisProject();
    const onDisconnect = () => setLive(false);
    const onHealth = (payload: HealthPush) => setLiveHealthPush(payload);
    const onAny = (name: string, payload: unknown) => {
      if (!shouldRenderInStream(name)) return;
      setStream((s) => [normaliseEvent(name, payload), ...s].slice(0, 120));
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("system:health", onHealth);
    socket.onAny(onAny);
    if (socket.connected) joinThisProject();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("system:health", onHealth);
      socket.offAny(onAny);
    };
  }, [pid]);

  const ov = overview.data?.data;
  const health_ = liveHealthPush ?? health.data?.data;
  const healthTone: "ok" | "warn" | "bad" = !health_
    ? "warn"
    : health_.redisOk && health_.clickhouseOk
      ? "ok"
      : health_.redisOk
        ? "warn"
        : "bad";

  const timePoints = (timeseries.data?.data ?? []).map((p) => p.count);
  const pageRows = (topPages.data?.data ?? []).slice(0, 7).map((p, i) => ({
    key: p.path || String(i),
    label: p.path || "unknown",
    value: p.views,
    sub: String(p.views),
  }));
  const breakdownRows = (breakdown.data?.data ?? []).map((b, i) => ({
    key: b.event_type || String(i),
    label: b.event_type,
    value: b.count,
  }));
  const errorRows = errorClusters.data?.data ?? [];
  const sessionRows = sessionMode === "live" ? (liveSessions.data?.data ?? []) : [];
  const historicalRows = sessionMode === "historical" ? (historicalSessions.data?.data ?? []) : [];

  async function explainCluster(signature: string) {
    setClusterInsightState((current) => ({
      ...current,
      [signature]: { loading: true },
    }));
    try {
      const response = await api.explainErrorCluster(signature, range.from, range.to, TIMEZONE);
      if (!("data" in response)) {
        setClusterInsightState((current) => ({
          ...current,
          [signature]: {
            error: "This error is already being explained in another tab. Try again shortly.",
          },
        }));
        return;
      }
      setClusterInsightState((current) => ({
        ...current,
        [signature]: { result: response.data },
      }));
    } catch (error) {
      let message = error instanceof Error ? error.message : "Couldn't explain this error cluster.";
      if (error instanceof ApiError && error.status === 403)
        message = "AI insights are off. Enable them in Install settings.";
      if (error instanceof ApiError && error.status === 409)
        message = "Explain is available after this project is migrated to ClickHouse.";
      if (error instanceof ApiError && error.status === 429)
        message = error.retryAfterSeconds
          ? `Rate limit reached. Try again in ${error.retryAfterSeconds} seconds.`
          : error.resetsAt
            ? `Daily limit reached. Resets at ${new Date(error.resetsAt).toLocaleTimeString()}.`
            : "The AI insight limit has been reached. Try again later.";
      setClusterInsightState((current) => ({
        ...current,
        [signature]: { error: message },
      }));
    }
  }

  return (
    <div className="lp-room">
      <div className="lp-room-bar lp-v2-bar">
        <span className={`lp-chip ${live ? "" : "is-off"}`}>
          <i /> {live ? "collector live" : "collector offline"}
        </span>
        <span className={`lp-chip lp-health-${healthTone}`} title={healthDescription(health_)}>
          <i /> pipeline{" "}
          {healthTone === "ok" ? "healthy" : healthTone === "warn" ? "degraded" : "down"}
        </span>

        <div className="lp-range-control">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={preset === p.key ? "is-active" : ""}
              onClick={() => setPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
          {preset === "custom" && (
            <>
              <input
                type="datetime-local"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
              <input
                type="datetime-local"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </>
          )}
        </div>

        <span className="lp-room-bar-meta">
          {TIMEZONE} · updated {overview.data ? timeAgo(overview.data.generatedAt) : "—"} ·{" "}
          {API_URL}
        </span>
      </div>

      <div className="lp-stat-deck">
        <Stat
          label="live now"
          value={ov?.activeNow ?? 0}
          tone="signal"
          hint="via redis, real-time"
        />
        <Stat label="events" value={(ov?.totalEvents ?? 0).toLocaleString()} hint="in range" />
        <Stat
          label="visitors"
          value={(ov?.uniqueVisitors ?? 0).toLocaleString()}
          hint="unique, in range"
        />
        <Stat
          label="errors"
          value={(ov?.errors ?? 0).toLocaleString()}
          tone={(ov?.errors ?? 0) > 0 ? "pulse" : undefined}
          hint="in range"
        />
        <Stat
          label="avg engaged"
          value={ov?.avgEngagedSeconds ? `${ov.avgEngagedSeconds}s` : "—"}
          hint="time on page"
        />
      </div>

      <div className="lp-grid">
        <Panel
          label="sessions"
          title={
            sessionMode === "live"
              ? `${sessionRows.length} live`
              : `${historicalRows.length} in range`
          }
          right={
            <div className="lp-mode-toggle">
              <button
                type="button"
                className={sessionMode === "live" ? "is-active" : ""}
                onClick={() => setSessionMode("live")}
              >
                live
              </button>
              <button
                type="button"
                className={sessionMode === "historical" ? "is-active" : ""}
                onClick={() => setSessionMode("historical")}
              >
                historical
              </button>
            </div>
          }
          className="span-4"
        >
          {sessionMode === "live" ? (
            sessionRows.length === 0 ? (
              <Empty>No visitors in the last 5 minutes.</Empty>
            ) : (
              <ul className="lp-sessions">
                {sessionRows.map((s) => (
                  <li key={s.sessionId} onClick={() => setOpenSessionId(s.sessionId)}>
                    <span className="lp-dot" />
                    <span className="lp-sess-main">
                      <b>{s.currentUrl || "/"}</b>
                      <small>
                        {s.sessionId.slice(0, 8)} · {s.userId}
                      </small>
                    </span>
                    <span className="lp-sess-time">{timeAgo(s.lastSeenAt)}</span>
                  </li>
                ))}
              </ul>
            )
          ) : historicalRows.length === 0 ? (
            <Empty>No sessions found in this range.</Empty>
          ) : (
            <ul className="lp-sessions">
              {historicalRows.map((s) => (
                <li key={s.session_id} onClick={() => setOpenSessionId(s.session_id)}>
                  <span className="lp-dot" />
                  <span className="lp-sess-main">
                    <b>{s.entry_url || "/"}</b>
                    <small>
                      {s.session_id.slice(0, 8)} · {s.events} events · {s.errors} errors
                    </small>
                  </span>
                  <span className="lp-sess-time">{timeAgo(s.last_seen_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel label="event stream" title="raw wire" className="span-8">
          {stream.length === 0 ? (
            <Empty>
              Waiting on the socket at <code>{API_URL}</code>.
            </Empty>
          ) : (
            <ul className="lp-stream">
              {stream.map((e) => (
                <li key={e.id}>
                  <span className="t">{clock(e.at)}</span>
                  <span className={`lp-k ${e.kind}`}>{e.kind}</span>
                  <span className="lp-stream-name">{e.name}</span>
                  <span className="lp-stream-label">{e.label}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel label="top pages" className="span-4">
          {pageRows.length === 0 ? (
            <Empty>No page views in this range.</Empty>
          ) : (
            <Bars rows={pageRows} />
          )}
        </Panel>

        <Panel label="events over time" title={rangeLabel(preset)} className="span-4">
          <div className="lp-spark-wrap">
            <Spark points={timePoints} />
            <span className="lp-stat-hint">{timePoints.length} buckets</span>
          </div>
        </Panel>

        <Panel label="event breakdown" className="span-4">
          {breakdownRows.length === 0 ? (
            <Empty>No events in this range.</Empty>
          ) : (
            <Bars rows={breakdownRows} />
          )}
        </Panel>

        <Panel label="error clusters" title="last seen first" className="span-6">
          {errorRows.length === 0 ? (
            <Empty>No errors captured in this range.</Empty>
          ) : (
            <ul className="lp-errors">
              {errorRows.map((e) => (
                <li key={e.signature} className="lp-error-insight-row">
                  <b>{e.message || e.signature}</b>
                  <small>
                    ×{e.occurrences} affecting {e.affected_sessions} visitor
                    {e.affected_sessions === 1 ? "" : "s"}
                  </small>
                  <button
                    type="button"
                    className="lp-btn-link"
                    disabled={!!clusterInsightState[e.signature]?.loading}
                    onClick={() => void explainCluster(e.signature)}
                  >
                    {clusterInsightState[e.signature]?.loading
                      ? "explaining…"
                      : clusterInsightState[e.signature]?.result
                        ? "explain again"
                        : "explain"}
                  </button>
                  {clusterInsightState[e.signature]?.loading && (
                    <div
                      className="lp-ai-loading"
                      role="status"
                      aria-label="Generating error insight"
                    >
                      <span />
                      <span />
                      <span />
                    </div>
                  )}
                  {clusterInsightState[e.signature]?.error && (
                    <div className="lp-alert" role="alert">
                      {clusterInsightState[e.signature]?.error}
                    </div>
                  )}
                  {clusterInsightState[e.signature]?.result && (
                    <ErrorInsightView result={clusterInsightState[e.signature]!.result!} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          label="visitor channel"
          title={openSessionId ? openSessionId.slice(0, 12) : "no session"}
          className="span-6"
        >
          <ChatDock projectId={pid} sessionId={openSessionId} />
        </Panel>

        <InstallPanel project={project} />
      </div>

      {openSessionId && (
        <SessionTimelineDialog
          projectId={pid}
          sessionId={openSessionId}
          onClose={() => setOpenSessionId(null)}
        />
      )}
    </div>
  );
}

function ErrorInsightView({ result }: { result: InsightResult<ErrorInsight> }) {
  const insight = result.insight;
  return (
    <div className="lp-ai-insight lp-ai-error-insight" aria-live="polite">
      <div className="lp-ai-result-meta">
        <span className="lp-ai-tag">{insight.confidence} confidence</span>
        {result.cached && <span className="lp-ai-tag">cached</span>}
        {result.degraded && (
          <span className="lp-ai-tag is-warn">basic summary · AI unavailable</span>
        )}
      </div>
      <h4>{insight.summary}</h4>
      <p>
        <b>Likely cause</b> {insight.likelyCause}
      </p>
      <p>
        <b>User impact</b> {insight.userImpact}
      </p>
      <p>
        <b>Suggested fix</b> {insight.suggestedFix}
      </p>
      <small className="lp-ai-disclaimer">AI-generated. Verify against the timeline.</small>
    </div>
  );
}

function rangeLabel(preset: DateRangePreset): string {
  if (preset === "last_hour") return "last hour, hourly buckets";
  if (preset === "last_24h") return "24h, hourly buckets";
  if (preset === "last_7d") return "7 days, hourly buckets";
  return "custom range";
}

function healthDescription(
  h:
    | {
        redisOk: boolean;
        clickhouseOk: boolean;
        streamPendingCountProcessWide: number;
      }
    | undefined,
): string {
  if (!h) return "Health unknown — waiting for first check.";
  const parts = [
    `redis ${h.redisOk ? "up" : "down"}`,
    `clickhouse ${h.clickhouseOk ? "up" : "down"}`,
    `${h.streamPendingCountProcessWide} pending in queue`,
  ];
  return parts.join(" · ");
}

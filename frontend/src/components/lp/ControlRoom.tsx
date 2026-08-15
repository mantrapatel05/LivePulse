import { useEffect, useMemo, useState } from "react";
import type { LPProject } from "../../lib/api";
import { livepulseApi, getEmbedSnippet, rotateKey } from "../../lib/api";
import { API_URL } from "../../lib/config";
import { getDashboardSocket, normaliseEvent, type LiveEvent } from "../../lib/socket";
import { clock, num, timeAgo, toArray, usePolling } from "../../lib/usePolling";
import { Bars, Empty, Panel, Spark, Stat } from "./Panel";
import { ChatDock } from "./ChatDock";

type Row = Record<string, unknown>;
type Session = {
  id: string;
  page?: string;
  country?: string;
  device?: string;
  lastSeen?: string | number;
  startedAt?: string | number;
};

function readSession(raw: Row, i: number): Session {
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;
  const geo = raw?.geo as Row | undefined;

  return {
    id: String(raw?.sessionId ?? raw?._id ?? raw?.id ?? `s${i}`),
    page:
      str(raw?.currentUrl) ??
      str(raw?.currentPage) ??
      str(raw?.page) ??
      str(raw?.path) ??
      str(raw?.url),
    country: str(raw?.city) ?? str(raw?.country) ?? str(geo?.country) ?? str(raw?.location),
    device: str(raw?.device) ?? str(raw?.deviceType) ?? str(raw?.browser),
    lastSeen: (raw?.lastSeenAt ?? raw?.lastSeen ?? raw?.updatedAt ?? raw?.timestamp) as
      string | number | undefined,
    startedAt: (raw?.startedAt ?? raw?.createdAt) as string | number | undefined,
  };
}

export function ControlRoom({ project }: { project: LPProject }) {
  const pid = project._id;
  const api = useMemo(() => livepulseApi(pid), [pid]);

  const sessions = usePolling(() => api.activeSessions(5), [api], 8000);
  const overview = usePolling(() => api.overview(), [api], 15000);
  const topPages = usePolling(() => api.topPages(), [api], 30000);
  const breakdown = usePolling(() => api.breakdown(), [api], 30000);
  const errors = usePolling(() => api.errors(), [api], 20000);
  const overTime = usePolling(() => api.eventsOverTime(), [api], 30000);

  const [stream, setStream] = useState<LiveEvent[]>([]);
  const [live, setLive] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  /* live wire — dashboard socket, authenticated with the Supabase session */
  useEffect(() => {
    const socket = getDashboardSocket();

    const joinThisProject = () => {
      socket.emit("join_project", { projectId: pid }, (ack: { ok: boolean }) => {
        setLive(!!ack?.ok);
      });
    };

    const onConnect = () => joinThisProject();
    const onDisconnect = () => setLive(false);
    const onAny = (name: string, payload: unknown) => {
      if (["connect", "disconnect", "connect_error", "joined"].includes(name)) return;
      setStream((s) => [normaliseEvent(name, payload), ...s].slice(0, 120));
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.onAny(onAny);
    if (socket.connected) joinThisProject();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.offAny(onAny);
    };
  }, [pid]);

  const sessionRows = toArray<Row>(sessions.data, "sessions", "active").map(readSession);
  const ov = (overview.data ?? {}) as Row;
  const totalEvents = num(ov.totalEvents ?? ov.events ?? ov.total);
  const uniqueVisitors = num(ov.uniqueVisitors ?? ov.visitors ?? ov.uniqueSessions);
  const errorCount = num(
    ov.errors ?? ov.errorCount ?? toArray(errors.data, "errors", "clusters").length,
  );
  const avgDuration = num(ov.avgEngagedSeconds ?? ov.avgSessionDuration ?? ov.avgDuration);

  const pageRows = toArray<Row>(topPages.data, "pages", "topPages")
    .slice(0, 7)
    .map((p, i) => ({
      key: String(p?.url ?? p?.path ?? p?._id ?? i),
      label: String(p?.url ?? p?.path ?? p?.page ?? p?._id ?? "unknown"),
      value: num(p?.views ?? p?.count ?? p?.total),
      sub: String(num(p?.views ?? p?.count ?? p?.total)),
    }));

  const bd = (breakdown.data ?? {}) as Row;
  const breakdownRows = toArray<Row>(bd, "breakdown").map((b, i) => ({
    key: String(b?.eventType ?? i),
    label: String(b?.eventType ?? "unknown"),
    value: num(b?.count),
  }));

  const errorRows = toArray<Row>(errors.data, "errors", "clusters").slice(0, 8);
  const timePoints = toArray<Row>(overTime.data, "points", "buckets", "series").map((p) =>
    num(p?.count ?? p?.value ?? p?.total),
  );

  const anySignal = totalEvents > 0 || sessionRows.length > 0 || stream.length > 0;

  return (
    <div className="lp-room">
      <div className="lp-room-bar">
        <span className={`lp-chip ${live ? "" : "is-off"}`}>
          <i /> {live ? "collector live" : "collector offline"}
        </span>
        <span className="lp-room-bar-meta">
          {project.name} · <code>{pid}</code> · {API_URL}
        </span>
      </div>

      <div className="lp-stat-deck">
        <Stat label="live now" value={sessionRows.length} tone="signal" hint="5 min window" />
        <Stat label="events" value={totalEvents.toLocaleString()} hint="today" />
        <Stat label="visitors" value={uniqueVisitors.toLocaleString()} hint="unique, today" />
        <Stat
          label="errors"
          value={errorCount.toLocaleString()}
          tone={errorCount > 0 ? "pulse" : undefined}
          hint="captured, today"
        />
        <Stat
          label="avg engaged"
          value={avgDuration ? `${Math.round(avgDuration)}s` : "—"}
          hint="time on page"
        />
      </div>

      {!anySignal && !sessions.loading && (
        <div className="lp-alert warn" role="status">
          <b>No traffic captured yet</b>
          Drop the snippet below into your site and the panels fill themselves. Nothing here is
          simulated — empty means empty.
        </div>
      )}

      <div className="lp-grid">
        <Panel
          label="live sessions"
          title={`${sessionRows.length} on site`}
          right={sessions.error ? <span className="lp-err-text">offline</span> : null}
          className="span-4"
        >
          {sessionRows.length === 0 ? (
            <Empty>{sessions.error ?? "No visitors in the last 5 minutes."}</Empty>
          ) : (
            <ul className="lp-sessions">
              {sessionRows.map((s) => (
                <li
                  key={s.id}
                  className={selected === s.id ? "is-active" : ""}
                  onClick={() => setSelected(s.id)}
                >
                  <span className="lp-dot" />
                  <span className="lp-sess-main">
                    <b>{s.page ?? "/"}</b>
                    <small>
                      {s.id.slice(0, 8)} · {s.country ?? "??"} · {s.device ?? "unknown"}
                    </small>
                  </span>
                  <span className="lp-sess-time">{timeAgo(s.lastSeen)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel label="event stream" title="raw wire" className="span-8">
          {stream.length === 0 ? (
            <Empty>
              Waiting on the socket at <code>{API_URL}</code>. Every event the collector emits shows
              up here the moment it lands.
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
          {pageRows.length === 0 ? <Empty>No page views yet.</Empty> : <Bars rows={pageRows} />}
        </Panel>

        <Panel label="events over time" className="span-4">
          <div className="lp-spark-wrap">
            <Spark points={timePoints} />
            <span className="lp-stat-hint">{timePoints.length} buckets</span>
          </div>
        </Panel>

        <Panel label="event breakdown" className="span-4">
          {breakdownRows.length === 0 ? (
            <Empty>No events yet.</Empty>
          ) : (
            <Bars rows={breakdownRows} />
          )}
        </Panel>

        <Panel label="error clusters" title="last seen first" className="span-6">
          {errorRows.length === 0 ? (
            <Empty>No errors captured. Long may it last.</Empty>
          ) : (
            <ul className="lp-errors">
              {errorRows.map((e: Row, i: number) => (
                <li key={String(e?.message ?? i)}>
                  <b>{String(e?.message ?? "Unknown error")}</b>
                  <small>
                    ×{num(e?.occurrences, 1)} affecting {num(e?.affectedUsers, 1)} visitor
                    {num(e?.affectedUsers, 1) === 1 ? "" : "s"}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          label="visitor channel"
          title={selected ? selected.slice(0, 12) : "no session"}
          className="span-6"
        >
          <ChatDock projectId={pid} sessionId={selected} />
        </Panel>

        <InstallPanel projectId={pid} />
      </div>
    </div>
  );
}

function InstallPanel({ projectId }: { projectId: string }) {
  const [snippet, setSnippet] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);

  async function load() {
    setError(null);
    try {
      const res = await getEmbedSnippet(projectId);
      setSnippet(res.snippet);
      setApiKey(res.apiKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the embed snippet.");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function copy() {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard permission denied — the <pre> is still selectable by hand
    }
  }

  async function rotate() {
    if (!confirm("Rotate this project's API key? The old key stops working immediately.")) return;
    setRotating(true);
    try {
      await rotateKey(projectId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't rotate the key.");
    } finally {
      setRotating(false);
    }
  }

  return (
    <Panel
      label="install"
      title="one script tag"
      className="span-12"
      right={
        <button
          type="button"
          className="lp-btn-link"
          onClick={() => void rotate()}
          disabled={rotating}
        >
          {rotating ? "rotating…" : "rotate key"}
        </button>
      }
    >
      {error && (
        <div className="lp-alert" role="alert">
          <b>Couldn't load install snippet</b>
          {error}
        </div>
      )}
      {snippet && (
        <>
          <pre className="lp-code">{snippet}</pre>
          <button type="button" className="lp-btn small" onClick={() => void copy()}>
            {copied ? "copied ✓" : "copy snippet"}
          </button>
          <p className="lp-empty">
            API key <code>{apiKey}</code> — treat it as public; it only writes events and never
            reads your data. Chat is enabled by default; drop <code>data-chat="false"</code> to
            disable it.
          </p>
        </>
      )}
    </Panel>
  );
}

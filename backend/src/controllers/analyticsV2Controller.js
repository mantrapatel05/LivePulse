const {
  buildOverviewQuery,
  buildTimeseriesQuery,
  buildTopPagesQuery,
  buildEventBreakdownQuery,
  buildErrorClustersRangeQuery,
  buildHistoricalSessionsQuery,
  buildSessionSummaryQuery,
  buildSessionTimelineEventsQuery,
  runQuery,
} = require("../shared/analyticsQueries");
const { getRedisClient } = require("../shared/redisClient");
const { listActiveSessions, activeCount } = require("../shared/activeSessionState");
const { checkRedisReady } = require("../shared/redisClient");
const { checkClickhouseReady } = require("../shared/clickhouseClient");
const { pendingCount } = require("../shared/redisStream");

const DEFAULT_TIMEZONE = "UTC";

function clickhouseDateTime(value) {
  return new Date(value).toISOString().replace("T", " ").replace("Z", "");
}

function parseRange(req, res) {
  const { from, to } = req.query;
  const timezone = req.query.timezone || DEFAULT_TIMEZONE;
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!from || !to || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
    res.status(400).json({ message: "Provide valid from and to dates, with from earlier than to." });
    return null;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    res.status(400).json({ message: "Provide a valid IANA timezone." });
    return null;
  }
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();
  return {
    from: clickhouseDateTime(fromIso),
    to: clickhouseDateTime(toIso),
    timezone,
    responseRange: { from: fromIso, to: toIso, timezone },
  };
}

function parseLimit(req, res, fallback, max = 100) {
  const raw = req.query.limit;
  if (raw === undefined) return fallback;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    res.status(400).json({ message: `limit must be an integer between 1 and ${max}.` });
    return null;
  }
  return limit;
}

function clickhouseOnly(req, res) {
  if (req.project.analyticsBackend !== "clickhouse") {
    res.status(409).json({ message: "V2 analytics is available after this project is migrated to ClickHouse." });
    return false;
  }
  return true;
}

function respond(res, data, range = null) {
  return res.json({ data, generatedAt: new Date().toISOString(), range });
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function iso(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    // ClickHouse JSONEachRow commonly returns DateTime64 without a timezone.
    const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
    const parsed = new Date(normalized);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return value == null ? "" : String(value);
}

function projectId(req) {
  return String(req.project._id);
}

async function getOverview(req, res) {
  if (!clickhouseOnly(req, res)) return;
  const range = parseRange(req, res);
  if (!range) return;
  const [rows, activeNow] = await Promise.all([
    runQuery(buildOverviewQuery({ projectId: projectId(req), ...range }), "v2_overview"),
    activeCount(getRedisClient(), projectId(req)),
  ]);
  const row = rows[0] || {};
  return respond(res, {
    totalEvents: number(row.total_events),
    uniqueVisitors: number(row.unique_visitors),
    errors: number(row.errors),
    avgEngagedSeconds: number(row.avg_engaged_seconds),
    activeNow: number(activeNow),
  }, range.responseRange);
}

async function getTimeseries(req, res) {
  if (!clickhouseOnly(req, res)) return;
  const range = parseRange(req, res);
  if (!range) return;
  const interval = req.query.interval || "hour";
  if (!["minute", "hour", "day"].includes(interval)) {
    return res.status(400).json({ message: "interval must be minute, hour, or day." });
  }
  const rows = await runQuery(buildTimeseriesQuery({ projectId: projectId(req), ...range, interval }), "v2_timeseries");
  return respond(res, rows.map((row) => ({ bucket: iso(row.bucket), count: number(row.count) })), { ...range.responseRange, interval });
}

async function getTopPages(req, res) {
  if (!clickhouseOnly(req, res)) return;
  const range = parseRange(req, res);
  if (!range) return;
  const limit = parseLimit(req, res, 10);
  if (!limit) return;
  const rows = await runQuery(buildTopPagesQuery({ projectId: projectId(req), ...range, limit }), "v2_top_pages");
  return respond(res, rows.map((row) => ({ path: row.path || "", views: number(row.views), sessions: number(row.sessions) })), range.responseRange);
}

async function getEventBreakdown(req, res) {
  if (!clickhouseOnly(req, res)) return;
  const range = parseRange(req, res);
  if (!range) return;
  const rows = await runQuery(buildEventBreakdownQuery({ projectId: projectId(req), ...range }), "v2_event_breakdown");
  return respond(res, rows.map((row) => ({ event_type: row.event_type || "", count: number(row.count) })), range.responseRange);
}

async function getErrorClusters(req, res) {
  if (!clickhouseOnly(req, res)) return;
  const range = parseRange(req, res);
  if (!range) return;
  const limit = parseLimit(req, res, 20);
  if (!limit) return;
  const rows = await runQuery(buildErrorClustersRangeQuery({ projectId: projectId(req), ...range, limit }), "v2_error_clusters");
  const data = rows.map((row) => ({
    signature: row.signature || "",
    message: row.message || "",
    occurrences: number(row.occurrences),
    affected_sessions: number(row.affected_sessions),
    last_seen: iso(row.last_seen),
  }));
  return respond(res, data, range.responseRange);
}

async function getSessions(req, res) {
  if (!clickhouseOnly(req, res)) return;
  const state = req.query.state || "active";
  if (state === "active") {
    const sessions = await listActiveSessions(getRedisClient(), projectId(req));
    return respond(res, sessions);
  }
  if (state !== "historical") return res.status(400).json({ message: "state must be active or historical." });
  const range = parseRange(req, res);
  if (!range) return;
  const limit = parseLimit(req, res, 100);
  if (!limit) return;
  const rows = await runQuery(buildHistoricalSessionsQuery({ projectId: projectId(req), ...range, limit }), "v2_historical_sessions");
  const data = rows.map((row) => ({
    session_id: row.session_id || "",
    started_at: iso(row.started_at),
    last_seen_at: iso(row.last_seen_at),
    events: number(row.events),
    errors: number(row.errors),
    entry_url: row.entry_url || "",
    exit_url: row.exit_url || "",
    engaged_seconds: number(row.engaged_seconds),
  }));
  return respond(res, data, range.responseRange);
}

async function getSessionTimeline(req, res) {
  if (!clickhouseOnly(req, res)) return;
  const sessionId = req.params.sessionId;
  if (!sessionId || sessionId.length > 256) return res.status(400).json({ message: "Invalid sessionId." });
  const id = projectId(req);
  const summaries = await runQuery(buildSessionSummaryQuery({ projectId: id, sessionId }), "v2_session_summary");
  const summary = summaries[0];
  if (!summary || summary.started_at == null) return res.status(404).json({ message: "Session not found." });
  const startedAt = iso(summary.started_at);
  const lastSeenAt = iso(summary.last_seen_at);
  const rows = await runQuery(buildSessionTimelineEventsQuery({
    projectId: id,
    sessionId,
    startedAt: clickhouseDateTime(startedAt),
    lastSeenAt: clickhouseDateTime(lastSeenAt),
  }), "v2_session_timeline");
  const data = {
    sessionId,
    startedAt,
    lastSeenAt,
    eventCount: number(summary.events),
    errorCount: number(summary.errors),
    entryUrl: summary.entry_url || "",
    exitUrl: summary.exit_url || "",
    engagedSeconds: number(summary.engaged_seconds),
    events: rows.map((row) => ({
      event_id: row.event_id || "",
      event_type: row.event_type || "",
      url: row.url || "",
      element: row.element == null ? null : row.element,
      properties: typeof row.properties === "string" ? row.properties : JSON.stringify(row.properties || {}),
      occurred_at: iso(row.occurred_at),
    })),
  };
  return respond(res, data, { from: startedAt, to: lastSeenAt, timezone: DEFAULT_TIMEZONE });
}

async function getProjectHealth(req, res) {
  if (!clickhouseOnly(req, res)) return;
  const redis = getRedisClient();
  const [redisOk, clickhouseOk, streamPendingCountProcessWide, liveNow] = await Promise.all([
    checkRedisReady(), checkClickhouseReady(), pendingCount(redis), activeCount(redis, projectId(req)),
  ]);
  return respond(res, {
    analyticsBackend: req.project.analyticsBackend,
    redisOk: Boolean(redisOk),
    clickhouseOk: Boolean(clickhouseOk),
    streamPendingCountProcessWide: number(streamPendingCountProcessWide),
    liveNow: number(liveNow),
  });
}

module.exports = {
  getOverview,
  getTimeseries,
  getTopPages,
  getEventBreakdown,
  getErrorClusters,
  getSessions,
  getSessionTimeline,
  getProjectHealth,
};

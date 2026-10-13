const { getClickhouseClient } = require("./clickhouseClient");
let queryLatency;
try {
  ({ queryLatency } = require("./metrics"));
} catch {
  queryLatency = { startTimer: () => () => {} };
}

// Query builders return pure { query, query_params } using native ClickHouse parameter bindings.
// Pure functions with no I/O, allowing standalone unit testing without database access.

function buildOverviewQuery({ projectId, from, to }) {
  return {
    query: `
      SELECT
        count()                                                        AS total_events,
        uniqExact(session_id)                                          AS unique_visitors,
        countIf(event_type = 'error')                                  AS errors,
        avgIf(JSONExtract(properties, 'seconds', 'Nullable(Float64)'), event_type = 'time_on_page') AS avg_engaged_seconds
      FROM events_v2
      WHERE project_id = {projectId:String}
        AND occurred_at >= {from:DateTime64(3)}
        AND occurred_at <  {to:DateTime64(3)}
    `,
    query_params: { projectId, from, to },
  };
}

function buildTimeseriesQuery({ projectId, from, to, interval = "hour", timezone = "UTC" }) {
  const bucketExpr =
    interval === "day"
      ? `toStartOfDay(minute, {timezone:String})`
      : interval === "minute"
        ? "minute"
        : `toStartOfHour(minute, {timezone:String})`;

  return {
    query: `
      SELECT
        ${bucketExpr} AS bucket,
        sum(event_count) AS count
      FROM event_minute_agg_v2
      WHERE project_id = {projectId:String}
        AND minute >= {from:DateTime64(3)}
        AND minute <  {to:DateTime64(3)}
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
    query_params: { projectId, from, to, timezone },
  };
}

function buildTopPagesQuery({ projectId, from, to, limit = 10 }) {
  return {
    query: `
      SELECT
        url_path AS path,
        count() AS views,
        uniqExact(session_id) AS sessions
      FROM events_v2
      WHERE project_id = {projectId:String}
        AND event_type = 'page_view'
        AND occurred_at >= {from:DateTime64(3)}
        AND occurred_at <  {to:DateTime64(3)}
      GROUP BY path
      ORDER BY views DESC
      LIMIT {limit:UInt32}
    `,
    query_params: { projectId, from, to, limit },
  };
}

function buildEventBreakdownQuery({ projectId, from, to }) {
  return {
    query: `
      SELECT
        event_type,
        sum(event_count) AS count
      FROM event_minute_agg_v2
      WHERE project_id = {projectId:String}
        AND minute >= {from:DateTime64(3)}
        AND minute <  {to:DateTime64(3)}
      GROUP BY event_type
      ORDER BY count DESC
    `,
    query_params: { projectId, from, to },
  };
}

function buildErrorClustersQuery({ projectId, from, limit = 20 }) {
  return {
    query: `
      SELECT
        signature,
        any(sample_message)          AS message,
        countMerge(occurrences)      AS occurrences,
        uniqMerge(affected_sessions) AS affected_sessions,
        max(last_seen)               AS last_seen
      FROM error_clusters_v2
      WHERE project_id = {projectId:String}
        AND event_month >= toStartOfMonth({from:DateTime64(3)})
      GROUP BY signature
      ORDER BY last_seen DESC
      LIMIT {limit:UInt32}
    `,
    query_params: { projectId, from, limit },
  };
}

function buildHistoricalSessionsQuery({ projectId, from, to, limit = 100 }) {
  return {
    query: `
      SELECT
        session_id,
        min(session_start)          AS started_at,
        max(session_end)            AS last_seen_at,
        countMerge(event_count)     AS events,
        countIfMerge(error_count)   AS errors,
        argMinMerge(entry_url)      AS entry_url,
        argMaxMerge(exit_url)       AS exit_url,
        sumIfMerge(engaged_seconds) AS engaged_seconds
      FROM session_summary_v2
      WHERE project_id = {projectId:String}
        AND event_month >= toStartOfMonth({from:DateTime64(3)})
        AND event_month <= toStartOfMonth({to:DateTime64(3)})
      GROUP BY project_id, session_id
      HAVING started_at >= {from:DateTime64(3)} AND started_at < {to:DateTime64(3)}
      ORDER BY started_at DESC
      LIMIT {limit:UInt32}
    `,
    query_params: { projectId, from, to, limit },
  };
}

// Step 1: Look up session summary to determine the time boundaries for the session.
function buildSessionSummaryQuery({ projectId, sessionId }) {
  return {
    query: `
      SELECT
        min(session_start)          AS started_at,
        max(session_end)            AS last_seen_at,
        countMerge(event_count)     AS events,
        countIfMerge(error_count)   AS errors,
        argMinMerge(entry_url)      AS entry_url,
        argMaxMerge(exit_url)       AS exit_url,
        sumIfMerge(engaged_seconds) AS engaged_seconds
      FROM session_summary_v2
      WHERE project_id = {projectId:String} AND session_id = {sessionId:String}
      GROUP BY project_id, session_id
    `,
    query_params: { projectId, sessionId },
  };
}

// Step 2: Fetch raw events within the session's time window (padded by 1s for clock skew).
// Avoids full-partition scans by bounding occurred_at before filtering on session_id.
function buildSessionTimelineEventsQuery({ projectId, sessionId, startedAt, lastSeenAt }) {
  return {
    query: `
      SELECT event_id, event_type, url, element, properties, occurred_at
      FROM events_v2
      WHERE project_id = {projectId:String}
        AND session_id = {sessionId:String}
        AND occurred_at >= subtractSeconds({startedAt:DateTime64(3)}, 1)
        AND occurred_at <= addSeconds({lastSeenAt:DateTime64(3)}, 1)
      ORDER BY occurred_at ASC
      LIMIT 2000
    `,
    query_params: { projectId, sessionId, startedAt, lastSeenAt },
  };
}

async function runQuery({ query, query_params }, endpointLabel) {
  const client = getClickhouseClient();
  const end = queryLatency.startTimer({ endpoint: endpointLabel });
  try {
    const result = await client.query({ query, query_params, format: "JSONEachRow" });
    return await result.json();
  } finally {
    end();
  }
}

module.exports = {
  buildOverviewQuery,
  buildTimeseriesQuery,
  buildTopPagesQuery,
  buildEventBreakdownQuery,
  buildErrorClustersQuery,
  buildHistoricalSessionsQuery,
  buildSessionSummaryQuery,
  buildSessionTimelineEventsQuery,
  runQuery,
};

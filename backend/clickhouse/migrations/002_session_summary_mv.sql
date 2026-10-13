-- 002_session_summary_mv.sql: Pre-aggregated per-session rollup table and MV.
-- Tracks session duration, event/error counts, entry/exit URLs, and engagement time.

CREATE TABLE IF NOT EXISTS session_summary_v2
(
    project_id       String,
    session_id       String,
    event_month      Date,
    session_start    SimpleAggregateFunction(min, DateTime64(3)),
    session_end      SimpleAggregateFunction(max, DateTime64(3)),
    event_count      AggregateFunction(count),
    error_count      AggregateFunction(countIf, UInt8),
    entry_url        AggregateFunction(argMin, String, DateTime64(3)),
    exit_url         AggregateFunction(argMax, String, DateTime64(3)),
    engaged_seconds  AggregateFunction(sumIf, Nullable(Float64), UInt8)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(event_month)
ORDER BY (project_id, session_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS session_summary_v2_mv
TO session_summary_v2
AS
SELECT
    project_id,
    session_id,
    toStartOfMonth(min(occurred_at))                            AS event_month,
    min(occurred_at)                                             AS session_start,
    max(occurred_at)                                             AS session_end,
    countState()                                                AS event_count,
    countIfState(event_type = 'error')                          AS error_count,
    argMinState(url, occurred_at)                                AS entry_url,
    argMaxState(url, occurred_at)                                AS exit_url,
    sumIfState(
        JSONExtract(properties, 'seconds', 'Nullable(Float64)'),
        event_type = 'time_on_page'
    )                                                             AS engaged_seconds
FROM events_v2
GROUP BY project_id, session_id;

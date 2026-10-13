-- 003_minute_aggregates_mv.sql: Pre-aggregated event count per minute and event type.
-- Backs dashboard timeseries queries without scanning raw events_v2.

CREATE TABLE IF NOT EXISTS event_minute_agg_v2
(
    project_id   String,
    minute       DateTime,
    event_type   LowCardinality(String),
    event_count  UInt64
)
ENGINE = SummingMergeTree(event_count)
PARTITION BY toYYYYMM(minute)
ORDER BY (project_id, minute, event_type);

CREATE MATERIALIZED VIEW IF NOT EXISTS event_minute_agg_v2_mv
TO event_minute_agg_v2
AS
SELECT
    project_id,
    toStartOfMinute(occurred_at) AS minute,
    event_type,
    count()                      AS event_count
FROM events_v2
GROUP BY project_id, minute, event_type;

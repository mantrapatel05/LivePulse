-- 004_error_clusters_mv.sql: Groups error events into clusters by normalized signature.
-- Aggregates occurrences, approximate affected sessions, and last seen timestamps.

CREATE TABLE IF NOT EXISTS error_clusters_v2
(
    project_id        String,
    event_month       Date,
    signature         String,
    sample_message    SimpleAggregateFunction(any, String),
    occurrences       AggregateFunction(count),
    affected_sessions AggregateFunction(uniq, String),
    last_seen         SimpleAggregateFunction(max, DateTime64(3))
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(event_month)
ORDER BY (project_id, signature);

CREATE MATERIALIZED VIEW IF NOT EXISTS error_clusters_v2_mv
TO error_clusters_v2
AS
SELECT
    project_id,
    toStartOfMonth(occurred_at) AS event_month,
    replaceRegexpAll(
        replaceRegexpAll(
            JSONExtractString(properties, 'message'),
            '0x[0-9a-fA-F]+|[0-9]+', '#'
        ),
        '''[^'']*''|"[^"]*"', '<val>'
    )                            AS signature,
    any(JSONExtractString(properties, 'message')) AS sample_message,
    countState()                 AS occurrences,
    uniqState(session_id)        AS affected_sessions,
    max(occurred_at)             AS last_seen
FROM events_v2
WHERE event_type = 'error'
GROUP BY project_id, event_month, signature;

-- 001_events_v2.sql: Primary append-only event store.
-- Partitioned by month and ordered by (project_id, occurred_at, event_id).

CREATE TABLE IF NOT EXISTS events_v2
(
    project_id      String,
    event_id        String,
    session_id      String,
    user_id         String DEFAULT 'anonymous',
    event_type      LowCardinality(String),
    url              String,
    url_path        String MATERIALIZED path(url),
    element         Nullable(String),
    consent         LowCardinality(String) DEFAULT 'n/a',
    country         LowCardinality(String) DEFAULT '',
    city             Nullable(String),
    device_type     LowCardinality(String) DEFAULT '',
    browser         LowCardinality(String) DEFAULT '',
    properties      String DEFAULT '{}',
    client_context  String DEFAULT '{}',
    occurred_at     DateTime64(3),
    ingested_at     DateTime64(3) DEFAULT now64(3)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (project_id, occurred_at, event_id)
TTL toDateTime(occurred_at) + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;

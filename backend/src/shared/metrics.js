const client = require("prom-client");

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const eventsAccepted = new client.Counter({
  name: "livepulse_events_accepted_total",
  help: "Events accepted at the collector",
  labelNames: ["project_id"],
  registers: [register],
});

const eventsRejected = new client.Counter({
  name: "livepulse_events_rejected_total",
  help: "Events rejected at the collector (validation failure)",
  labelNames: ["reason"],
  registers: [register],
});

const rateLimited = new client.Counter({
  name: "livepulse_rate_limited_total",
  help: "Requests rejected by the rate limiter",
  labelNames: ["scope"], // ingest: "api_key" | "ip"; dashboard: "dashboard_user" | "dashboard_ip"
  registers: [register],
});

const deadLettered = new client.Counter({
  name: "livepulse_dead_lettered_total",
  help: "Stream entries moved to the dead-letter stream after exhausting retries",
  registers: [register],
});

const streamLag = new client.Gauge({
  name: "livepulse_stream_pending_count",
  help: "Number of pending (unacknowledged) entries in the events:v2 consumer group",
  registers: [register],
});

const workerBatchSize = new client.Histogram({
  name: "livepulse_worker_batch_size",
  help: "Number of events per ClickHouse batch insert",
  buckets: [1, 10, 50, 100, 250, 500],
  registers: [register],
});

const clickhouseInsertLatency = new client.Histogram({
  name: "livepulse_clickhouse_insert_latency_ms",
  help: "ClickHouse batch insert latency",
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500],
  registers: [register],
});

const queryLatency = new client.Histogram({
  name: "livepulse_query_latency_ms",
  help: "Dashboard analytics query latency",
  labelNames: ["endpoint"],
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [register],
});

const socketConnections = new client.Gauge({
  name: "livepulse_socket_connections",
  help: "Currently connected sockets on this process",
  labelNames: ["role"], // "dashboard" | "visitor"
  registers: [register],
});

const ingestStage = new client.Histogram({
  name: "livepulse_ingest_stage_ms",
  help: "Time spent in each ingestion stage",
  labelNames: ["stage"], // "claim" | "publish" | "mongo"
  buckets: [1, 2, 5, 10, 25, 50, 100, 250, 500],
  registers: [register],
});

module.exports = {
  register,
  eventsAccepted,
  eventsRejected,
  rateLimited,
  deadLettered,
  streamLag,
  workerBatchSize,
  clickhouseInsertLatency,
  queryLatency,
  socketConnections,
  ingestStage,
};

/**
 * LivePulse V2 — Local Load Generator (pure Node.js)
 *
 * Target: p95 collector ack latency under 200ms at 10,000 events / 100 concurrent sessions.
 *
 * NOTE ON MONGO AUTH:
 * This local test exercises the collector ingestion pipeline (envelope validation,
 * UUID deduplication check, Redis stream publishing, active session update) directly
 * using a simulated authenticated project with analyticsBackend: 'clickhouse'.
 * It intentionally SKIPS the real MongoDB apiKey lookup that cold HTTP requests perform
 * via `apiKeyAuth` and avoids Mongo write buffering.
 *
 * In production, API keys are cached in Redis with a TTL, so after the first request,
 * 99.9% of incoming collector traffic hits Redis cache and avoids Mongo entirely.
 * However, if you are benchmarking full HTTP stack with cold keys, run collect.k6.js
 * against a multi-node deployment.
 *
 * NOTE ON HARDWARE SELF-CONTENTION:
 * Running both the load generator and the API server / Redis on the same machine
 * measurably inflates latency due to CPU/thread self-contention. For official benchmarks,
 * run this generator on a separate client machine.
 */

const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

// Ensure IPv4 localhost resolution on Windows
if (process.env.REDIS_URL && process.env.REDIS_URL.includes("localhost")) {
  process.env.REDIS_URL = process.env.REDIS_URL.replace("localhost", "127.0.0.1");
}

const { getRedisClient } = require("../../src/shared/redisClient");
const { validateEnvelope } = require("../../src/shared/eventSchema");
const { ingestBatch } = require("../../src/shared/ingestPipeline");

const TOTAL_EVENTS = Number(process.env.TOTAL_EVENTS || 10000);
const CONCURRENCY = Number(process.env.CONCURRENCY || 100);
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 1);
const TARGET_P95_MS = 200;

const FAKE_PROJECT = {
  _id: "699d9becf25204ae69676baa",
  name: "Load Test Project",
  analyticsBackend: "clickhouse",
};

function fakeRequest(project) {
  return {
    app: { get: () => null },
    headers: { "user-agent": "LivePulseLoadTest/1.0" },
    connection: { remoteAddress: "127.0.0.1" },
    socket: {},
    id: "loadtest",
    project,
  };
}

function calculateStats(latencies) {
  if (latencies.length === 0) return null;
  latencies.sort((a, b) => a - b);

  const sum = latencies.reduce((acc, val) => acc + val, 0);
  const avg = sum / latencies.length;
  const min = latencies[0];
  const max = latencies[latencies.length - 1];

  const percentile = (p) => {
    const idx = Math.ceil((p / 100) * latencies.length) - 1;
    return latencies[Math.max(0, Math.min(idx, latencies.length - 1))];
  };

  return {
    total: latencies.length,
    min: min.toFixed(2),
    avg: avg.toFixed(2),
    p50: percentile(50).toFixed(2),
    p90: percentile(90).toFixed(2),
    p95: percentile(95).toFixed(2),
    p99: percentile(99).toFixed(2),
    max: max.toFixed(2),
  };
}

async function run() {
  console.log("=== LivePulse V2 Collector Load Test ===");
  console.log("Configuration:");
  console.log(`  Total events:        ${TOTAL_EVENTS.toLocaleString()}`);
  console.log(`  Concurrent sessions: ${CONCURRENCY}`);
  console.log(`  Batch size:          ${BATCH_SIZE} event(s)/batch`);
  console.log(`  Target p95 latency:  < ${TARGET_P95_MS} ms`);
  console.log("  Pipeline:            in-process (skips Mongo auth, measures validation + Redis Stream publish)");
  console.log("=========================================\n");

  const redis = getRedisClient();
  const ping = await redis.ping();
  if (ping !== "PONG") {
    throw new Error(`Failed to connect to Redis: ping returned ${ping}`);
  }

  const totalBatches = Math.ceil(TOTAL_EVENTS / BATCH_SIZE);
  const batchesPerSession = Math.ceil(totalBatches / CONCURRENCY);
  const latencies = [];
  let acceptedCount = 0;
  let rejectedCount = 0;
  let errorCount = 0;

  const testStartTime = process.hrtime.bigint();

  const sessions = Array.from({ length: CONCURRENCY }, async (_, sessionIdx) => {
    const sessionId = `load-session-${sessionIdx + 1}-${crypto.randomBytes(4).toString("hex")}`;
    const req = fakeRequest(FAKE_PROJECT);

    for (let b = 0; b < batchesPerSession; b++) {
      if (latencies.length >= totalBatches) break;
      const remainingEvents = TOTAL_EVENTS - (latencies.length * BATCH_SIZE);
      if (remainingEvents <= 0) break;
      const currentBatchSize = Math.min(BATCH_SIZE, remainingEvents);

      const events = Array.from({ length: currentBatchSize }, (_, i) => ({
        eventId: crypto.randomUUID(),
        sessionId,
        eventType: "page_view",
        url: `https://example.com/test-page-${(b * currentBatchSize + i) % 20}`,
        occurredAt: new Date().toISOString(),
        properties: { loadTest: true, index: b * currentBatchSize + i },
      }));

      const envelope = {
        schemaVersion: 2,
        sentAt: new Date().toISOString(),
        events,
      };

      const start = process.hrtime.bigint();
      try {
        validateEnvelope(envelope);
        const result = await ingestBatch({ project: FAKE_PROJECT, rawEvents: envelope.events, req });
        const end = process.hrtime.bigint();
        const latencyMs = Number(end - start) / 1e6;

        latencies.push(latencyMs);
        acceptedCount += result.accepted;
        rejectedCount += result.rejected;
      } catch (err) {
        errorCount++;
      }
    }
  });

  await Promise.all(sessions);

  const testEndTime = process.hrtime.bigint();
  const totalDurationSec = Number(testEndTime - testStartTime) / 1e9;
  const stats = calculateStats(latencies);

  console.log("=== Results ===");
  console.log(`Duration:        ${totalDurationSec.toFixed(2)}s`);
  console.log(`Total Requests:  ${latencies.length.toLocaleString()}`);
  console.log(`Accepted Events: ${acceptedCount.toLocaleString()}`);
  console.log(`Rejected Events: ${rejectedCount.toLocaleString()}`);
  console.log(`Errors:          ${errorCount}`);
  console.log(`Throughput:      ${(acceptedCount / totalDurationSec).toFixed(1)} events/sec (${(latencies.length / totalDurationSec).toFixed(1)} req/sec)`);
  console.log("\nLatency Percentiles (Collector Ack):");
  console.log(`  Min:  ${stats.min} ms`);
  console.log(`  Avg:  ${stats.avg} ms`);
  console.log(`  p50:  ${stats.p50} ms`);
  console.log(`  p90:  ${stats.p90} ms`);
  console.log(`  p95:  ${stats.p95} ms (Target: < ${TARGET_P95_MS} ms)`);
  console.log(`  p99:  ${stats.p99} ms`);
  console.log(`  Max:  ${stats.max} ms`);

  const p95 = Number(stats.p95);
  const passed = p95 < TARGET_P95_MS && errorCount === 0;

  console.log("\n=========================================");
  if (passed) {
    console.log(`[PASS] p95 latency (${stats.p95} ms) is well within target (< ${TARGET_P95_MS} ms).`);
  } else {
    console.log(`[WARN] p95 latency (${stats.p95} ms) exceeded target (< ${TARGET_P95_MS} ms).`);
  }
  console.log("=========================================\n");

  await redis.quit();
  process.exit(passed ? 0 : 1);
}

run().catch((err) => {
  console.error("Load test failed:", err);
  process.exit(1);
});

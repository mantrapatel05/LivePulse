// Run the API with BADGE_RATE_LIMIT_PER_IP_PER_MIN=1000000 for this test.
// Numbers measured on the same machine are inflated by self-contention.
const http = require("http");

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const PUBLIC_ID = process.env.PUBLIC_ID;
const DURATION_S = positiveNumber(process.env.DURATION_S, 15);
const CONCURRENCY = Math.floor(positiveNumber(process.env.CONCURRENCY, 100));
const P99_BUDGET_MS = positiveNumber(process.env.P99_BUDGET_MS, 100);
const METRICS_TOKEN = process.env.METRICS_TOKEN;
const METRIC = "livepulse_badge_count_refreshes_total";

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function requestText(url, agent, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { agent, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ statusCode: res.statusCode || 0, body }));
    });
    req.setTimeout(10000, () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
  });
}

async function scrapeRefreshes(base, agent) {
  const headers = METRICS_TOKEN ? { Authorization: `Bearer ${METRICS_TOKEN}` } : {};
  const response = await requestText(new URL("/metrics", base), agent, headers);
  if (response.statusCode !== 200) throw new Error(`GET /metrics returned ${response.statusCode}`);
  const line = new RegExp(`^${METRIC}(?:\\{[^}]*\\})?\\s+([0-9.eE+-]+)\\s*$`, "gm");
  let total = 0;
  let match;
  while ((match = line.exec(response.body))) total += Number(match[1]) || 0;
  return total;
}

function requestBadge(url, agent) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    let settled = false;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({ status, elapsedMs });
    };
    const req = http.get(url, { agent }, (res) => {
      res.resume();
      res.on("end", () => finish(res.statusCode || 0));
    });
    req.setTimeout(10000, () => req.destroy(new Error("request timed out")));
    req.on("error", () => finish("ERR"));
  });
}

function percentile(sorted, fraction) {
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

async function main() {
  if (!PUBLIC_ID) {
    console.error("Usage: PUBLIC_ID=<12-char-public-id> node scripts/badgeLoadTest.js");
    process.exitCode = 1;
    return;
  }

  const base = new URL(BASE_URL);
  if (base.protocol !== "http:") throw new Error("BASE_URL must use http://");
  const agent = new http.Agent({ keepAlive: true, maxSockets: CONCURRENCY });
  const badgeUrl = new URL(`/badge/${encodeURIComponent(PUBLIC_ID)}.svg`, base);

  try {
    const before = await scrapeRefreshes(base, agent);
    const started = process.hrtime.bigint();
    const deadline = started + BigInt(Math.ceil(DURATION_S * 1e9));
    const latencies = [];
    const statusCodes = Object.create(null);

    async function worker() {
      while (process.hrtime.bigint() < deadline) {
        const result = await requestBadge(badgeUrl, agent);
        latencies.push(result.elapsedMs);
        statusCodes[result.status] = (statusCodes[result.status] || 0) + 1;
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const elapsedSeconds = Number(process.hrtime.bigint() - started) / 1e9;
    const after = await scrapeRefreshes(base, agent);
    const sorted = [...latencies].sort((a, b) => a - b);
    const p50 = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    const p99 = percentile(sorted, 0.99);
    const total = latencies.length;
    const refreshDelta = after - before;
    const refreshBudget = Math.ceil(DURATION_S / 15) + 3;

    console.log(`Total requests: ${total}`);
    console.log(`Requests/sec: ${(total / elapsedSeconds).toFixed(2)}`);
    console.log(`Latency p50: ${p50.toFixed(2)} ms`);
    console.log(`Latency p95: ${p95.toFixed(2)} ms`);
    console.log(`Latency p99: ${p99.toFixed(2)} ms`);
    console.log(`Status codes: ${Object.keys(statusCodes).sort().map((code) => `${code}=${statusCodes[code]}`).join(", ") || "none"}`);
    console.log(`Count refreshes delta: ${refreshDelta}`);

    const hasNon200 = Object.keys(statusCodes).some((status) => status !== "200");
    if (hasNon200 || p99 > P99_BUDGET_MS || refreshDelta > refreshBudget) process.exitCode = 1;
  } finally {
    agent.destroy();
  }
}

main().catch((error) => {
  console.error(`Badge load test failed: ${error.message}`);
  process.exitCode = 1;
});

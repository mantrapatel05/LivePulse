const {
  buildEngagementWindowQuery,
  buildPageDeltaQuery,
  runQuery,
} = require("../shared/analyticsQueries");
const { computeDrift } = require("../shared/insights/engagementDrift");
const { getRedisClient } = require("../shared/redisClient");
const { engagementDriftRequests } = require("../shared/metrics");
const { clickhouseOnly, respond } = require("./analyticsV2Controller");

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_TTL_SECONDS = 300;

function clickhouseDateTime(milliseconds) {
  return new Date(milliseconds).toISOString().replace("T", " ").replace("Z", "");
}

async function getEngagementDrift(req, res) {
  if (!clickhouseOnly(req, res)) return;

  const projectId = String(req.project._id);
  const redis = getRedisClient();
  const cacheKey = `drift:v1:${projectId}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed?.drift?.status && parsed?.range) {
          engagementDriftRequests.inc({ status: parsed.drift.status });
          return respond(res, { ...parsed.drift, cached: true }, parsed.range);
        }
      } catch {
        // Ignore a malformed cache entry and rebuild it from ClickHouse.
      }
      await redis.del(cacheKey).catch(() => {});
    }

    // Use one server timestamp for adjacent rolling windows; the client cannot set dates.
    const now = Date.now();
    const curFromMs = now - WINDOW_MS;
    const prevFromMs = now - 2 * WINDOW_MS;
    const curFrom = clickhouseDateTime(curFromMs);
    const curTo = clickhouseDateTime(now);
    const prevFrom = clickhouseDateTime(prevFromMs);
    const prevTo = curFrom;

    const [currentRows, previousRows, pageRows] = await Promise.all([
      runQuery(
        buildEngagementWindowQuery({ projectId, from: curFrom, to: curTo }),
        "v2_drift_cur",
      ),
      runQuery(
        buildEngagementWindowQuery({ projectId, from: prevFrom, to: prevTo }),
        "v2_drift_prev",
      ),
      runQuery(
        buildPageDeltaQuery({ projectId, curFrom, curTo, prevFrom, prevTo }),
        "v2_drift_pages",
      ),
    ]);

    const drift = computeDrift({
      cur: currentRows[0],
      prev: previousRows[0],
      pages: pageRows,
    });
    const range = {
      from: new Date(prevFromMs).toISOString(),
      to: new Date(now).toISOString(),
      timezone: "UTC",
    };

    await redis.set(cacheKey, JSON.stringify({ drift, range }), "EX", CACHE_TTL_SECONDS);
    engagementDriftRequests.inc({ status: drift.status });
    return respond(res, { ...drift, cached: false }, range);
  } catch (error) {
    engagementDriftRequests.inc({ status: "error" });
    throw error;
  }
}

module.exports = { getEngagementDrift };

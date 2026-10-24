const crypto = require("crypto");
const Project = require("../models/Project");
const Event = require("../models/Event");
const analyticsQueries = require("../shared/analyticsQueries"); // module object on purpose: tests spy on runQuery
const { activeCount } = require("../shared/activeSessionState");
const { getRedisClient } = require("../shared/redisClient");
const { checkRateLimit } = require("../shared/rateLimiter");
const { RateLimitError } = require("../shared/errors");
const { isValidPublicId } = require("../shared/publicId");
const { logger } = require("../shared/logger");

const noop = { inc: () => {} };
const metrics = (() => { try { return require("../shared/metrics"); } catch { return {}; } })();
const badgeRequests = metrics.badgeRequests || noop;
const badgeCountRefreshes = metrics.badgeCountRefreshes || noop;

// ---- config (read lazily so tests can change env per test) ----
const num = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const countTtlMs = () => num("BADGE_COUNT_TTL_SECONDS", 15) * 1000;
const projectTtlMs = () => num("BADGE_PROJECT_TTL_SECONDS", 60) * 1000;
const brandFloor = () => num("BADGE_BRAND_FLOOR", 3);
const badgeIpLimit = () => num("BADGE_RATE_LIMIT_PER_IP_PER_MIN", 120);
const landingIpLimit = () => num("BADGE_LANDING_RATE_LIMIT_PER_IP_PER_MIN", 60);

const KEY_TTL_SECONDS = 8 * 24 * 3600; // enough for a 7-day series
const PROJECT_CACHE_MAX = 5000; // bounds memory against scanners probing random ids
const HTTP_CACHE = "public, max-age=30, s-maxage=30";
const NOT_FOUND_CACHE = "public, max-age=60";
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

// ---- caches (process-local) ----
const projectCache = new Map(); // publicId -> { expires, value|null }  (negative entries cached too)
const countCache = new Map(); // publicId -> { expires, value }
const inflight = new Map(); // publicId -> Promise (single-flight)

function __resetBadgeCaches() {
  projectCache.clear();
  countCache.clear();
  inflight.clear();
}
function invalidate(publicId) {
  projectCache.delete(publicId);
  countCache.delete(publicId);
  inflight.delete(publicId);
}

// ---- pure helpers ----
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const escapeXml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function formatCount(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (v < 1000) return String(v);
  const k = Math.floor(v / 100) / 10;
  return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}k`;
}

function pickDisplay(badge, { liveNow, todayVisitors }) {
  const floor = brandFloor();
  const effMin = Math.max(badge.minCount, floor);
  if (liveNow >= effMin) return { mode: "live_now", count: liveNow };
  if (todayVisitors >= floor) return { mode: "visitors_today", count: todayVisitors };
  return { mode: "brand_only", count: 0 };
}

function labelFor({ mode, count }) {
  if (mode === "live_now") return `${formatCount(count)} reading now`;
  if (mode === "visitors_today") return `${formatCount(count)} visitors today`;
  return "realtime analytics";
}

function buildSvg({ mode, count }) {
  const label = labelFor({ mode, count });
  const textX = 96;
  const width = Math.max(200, Math.ceil(textX + label.length * 6.6 + 14));
  const dot = mode === "live_now" ? "#22c55e" : "#64748b";
  const safe = escapeXml(label); // escape EVERY interpolated string
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="30" role="img" aria-label="LivePulse: ${safe}">` +
    `<rect width="${width}" height="30" rx="4" fill="#0b1020"/>` +
    `<circle cx="12" cy="15" r="3.5" fill="${dot}"/>` +
    `<text x="22" y="19.5" fill="#22c55e" font-size="10" font-family="ui-monospace,monospace" letter-spacing="1">LIVEPULSE</text>` +
    `<text x="${textX}" y="19.5" fill="#e2e8f0" font-size="11" font-family="system-ui,sans-serif">${safe}</text>` +
    `</svg>`
  );
}

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
function lastDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(new Date(Date.now() - i * 86400000)));
  return out;
}
const startOfTodayUTC = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };
const toChTime = (d) => d.toISOString().replace("T", " ").replace("Z", "");

// Keyed hash so a leaked HLL value cannot be brute-forced back to an IPv4 address.
function ipHash(ip) {
  return crypto
    .createHmac("sha256", process.env.API_KEY_PEPPER || "livepulse-badge-hll")
    .update(String(ip || "unknown"))
    .digest("hex")
    .slice(0, 16);
}

async function pfaddDaily(prefix, publicId, ip) {
  const key = `${prefix}:${publicId}:${dayKey()}`;
  await getRedisClient().pipeline().pfadd(key, ipHash(ip)).expire(key, KEY_TTL_SECONDS).exec();
}

// Returns Retry-After seconds when limited, otherwise null. FAILS OPEN on Redis errors
// (a public image must not 500 because the limiter is down).
async function ipLimited(req, scope, limit) {
  try {
    await checkRateLimit(getRedisClient(), { scope, key: req.ip || "unknown", limit, windowSeconds: 60 });
    return null;
  } catch (err) {
    if (err instanceof RateLimitError) return err.retryAfterSeconds || 30;
    return null;
  }
}

// ---- data access ----
async function resolveProject(publicId) {
  const hit = projectCache.get(publicId);
  if (hit && hit.expires > Date.now()) return hit.value;
  const doc = await Project.findOne({ publicId }).select("_id publicId analyticsBackend badge").lean();
  let value = null;
  if (doc) {
    const b = doc.badge || {}; // .lean() skips schema defaults; old docs may lack `badge`
    value = {
      id: String(doc._id),
      publicId: doc.publicId,
      analyticsBackend: doc.analyticsBackend || "dual",
      enabled: b.enabled === true,
      minCount: Number.isInteger(b.minCount) ? b.minCount : 3,
    };
  }
  if (projectCache.size >= PROJECT_CACHE_MAX) projectCache.clear();
  projectCache.set(publicId, { expires: Date.now() + projectTtlMs(), value });
  return value;
}

async function countTodayVisitors(p) {
  const from = startOfTodayUTC();
  if (p.analyticsBackend === "clickhouse") {
    const rows = await analyticsQueries.runQuery(
      analyticsQueries.buildTodayVisitorsQuery({ projectId: p.id, from: toChTime(from) }),
      "badge_today_visitors",
    );
    return Number(rows && rows[0] && rows[0].visitors) || 0;
  }
  const sessions = await Event.distinct("sessionId", { projectId: p.id, timestamp: { $gte: from } });
  return sessions.length;
}

async function computeCounts(p) {
  badgeCountRefreshes.inc();
  const [liveNow, todayVisitors] = await Promise.all([
    activeCount(getRedisClient(), p.id).catch((err) => { logger.warn({ err: err.message }, "badge liveNow failed"); return 0; }),
    countTodayVisitors(p).catch((err) => { logger.warn({ err: err.message }, "badge todayVisitors failed"); return 0; }),
  ]);
  return { liveNow: Number(liveNow) || 0, todayVisitors: Number(todayVisitors) || 0 };
}

function getCounts(p) {
  const hit = countCache.get(p.publicId);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
  if (inflight.has(p.publicId)) return inflight.get(p.publicId); // single-flight: no thundering herd
  const promise = computeCounts(p)
    .then((value) => {
      countCache.set(p.publicId, { expires: Date.now() + countTtlMs(), value });
      return value;
    })
    .finally(() => inflight.delete(p.publicId));
  inflight.set(p.publicId, promise);
  return promise;
}

// ---- response helpers ----
function setPublicHeaders(res) {
  res.set({ "Cache-Control": HTTP_CACHE, "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" });
}
function notFound(res) {
  badgeRequests.inc({ result: "not_found" });
  res.set({ "Cache-Control": NOT_FOUND_CACHE, "Access-Control-Allow-Origin": "*" });
  return res.status(404).type("text/plain").send("not found");
}
function rateLimited(res, retryAfter) {
  badgeRequests.inc({ result: "rate_limited" });
  res.set({ "Retry-After": String(retryAfter), "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
  return res.status(429).type("text/plain").send("rate limited");
}
function serverError(res, err) {
  logger.error({ err: err && err.message }, "badge request failed");
  badgeRequests.inc({ result: "error" });
  res.set({ "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
  return res.status(503).type("text/plain").send("unavailable");
}

// ---- public handlers ----
async function badgeSvg(req, res) {
  try {
    const { publicId } = req.params;
    if (!isValidPublicId(publicId)) return notFound(res);
    const retry = await ipLimited(req, "badge", badgeIpLimit());
    if (retry) return rateLimited(res, retry);

    const p = await resolveProject(publicId);
    if (!p || !p.enabled) return notFound(res);

    try { await pfaddDaily("badge:imp", publicId, req.ip); } catch { /* impressions are a hint; never block serving */ }

    const counts = await getCounts(p);
    const display = pickDisplay(p, counts);
    setPublicHeaders(res);
    res.set({ "Content-Security-Policy": SVG_CSP });
    badgeRequests.inc({ result: "ok" });
    return res.type("image/svg+xml").send(buildSvg(display));
  } catch (err) {
    return serverError(res, err);
  }
}

async function badgePulse(req, res) {
  try {
    const { publicId } = req.params;
    if (!isValidPublicId(publicId)) return notFound(res);
    const retry = await ipLimited(req, "badge_pulse", badgeIpLimit());
    if (retry) return rateLimited(res, retry);

    const p = await resolveProject(publicId);
    if (!p || !p.enabled) return notFound(res);

    const display = pickDisplay(p, await getCounts(p));
    setPublicHeaders(res);
    badgeRequests.inc({ result: "ok" });
    // Deliberately NOT exposing raw liveNow/todayVisitors: below the floor the number stays hidden.
    return res.json({ publicId, mode: display.mode, count: display.count });
  } catch (err) {
    return serverError(res, err);
  }
}

// Funnel top: the landing page calls this fire-and-forget when ?ref=badge&p=<publicId> is present.
// Always answers 204 (does not reveal whether an id exists); counts only for enabled projects.
async function recordLandingHit(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  const { publicId } = req.params;
  if (!isValidPublicId(publicId)) return res.status(204).end();
  const retry = await ipLimited(req, "landing_hit", landingIpLimit());
  if (retry) { res.set("Retry-After", String(retry)); return res.status(429).end(); }
  try {
    const p = await resolveProject(publicId);
    if (p && p.enabled) await pfaddDaily("landing:ref", publicId, req.ip);
  } catch (err) {
    logger.warn({ err: err.message }, "landing hit not recorded");
  }
  return res.status(204).end();
}

// ---- dashboard handlers (mounted after requireDashboardAuth + requireProjectOwnership) ----
const normalizedBadge = (doc) => ({
  enabled: !!(doc.badge && doc.badge.enabled === true),
  minCount: doc.badge && Number.isInteger(doc.badge.minCount) ? doc.badge.minCount : 3,
});

async function updateBadgeSettings(req, res) {
  try {
    const body = req.body || {};
    const unknown = Object.keys(body).filter((k) => k !== "enabled" && k !== "minCount");
    if (unknown.length) return res.status(400).json({ message: `Unknown field(s): ${unknown.join(", ")}` });
    if (!("enabled" in body) && !("minCount" in body)) return res.status(400).json({ message: "Provide enabled and/or minCount" });
    if ("enabled" in body && typeof body.enabled !== "boolean") return res.status(400).json({ message: "enabled must be a boolean" });
    if ("minCount" in body && !(Number.isInteger(body.minCount) && body.minCount >= 3 && body.minCount <= 999)) {
      return res.status(400).json({ message: "minCount must be an integer between 3 and 999" });
    }
    const project = req.project;
    if (!project.publicId) {
      return res.status(409).json({ message: "This project has no publicId yet. Run: npm run backfill:public-id" });
    }
    if ("enabled" in body) project.set("badge.enabled", body.enabled);
    if ("minCount" in body) project.set("badge.minCount", body.minCount);
    await project.save();
    invalidate(project.publicId); // local only; other instances converge within BADGE_PROJECT_TTL_SECONDS
    return res.status(200).json({
      message: "Badge settings updated",
      project: { _id: String(project._id), publicId: project.publicId, badge: normalizedBadge(project) },
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update badge settings", error: error.message });
  }
}

async function getBadgeStats(req, res) {
  try {
    const project = req.project;
    const badge = normalizedBadge(project);
    if (!project.publicId) {
      return res.status(200).json({ publicId: null, badge, today: { impressions: 0, landingHits: 0 }, last7Days: [], referralProjects: 0 });
    }
    const days = lastDays(7);
    const pipeline = getRedisClient().pipeline();
    days.forEach((d) => {
      pipeline.pfcount(`badge:imp:${project.publicId}:${d}`);
      pipeline.pfcount(`landing:ref:${project.publicId}:${d}`);
    });
    const results = await pipeline.exec();
    const last7Days = days.map((day, i) => ({
      day,
      impressions: Number(results[i * 2][1]) || 0,
      landingHits: Number(results[i * 2 + 1][1]) || 0,
    }));
    const referralProjects = await Project.countDocuments({ referredBy: project.publicId });
    const today = last7Days[last7Days.length - 1];
    return res.status(200).json({
      publicId: project.publicId,
      badge,
      today: { impressions: today.impressions, landingHits: today.landingHits },
      last7Days,
      referralProjects,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load badge stats", error: error.message });
  }
}

module.exports = {
  badgeSvg,
  badgePulse,
  recordLandingHit,
  updateBadgeSettings,
  getBadgeStats,
  __resetBadgeCaches,
  __test: { escapeXml, formatCount, pickDisplay, buildSvg, labelFor, dayKey, ipHash },
};

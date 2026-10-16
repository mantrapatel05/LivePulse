const Project = require("../models/Project");
const { hashApiKey } = require("./apiKeyHash");
const { logger } = require("./logger");

const CACHE_TTL_SECONDS = 60;

function cacheKey(hash) {
  return `apikey:${hash}`;
}

async function resolveApiKey(redis, presentedKey) {
  if (!presentedKey || typeof presentedKey !== "string") return null;
  const hash = hashApiKey(presentedKey);

  const cached = await redis.get(cacheKey(hash));
  if (cached) {
    try {
      const snap = JSON.parse(cached);
      // Snapshot hit: no Mongo round trip. Everything downstream of auth
      // reads only _id + analyticsBackend (ingest, rate limiter, visitor
      // sockets), so a plain object is sufficient.
      // Staleness note: an analyticsBackend flip takes up to 60s (the TTL)
      // to reach ingestion -- acceptable for a migration flag, but flips
      // should be treated as planned operations, not instant switches.
      if (snap && typeof snap === "object" && snap._id) {
        if (!snap.analyticsBackend) {
          // Real snapshots always include this field (see snapshotOf below).
          // A missing field means an old/foreign writer; default to dual (safe:
          // keep writing Mongo) and log so backend flips are visible, not silent.
          logger.warn({ projectId: snap._id }, "apiKey snapshot missing analyticsBackend, defaulting to dual");
          snap.analyticsBackend = "dual"; // safe default = keep writing Mongo
        }
        return snap;
      }
    } catch {
      // Old-format (bare id string) or corrupt entry: fall through to the
      // findById path below, which rebuilds the cache in the new format.
    }
    if (typeof cached === "string" && cached && !cached.startsWith("{")) {
      const project = await Project.findById(cached);
      if (project) {
        await redis.set(cacheKey(hash), JSON.stringify(snapshotOf(project)), "EX", CACHE_TTL_SECONDS);
        return snapshotOf(project);
      }
    }
  }

  let project = await Project.findOne({ apiKeyHash: hash });
  if (!project) {
    project = await Project.findOne({ apiKey: presentedKey }); // legacy fallback: plaintext-key projects
  }
  if (project) {
    await redis.set(cacheKey(hash), JSON.stringify(snapshotOf(project)), "EX", CACHE_TTL_SECONDS);
    return snapshotOf(project);
  }
  return null;
}

function snapshotOf(project) {
  return {
    _id: String(project._id),
    analyticsBackend: project.analyticsBackend || "dual",
  };
}

async function invalidateApiKeyCache(redis, { hash, plaintext }) {
  const keys = [];
  if (hash) keys.push(cacheKey(hash));
  if (plaintext) keys.push(cacheKey(hashApiKey(plaintext)));
  if (keys.length) await redis.del(...keys);
}

module.exports = { resolveApiKey, invalidateApiKeyCache, CACHE_TTL_SECONDS };
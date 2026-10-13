const Project = require("../models/Project");
const { hashApiKey } = require("./apiKeyHash");

const CACHE_TTL_SECONDS = 60;

function cacheKey(hash) {
  return `apikey:${hash}`;
}

async function resolveApiKey(redis, presentedKey) {
  if (!presentedKey || typeof presentedKey !== "string") return null;
  const hash = hashApiKey(presentedKey);

  const cachedId = await redis.get(cacheKey(hash));
  if (cachedId) {
    const project = await Project.findById(cachedId);
    if (project) return project;
    // Cached id pointed at a project that no longer exists — fall through
    // and let the normal lookup (which will also miss) clean this up.
  }

  let project = await Project.findOne({ apiKeyHash: hash });
  if (!project) {
    project = await Project.findOne({ apiKey: presentedKey }); // legacy fallback
  }
  if (project) {
    await redis.set(cacheKey(hash), String(project._id), "EX", CACHE_TTL_SECONDS);
  }
  return project;
}

async function invalidateApiKeyCache(redis, { hash, plaintext }) {
  const keys = [];
  if (hash) keys.push(cacheKey(hash));
  if (plaintext) keys.push(cacheKey(hashApiKey(plaintext)));
  if (keys.length) await redis.del(...keys);
}

module.exports = { resolveApiKey, invalidateApiKeyCache, CACHE_TTL_SECONDS };
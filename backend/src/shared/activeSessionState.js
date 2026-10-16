const ACTIVE_TTL_SECONDS = 5 * 60; // a session "falls off" live-now 5 minutes after its last event

function zsetKey(projectId) {
  return `active:${projectId}`;
}
function hashKey(projectId, sessionId) {
  return `session:${projectId}:${sessionId}`;
}

/**
 * Called on every accepted event. Cheap (a handful of O(log N) Redis ops)
 * and gives the dashboard "who's live right now" without ever touching
 * ClickHouse or Mongo — this is exactly the kind of hot-path read the
 * spec wants off the analytics store.
 */
async function touchSession(redis, { projectId, sessionId, url, userId }) {
  const now = Date.now();
  const zkey = zsetKey(projectId);
  const hkey = hashKey(projectId, sessionId);

  const pipeline = redis.pipeline();
  pipeline.zadd(zkey, now, sessionId);
  pipeline.expire(zkey, ACTIVE_TTL_SECONDS);
  pipeline.hset(hkey, {
    sessionId,
    userId: userId || "anonymous",
    currentUrl: url || "",
    lastSeenAt: String(now),
  });
  pipeline.hsetnx(hkey, "startedAt", String(now));
  pipeline.expire(hkey, ACTIVE_TTL_SECONDS);
  await pipeline.exec();
}

/**
 * Queue session touches for a whole batch onto an existing pipeline: one
 * touch per DISTINCT session, last write wins in send order. A batch is
 * almost always one session, so this collapses N per-event touches into
 * ~1 block of pipelined commands with zero extra round trips.
 */
function queueSessionTouches(pipeline, projectId, events) {
  const latest = new Map();
  for (const e of events) latest.set(e.sessionId, e);
  const now = Date.now();
  const zkey = zsetKey(projectId);
  for (const e of latest.values()) {
    const hkey = hashKey(projectId, e.sessionId);
    pipeline.zadd(zkey, now, e.sessionId);
    pipeline.expire(zkey, ACTIVE_TTL_SECONDS);
    pipeline.hset(hkey, {
      sessionId: e.sessionId,
      userId: e.userId || "anonymous",
      currentUrl: e.url || "",
      lastSeenAt: String(now),
    });
    pipeline.hsetnx(hkey, "startedAt", String(now));
    pipeline.expire(hkey, ACTIVE_TTL_SECONDS);
  }
}

/** Sessions active within the last `windowMs` (default: the same 5-minute TTL window). */
async function listActiveSessions(redis, projectId, windowMs = ACTIVE_TTL_SECONDS * 1000) {
  const zkey = zsetKey(projectId);
  const cutoff = Date.now() - windowMs;

  // Sweep out anything older than the window so a slow reader doesn't see
  // stale sessions the TTL hasn't expired yet.
  await redis.zremrangebyscore(zkey, "-inf", cutoff);

  const sessionIds = await redis.zrevrangebyscore(zkey, "+inf", cutoff);
  if (!sessionIds.length) return [];

  const pipeline = redis.pipeline();
  sessionIds.forEach((id) => pipeline.hgetall(hashKey(projectId, id)));
  const results = await pipeline.exec();

  return results
    .map(([, hash]) => hash)
    .filter((hash) => hash && Object.keys(hash).length > 0)
    .map((hash) => ({ ...hash, lastSeenAt: Number(hash.lastSeenAt), startedAt: Number(hash.startedAt) }));
}

async function activeCount(redis, projectId, windowMs = ACTIVE_TTL_SECONDS * 1000) {
  const zkey = zsetKey(projectId);
  const cutoff = Date.now() - windowMs;
  await redis.zremrangebyscore(zkey, "-inf", cutoff);
  return redis.zcount(zkey, cutoff, "+inf");
}

module.exports = { touchSession, queueSessionTouches, listActiveSessions, activeCount, ACTIVE_TTL_SECONDS };
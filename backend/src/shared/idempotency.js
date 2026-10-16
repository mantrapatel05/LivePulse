const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // covers any realistic SDK retry window

async function claimEventId(redis, projectId, eventId) {
  const key = `idempotency:${projectId}:${eventId}`;
  const result = await redis.set(key, "1", "EX", IDEMPOTENCY_TTL_SECONDS, "NX");
  return result === "OK"; // true = first time seeing this eventId, false = duplicate
}

/**
 * Batched claim: one round trip for the whole batch instead of one per
 * event. Returns a boolean array aligned with eventIds.
 * On any command error the state of that command is unknown, so claims
 * that did land are rolled back and the error is thrown -- the caller
 * releases nothing it can't account for, and a retry re-claims cleanly.
 */
async function claimEventIds(redis, projectId, eventIds) {
  if (!eventIds.length) return [];
  const pipeline = redis.pipeline();
  eventIds.forEach((id) =>
    pipeline.set(`idempotency:${projectId}:${id}`, "1", "EX", IDEMPOTENCY_TTL_SECONDS, "NX"),
  );
  const results = await pipeline.exec(); // [[err, "OK" | null], ...]
  const claimed = results.map(([err, res]) => !err && res === "OK");
  const firstErr = results.find(([err]) => err);
  if (firstErr) {
    await releaseEventIds(redis, projectId, eventIds.filter((_, i) => claimed[i])).catch(() => {});
    throw firstErr[0];
  }
  return claimed;
}

async function releaseEventId(redis, projectId, eventId) {
  await redis.del(`idempotency:${projectId}:${eventId}`);
}

async function releaseEventIds(redis, projectId, eventIds) {
  if (eventIds.length) await redis.del(...eventIds.map((id) => `idempotency:${projectId}:${id}`));
}

async function claimClickhouseInsert(redis, projectId, eventId) {
  const key = eventId ? `idempotency:ch:${projectId}:${eventId}` : `idempotency:ch:${projectId}`;
  const result = await redis.set(key, "1", "EX", IDEMPOTENCY_TTL_SECONDS, "NX");
  return result === "OK";
}

async function releaseClickhouseInsertClaim(redis, projectId, eventId) {
  const key = eventId ? `idempotency:ch:${projectId}:${eventId}` : `idempotency:ch:${projectId}`;
  await redis.del(key);
}

module.exports = {
  claimEventId,
  claimEventIds,
  releaseEventId,
  releaseEventIds,
  claimClickhouseInsert,
  releaseClickhouseInsertClaim,
  IDEMPOTENCY_TTL_SECONDS,
};

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // covers any realistic SDK retry window

async function claimEventId(redis, projectId, eventId) {
  const key = `idempotency:${projectId}:${eventId}`;
  const result = await redis.set(key, "1", "EX", IDEMPOTENCY_TTL_SECONDS, "NX");
  return result === "OK"; // true = first time seeing this eventId, false = duplicate
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
  claimClickhouseInsert,
  releaseClickhouseInsertClaim,
  IDEMPOTENCY_TTL_SECONDS,
};

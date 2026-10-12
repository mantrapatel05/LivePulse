const { logger } = require('./logger');

const STREAM_KEY = 'events:v2';
const DEAD_LETTER_STREAM_KEY = "events:v2:dead";
const CONSUMER_GROUP = "clickhouse-writers";
const MAX_DELIVERY_ATTEMPTS = 5;
const ATTEMPTS_HASH_KEY = "events:v2:attempts";

//take an event,append it to the notebook and return the id of the event
async function publishEvent(redis,{projectId,event,correlationId}){
    const id = await redis.xadd(
        STREAM_KEY,
        "*",
        "projectId", String(projectId),
        "correlationId", correlationId || "",
        "payload", JSON.stringify(event),
    );
    return id;
}

async function ensureConsumerGroup(redis) {
    try {
      await redis.xgroup("CREATE", STREAM_KEY, CONSUMER_GROUP, "0", "MKSTREAM");
      logger.info({ stream: STREAM_KEY, group: CONSUMER_GROUP }, "consumer group created");
    } catch (err) {
      if (!String(err.message).includes("BUSYGROUP")) throw err;
    }
}

function parseStreamEntries(raw) {
    // ioredis xreadgroup/xautoclaim shape: [[streamKey, [[id, [field, value, ...]], ...]]]
    if (!raw || !raw.length) return [];
    const [, entries] = Array.isArray(raw[0]) ? raw[0] : raw;
    return (entries || [])
      .filter(Boolean)
      .map(([id, fields]) => {
        const obj = {};
        for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1];
        let event = null;
        try {
          event = JSON.parse(obj.payload);
        } catch {
          event = null;
        }
        return { id, projectId: obj.projectId, correlationId: obj.correlationId, event };
    });
}

async function readBatch(redis, consumerName, { count = 500, blockMs = 1000 } = {}) {
    await ensureConsumerGroup(redis);
    const raw = await redis.xreadgroup(
      "GROUP",
      CONSUMER_GROUP,
      consumerName,
      "COUNT",
      count,
      "BLOCK",
      blockMs,
      "STREAMS",
      STREAM_KEY,
      ">",
    );
    return parseStreamEntries(raw);
}
  
async function ack(redis, ids) {
   if (!ids.length) return;
   await redis.xack(STREAM_KEY, CONSUMER_GROUP, ...ids);
   if (ids.length) await redis.hdel(ATTEMPTS_HASH_KEY, ...ids);
}

async function reclaimStale(redis, consumerName, { minIdleMs = 30000, count = 100 } = {}) {
    const raw = await redis.xautoclaim(
      STREAM_KEY,
      CONSUMER_GROUP,
      consumerName,
      minIdleMs,
      "0",
      "COUNT",
      count,
    );
    // ioredis xautoclaim reply: [nextCursor, messages, deletedMessageIds]
    const messages = raw?.[1] ?? [];
    const parsed = parseStreamEntries([[STREAM_KEY, messages]]);
    if (!parsed.length) return [];
  
    const attempts = await Promise.all(
      parsed.map((e) => redis.hincrby(ATTEMPTS_HASH_KEY, e.id, 1)),
    );
  
    const toRetry = [];
    const toDeadLetter = [];
    parsed.forEach((entry, i) => {
      if (attempts[i] > MAX_DELIVERY_ATTEMPTS) toDeadLetter.push(entry);
      else toRetry.push(entry);
    });
  
    if (toDeadLetter.length) {
      for (const entry of toDeadLetter) {
        await redis.xadd(
          DEAD_LETTER_STREAM_KEY,
          "*",
          "originalId",
          entry.id,
          "projectId",
          entry.projectId || "",
          "correlationId",
          entry.correlationId || "",
          "payload",
          JSON.stringify(entry.event),
        );
      }
      await ack(
        redis,
        toDeadLetter.map((e) => e.id),
      );
      logger.warn(
        { count: toDeadLetter.length, ids: toDeadLetter.map((e) => e.id) },
        "moved stale entries to dead-letter stream after exhausting retries",
      );
    }
  
    return toRetry;
  }
  

async function pendingCount(redis) {
    try {
      const summary = await redis.xpending(STREAM_KEY, CONSUMER_GROUP);
      return Array.isArray(summary) ? Number(summary[0]) || 0 : 0;
    } catch {
      return 0;
    }
  }

module.exports = {
    STREAM_KEY,
    DEAD_LETTER_STREAM_KEY,
    CONSUMER_GROUP,
    MAX_DELIVERY_ATTEMPTS,
    ensureConsumerGroup,
    publishEvent,
    readBatch,
    ack,
    reclaimStale,
    pendingCount,
    parseStreamEntries,
  };
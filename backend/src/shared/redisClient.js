const Redis = require("ioredis");
const { logger } = require("./logger");

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

function createRedisClient(label = "redis") {
    const client = new Redis(REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true
    });

    client.on("connect", ()=>{
        logger.info({label},"redis connected");
    });

    client.on("error",(err) => {
        logger.error({err,label},"redis connection error");
    });

    return client;
}

let sharedClient = null;

function getRedisClient() {
    if(!sharedClient) {
        sharedClient = createRedisClient("shared");
    }
    return sharedClient;
}

async function  checkRedisReady(timeoutMs = 1500) {
    try {
        const client = getRedisClient();
        const timer = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));

        const result = await Promise.race([client.ping(), timer]);

        return result === "PONG";
    } catch {
        return false;
    }
}

module.exports = {
  createRedisClient,
  getRedisClient,
  checkRedisReady,
  REDIS_URL,
};
const { resolveApiKey } = require("../shared/resolveApiKey");
const { getRedisClient } = require("../shared/redisClient");

const apiKeyAuth = async (req, res, next) => {
  try {
    const apiKey = req.header("x-api-key");

    if (!apiKey) {
      return res.status(401).json({ message: "API key is missing" });
    }

    const project = await resolveApiKey(getRedisClient(), apiKey);

    if (!project) {
      return res.status(401).json({ message: "Invalid API key" });
    }
    req.project = project; // Attach project to request for downstream use
    next();
  } catch (error) {
    res.status(500).json({ message: "Auth error", error: error.message });
  }
};

module.exports = apiKeyAuth;
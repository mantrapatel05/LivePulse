const crypto = require("crypto");
const { logger } = require("./logger");

const PEPPER = process.env.API_KEY_PEPPER || "";

if (!PEPPER && process.env.NODE_ENV === "production") {
  logger.warn(
    "API_KEY_PEPPER is not set in production — api key hashes are unsalted. Set it before launch.",
  );
}

/**
 * sha256, not bcrypt: this hash is computed on the hot ingestion path (once
 * per uncached request), potentially thousands of times a second. bcrypt is
 * deliberately slow, which is right for login passwords and wrong here —
 * the actual defenses against brute force are the keyspace (16 random
 * bytes) and rate limiting, not hash cost.
 */
function hashApiKey(plaintext) {
  return crypto.createHash("sha256").update(PEPPER + plaintext).digest("hex");
}

/** lp_live_<8 hex prefix, shown in UI><24 more hex, never shown again> */
function generateApiKey() {
  const prefixPart = crypto.randomBytes(4).toString("hex"); // 8 hex chars
  const secretPart = crypto.randomBytes(24).toString("hex"); // 48 hex chars
  const plaintext = `lp_live_${prefixPart}${secretPart}`;
  return {
    plaintext,
    prefix: `lp_live_${prefixPart}`,
    hash: hashApiKey(plaintext),
  };
}

module.exports = { generateApiKey, hashApiKey };

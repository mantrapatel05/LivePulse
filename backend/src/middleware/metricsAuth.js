const crypto = require("crypto");

function requireMetricsAuth(req, res, next) {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return res.status(503).json({ message: "Metrics authentication is not configured." });
    }
    return next();
  }

  const header = req.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return res.status(401).json({ message: "Metrics authentication required." });

  const provided = Buffer.from(match[1]);
  const configured = Buffer.from(expected);
  if (provided.length !== configured.length || !crypto.timingSafeEqual(provided, configured)) {
    return res.status(401).json({ message: "Invalid metrics token." });
  }
  return next();
}

module.exports = { requireMetricsAuth };

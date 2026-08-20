const configured = (process.env.DASHBOARD_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (configured.length === 0 && process.env.NODE_ENV === "production") {
  console.warn(
    "[config] DASHBOARD_ORIGIN is not set in production — CORS is wide open. " +
      "Set DASHBOARD_ORIGIN to your Vercel frontend URL.",
  );
}

function corsOrigin(origin, callback) {
  // Server-to-server requests, curl and health checks do not send Origin.
  if (!origin) return callback(null, true);

  if (configured.includes(origin)) return callback(null, true);

  if (process.env.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(origin)) {
    return callback(null, true);
  }

  return callback(null, false);
}

module.exports = { corsOrigin, allowedOrigins: configured };
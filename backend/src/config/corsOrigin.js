/**
 * DASHBOARD_ORIGIN accepts a comma-separated list so both local dev and a
 * deployed Vercel frontend can be allowed at once, e.g.:
 *   DASHBOARD_ORIGIN=http://localhost:5173,https://livepulse.vercel.app
 */
const configured = (process.env.DASHBOARD_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (configured.length === 0 && process.env.NODE_ENV === "production") {
  console.warn(
    "[config] DASHBOARD_ORIGIN is not set in production - dashboard CORS will reject every origin. " +
      "Set it to your frontend URL.",
  );
}

// Dashboard routes only.
function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  if (configured.includes(origin)) return callback(null, true);
  if (
    process.env.NODE_ENV !== "production" &&
    /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(origin)
  ) {
    return callback(null, true);
  }
  return callback(null, false);
}

// Public surface: /sdk, /api/events, /api/v2/collect, visitor socket.
const publicCorsOptions = {
  origin: true,
  credentials: false,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key"],
  maxAge: 86400,
};

module.exports = { corsOrigin, publicCorsOptions, allowedOrigins: configured };

/**
 * DASHBOARD_ORIGIN accepts a comma-separated list so both local dev and a
 * deployed Vercel frontend can be allowed at once, e.g.:
 *   DASHBOARD_ORIGIN=http://localhost:5173,https://livepulse.vercel.app
 *
 * Falls back to allow-all in unconfigured local dev so `npm start` still
 * works out of the box, but logs a warning — production deploys should
 * always set this explicitly.
 */
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

/**
 * Vite chooses an available local port (this project is currently on 8080,
 * while many setups use 5173).  Requiring a manual .env edit every time that
 * port changes makes a healthy collector look "unreachable" in the browser.
 * Keep production explicit, but accept localhost development ports.
 */
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

const { verifySupabaseToken, AuthError } = require("../lib/verifySupabaseToken");

async function requireDashboardAuth(req, res, next) {
  try {
    const header = req.header("authorization") || req.header("Authorization");
    const token = header && header.startsWith("Bearer ") ? header.slice(7).trim() : null;

    if (!token) {
      return res.status(401).json({ message: "Missing dashboard session. Sign in and try again." });
    }

    const user = await verifySupabaseToken(token);
    req.user = user;
    next();
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({ message: error.message });
    }
    return res.status(500).json({ message: "Auth error", error: error.message });
  }
}

module.exports = { requireDashboardAuth };

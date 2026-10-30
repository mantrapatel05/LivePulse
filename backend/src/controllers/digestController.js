const Project = require("../models/Project");
const { verifyUnsubscribeToken } = require("../shared/digest/token");
const { logger } = require("../shared/logger");

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

async function updateDigestSettings(req, res) {
  const { enabled, ...rest } = req.body || {};
  if (Object.keys(rest).length || typeof enabled !== "boolean") {
    return res.status(400).json({ message: "Provide { enabled: boolean }" });
  }
  if (enabled) {
    if (req.project.analyticsBackend !== "clickhouse") {
      return res.status(409).json({ message: "The weekly digest is available after this project is migrated to ClickHouse." });
    }
    const email = req.user.email;
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ message: "Your account has no email address to send the digest to." });
    }
    if (req.user.emailVerified !== true) {
      return res.status(403).json({ message: "Confirm your email address before enabling the weekly digest." });
    }
    req.project.set("digest.email", email.toLowerCase());
  } else {
    req.project.set("digest.email", null);
  }
  req.project.set("digest.enabled", enabled);
  await req.project.save();
  return res.status(200).json({
    message: "Digest settings updated",
    project: { _id: String(req.project._id), digest: { enabled } },
  });
}

const UNSUBSCRIBE_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title>
<body style="font-family:Inter,Arial,sans-serif;max-width:420px;margin:15vh auto;padding:0 20px;color:#0a0a0a">
<h2>You're unsubscribed.</h2><p>You won't get the LivePulse weekly digest for this project anymore. You can turn it back on in the dashboard.</p></body>`;

async function unsubscribeDigest(req, res) {
  res.set({
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
  });
  const projectId = verifyUnsubscribeToken(req.query.t);
  if (!projectId) return res.status(400).type("text/plain").send("Invalid or expired link.");
  try {
    await Project.updateOne({ _id: projectId }, { $set: { "digest.enabled": false, "digest.email": null } });
  } catch (error) {
    logger.warn({ err: error?.name }, "digest unsubscribe failed");
    return res.status(500).type("text/plain").send("Something went wrong. Try again.");
  }
  return req.method === "POST"
    ? res.status(200).type("text/plain").send("Unsubscribed.")
    : res.status(200).type("html").send(UNSUBSCRIBE_PAGE);
}

module.exports = { updateDigestSettings, unsubscribeDigest };

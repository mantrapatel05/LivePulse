const crypto = require("crypto");

function secret() {
  const value = process.env.DIGEST_SECRET;
  if (!value || value.length < 16) throw new Error("DIGEST_SECRET must be set (16+ chars)");
  return value;
}

const mac = (body) => crypto.createHmac("sha256", secret()).update(body).digest();

function signUnsubscribeToken(projectId) {
  const body = Buffer.from(`unsub:${projectId}`).toString("base64url");
  return `${body}.${mac(body).toString("base64url")}`;
}

function verifyUnsubscribeToken(token) {
  try {
    if (typeof token !== "string" || token.length > 200) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [body, given] = parts;
    const expected = mac(body);
    const actual = Buffer.from(given, "base64url");
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    const decoded = Buffer.from(body, "base64url").toString();
    if (!decoded.startsWith("unsub:")) return null;
    const projectId = decoded.slice(6);
    return /^[a-f0-9]{24}$/i.test(projectId) ? projectId : null;
  } catch {
    return null;
  }
}

module.exports = { signUnsubscribeToken, verifyUnsubscribeToken };

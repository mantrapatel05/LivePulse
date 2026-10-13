/**
 * Deliberately not a full UA-parsing library (ua-parser-js et al. carry a
 * large, frequently-updated device/browser database). The dashboard only
 * ever shows device_type and a coarse browser name, so a short heuristic
 * covers the real-world cases at a fraction of the maintenance surface.
 */
function parseUserAgent(ua) {
  const s = String(ua || "");

  let deviceType = "desktop";
  if (/tablet|ipad/i.test(s)) deviceType = "tablet";
  else if (/mobi|android(?!.*tablet)|iphone/i.test(s)) deviceType = "mobile";

  let browser = "other";
  if (/edg\//i.test(s)) browser = "edge";
  else if (/chrome|crios/i.test(s)) browser = "chrome";
  else if (/firefox|fxios/i.test(s)) browser = "firefox";
  else if (/safari/i.test(s) && !/chrome|crios/i.test(s)) browser = "safari";

  return { deviceType, browser };
}

module.exports = { parseUserAgent };

const crypto = require("crypto");
const { ValidationError } = require("./errors");

const SCHEMA_VERSION = 2;
const MAX_EVENTS_PER_BATCH = 500;
const MAX_PROPERTY_STRING_LENGTH = 500;
const MAX_PROPERTY_DEPTH = 3;
const MAX_PROPERTY_KEYS = 40;

const KNOWN_EVENT_TYPES = new Set([
  "page_view",
  "click",
  "error",
  "rage_click",
  "custom",
  "time_on_page",
  "scroll_depth",
  "identify",
]);

// Denylist pattern for common PII keys
const PII_KEY_PATTERN =
  /(email|passw|ssn|social.?security|credit.?card|card.?number|cvv|phone|address|token|secret|auth|api.?key)/i;
const SCAN_LIMIT = 4000;
const QUERY_SENSITIVE_KEY = new RegExp(
  PII_KEY_PATTERN.source + "|(^|[_-])(code|sid|session|otp|reset|jwt|sig|signature|key|pwd|pass)($|[_-])",
  "i",
);
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const LP_KEY_RE = /\blp_(?:live|test)_[A-Za-z0-9_]{6,}/g;
const SECRET_RE = /\b(?:[spr]k_(?:live|test)_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/g;
const CARD_RE = /\b\d(?:[ -]?\d){12,18}\b/g;

function luhn(digits) {
  let sum = 0,
    alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function scrubString(input) {
  let s = String(input);
  if (s.length > SCAN_LIMIT) s = s.slice(0, SCAN_LIMIT);
  s = s.replace(EMAIL_RE, "[email]").replace(JWT_RE, "[jwt]").replace(LP_KEY_RE, "[key]").replace(SECRET_RE, "[key]");
  // A 13-19 digit Luhn-valid run (including some epoch-ms strings) is masked as a card number.
  return s.replace(CARD_RE, (m) => {
    const d = m.replace(/\D/g, "");
    return d.length >= 13 && d.length <= 19 && luhn(d) ? "[card]" : m;
  });
}

// Validate the batch envelope; throws ValidationError on failure
function validateEnvelope(body) {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Request body must be a JSON object");
  }
  if (body.schemaVersion !== SCHEMA_VERSION) {
    throw new ValidationError(
      `Unsupported schemaVersion "${body.schemaVersion}" — this endpoint accepts ${SCHEMA_VERSION}`,
    );
  }
  if (!body.sentAt || Number.isNaN(Date.parse(body.sentAt))) {
    throw new ValidationError("sentAt must be a valid ISO timestamp");
  }
  if (!Array.isArray(body.events) || body.events.length === 0) {
    throw new ValidationError("events must be a non-empty array");
  }
  if (body.events.length > MAX_EVENTS_PER_BATCH) {
    throw new ValidationError(`events exceeds the ${MAX_EVENTS_PER_BATCH}-per-batch limit`);
  }
  return true;
}

// Validate a single event; returns { ok, event } or { ok, error }
function validateEvent(raw, index) {
  const at = `events[${index}]`;
  if (!raw || typeof raw !== "object") return { ok: false, error: `${at} must be an object` };

  const sessionId = raw.sessionId;
  const eventType = raw.eventType;
  const url = raw.url;
  const consent = raw.consent;

  if (!sessionId || typeof sessionId !== "string" || sessionId.length > 200) {
    return { ok: false, error: `${at}.sessionId is required (string, <=200 chars)` };
  }
  if (!eventType || typeof eventType !== "string") {
    return { ok: false, error: `${at}.eventType is required` };
  }
  if (!url || typeof url !== "string" || url.length > 2048) {
    return { ok: false, error: `${at}.url is required (string, <=2048 chars)` };
  }
  // Reject events explicitly marked with denied consent
  if (consent === "denied") {
    return { ok: false, error: `${at} carries consent="denied" and must not be sent` };
  }

  const occurredAtRaw = raw.occurredAt ?? raw.timestamp;
  const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    return { ok: false, error: `${at}.occurredAt is not a valid date` };
  }

  const eventId = typeof raw.eventId === "string" && raw.eventId ? raw.eventId : crypto.randomUUID();

  return {
    ok: true,
    event: {
      eventId,
      sessionId,
      userId: typeof raw.userId === "string" ? raw.userId.slice(0, 200) : "anonymous",
      eventType: KNOWN_EVENT_TYPES.has(eventType) ? eventType : "custom",
      url: normalizeUrl(url),
      element: typeof raw.element === "string" ? scrubString(raw.element).slice(0, 300) : null,
      consent: consent === "granted" ? "granted" : "n/a",
      occurredAt,
      properties: sanitizeProperties(raw.properties ?? raw.metadata ?? {}),
      clientContext: sanitizeProperties(raw.clientContext ?? {}, { maxKeys: 20 }),
    },
  };
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    u.username = "";
    u.password = "";
    let decoded = u.pathname;
    try {
      decoded = decodeURI(u.pathname);
    } catch {}
    const cleanPath = scrubString(decoded);
    if (cleanPath !== decoded) u.pathname = cleanPath;
    for (const [k, v] of [...u.searchParams.entries()]) {
      if (QUERY_SENSITIVE_KEY.test(k) || scrubString(v) !== v) u.searchParams.set(k, "[redacted]");
    }
    return u.toString();
  } catch {
    return scrubString(String(url)).slice(0, 2048);
  }
}

// Strip PII, cap string length/depth/keys, and apply optional allowlist
function sanitizeProperties(input, { depth = 0, allowlist = null, maxKeys = MAX_PROPERTY_KEYS } = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return sanitizeScalar(input);
  }
  if (depth >= MAX_PROPERTY_DEPTH) return "[max depth exceeded]";

  const out = {};
  let count = 0;
  for (const [key, value] of Object.entries(input)) {
    if (count >= maxKeys) break;
    if (allowlist && !allowlist.includes(key)) continue;
    if (PII_KEY_PATTERN.test(key)) {
      out[key] = "[redacted]";
      count++;
      continue;
    }
    out[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? sanitizeProperties(value, { depth: depth + 1, allowlist, maxKeys })
        : sanitizeScalar(value);
    count++;
  }
  return out;
}

function sanitizeScalar(value) {
  if (typeof value === "string") {
    const s = /^https?:\/\//i.test(value) ? normalizeUrl(value) : scrubString(value);
    return s.slice(0, MAX_PROPERTY_STRING_LENGTH);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitizeScalar(v));
  return scrubString(String(value)).slice(0, MAX_PROPERTY_STRING_LENGTH);
}

module.exports = {
  SCHEMA_VERSION,
  MAX_EVENTS_PER_BATCH,
  validateEnvelope,
  validateEvent,
  sanitizeProperties,
  normalizeUrl,
  scrubString,
};

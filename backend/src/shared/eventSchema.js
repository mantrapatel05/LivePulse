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
      element: typeof raw.element === "string" ? raw.element.slice(0, 300) : null,
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
    return u.toString();
  } catch {
    return String(url).slice(0, 2048);
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
  if (typeof value === "string") return value.slice(0, MAX_PROPERTY_STRING_LENGTH);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitizeScalar(v));
  return String(value).slice(0, MAX_PROPERTY_STRING_LENGTH);
}

module.exports = {
  SCHEMA_VERSION,
  MAX_EVENTS_PER_BATCH,
  validateEnvelope,
  validateEvent,
  sanitizeProperties,
  normalizeUrl,
};

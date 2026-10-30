class SpecError extends Error {
  constructor(message) {
    super(message);
    this.name = "SpecError";
  }
}

const METRICS = ["events", "sessions", "page_views", "errors", "rage_clicks", "avg_engaged_seconds"];
const GROUPS = ["url_path", "device_type", "browser", "country", "event_type", "hour", "day"];
const FIELDS = ["device_type", "browser", "country", "url_path", "event_type"];
const OPS = ["eq", "neq", "contains"];
const RANGES = ["last_hour", "today", "yesterday", "last_24h", "last_7d", "prev_7d", "last_30d"];
const ORDERS = ["value_desc", "value_asc", "time_asc"];
const SPEC_KEYS = ["metric", "groupBy", "filters", "range", "orderBy", "limit", "unsupported"];
const FILTER_KEYS = ["field", "op", "value"];
const DEVICES = new Set(["desktop", "mobile", "tablet"]);
const TIME_GROUPS = new Set(["hour", "day"]);
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/;

const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function pickEnum(value, values, field) {
  if (typeof value !== "string" || !values.includes(value)) throw new SpecError(`invalid ${field}`);
  return value;
}

function boundedString(value, field, max) {
  if (typeof value !== "string") throw new SpecError(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new SpecError(`${field} length out of range`);
  if (CONTROL.test(normalized)) throw new SpecError(`${field} has control characters`);
  return normalized;
}

function validateFilter(raw) {
  if (!isPlain(raw) || !Object.keys(raw).every((key) => FILTER_KEYS.includes(key))) {
    throw new SpecError("invalid filter");
  }
  const field = pickEnum(raw.field, FIELDS, "filter field");
  const op = pickEnum(raw.op, OPS, "filter op");
  let value = boundedString(raw.value, "filter value", 100);
  if (["device_type", "browser", "event_type"].includes(field)) value = value.toLowerCase();
  if (field === "country") value = value.toUpperCase();
  if (field === "device_type" && op !== "contains" && !DEVICES.has(value)) {
    throw new SpecError("device_type must be desktop, mobile or tablet");
  }
  return { field, op, value };
}

/** Hand-validates model JSON. Unknown keys at either level reject the complete spec. */
function validateSpec(raw) {
  if (!isPlain(raw)) throw new SpecError("spec must be an object");
  if (!Object.keys(raw).every((key) => SPEC_KEYS.includes(key))) throw new SpecError("unknown spec key");

  if (raw.unsupported !== undefined && raw.unsupported !== null) {
    return { unsupported: boundedString(raw.unsupported, "unsupported", 140) };
  }

  const metric = pickEnum(raw.metric, METRICS, "metric");
  const groupBy = raw.groupBy == null ? null : pickEnum(raw.groupBy, GROUPS, "groupBy");
  let filters = [];
  if (raw.filters !== undefined && raw.filters !== null) {
    if (!Array.isArray(raw.filters) || raw.filters.length > 4) {
      throw new SpecError("filters must be an array of at most 4");
    }
    filters = raw.filters.map(validateFilter);
  }
  const range = pickEnum(raw.range, RANGES, "range");
  let orderBy = raw.orderBy == null
    ? (TIME_GROUPS.has(groupBy) ? "time_asc" : "value_desc")
    : pickEnum(raw.orderBy, ORDERS, "orderBy");
  if (orderBy === "time_asc" && !TIME_GROUPS.has(groupBy)) orderBy = "value_desc";

  let limit = 10;
  if (raw.limit !== undefined && raw.limit !== null) {
    if (!Number.isInteger(raw.limit) || raw.limit < 1 || raw.limit > 50) {
      throw new SpecError("limit must be an integer 1..50");
    }
    limit = raw.limit;
  }
  return { metric, groupBy, filters, range, orderBy, limit, unsupported: null };
}

/** Rolling windows end now; today/yesterday are UTC calendar periods. */
function resolveRange(range, now = new Date()) {
  const hour = 3600000;
  const day = 24 * hour;
  const end = now.getTime();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  switch (range) {
    case "last_hour": return { fromMs: end - hour, toMs: end };
    case "today": return { fromMs: midnight, toMs: end };
    case "yesterday": return { fromMs: midnight - day, toMs: midnight };
    case "last_24h": return { fromMs: end - day, toMs: end };
    case "last_7d": return { fromMs: end - 7 * day, toMs: end };
    case "prev_7d": return { fromMs: end - 14 * day, toMs: end - 7 * day };
    case "last_30d": return { fromMs: end - 30 * day, toMs: end };
    default: throw new SpecError("invalid range");
  }
}

const METRIC_LABELS = {
  events: "events", sessions: "sessions", page_views: "page views", errors: "errors",
  rage_clicks: "rage clicks", avg_engaged_seconds: "average engaged seconds",
};
const GROUP_LABELS = {
  url_path: "page", device_type: "device", browser: "browser", country: "country",
  event_type: "event type", hour: "hour", day: "day",
};
const FIELD_LABELS = {
  device_type: "device", browser: "browser", country: "country", url_path: "page", event_type: "event type",
};
const OP_LABELS = { eq: "=", neq: "is not", contains: "contains" };
const RANGE_LABELS = {
  last_hour: "last hour", today: "today (UTC)", yesterday: "yesterday (UTC)",
  last_24h: "last 24 hours", last_7d: "last 7 days", prev_7d: "the 7 days before the last 7",
  last_30d: "last 30 days",
};

function describeSpec(spec) {
  const parts = [METRIC_LABELS[spec.metric]];
  if (spec.groupBy) parts.push(`grouped by ${GROUP_LABELS[spec.groupBy]}`);
  for (const filter of spec.filters) {
    parts.push(`where ${FIELD_LABELS[filter.field]} ${OP_LABELS[filter.op]} ${filter.value}`);
  }
  parts.push(RANGE_LABELS[spec.range]);
  return parts.join(", ");
}

module.exports = { SpecError, validateSpec, resolveRange, describeSpec, METRIC_LABELS, GROUP_LABELS, TIME_GROUPS };

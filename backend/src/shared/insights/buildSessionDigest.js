const crypto = require("crypto");
const { isIP } = require("node:net");

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
const MAX_EVENTS = 150;
const EDGE_EVENTS = 15;

function clean(value, max) {
  return String(value ?? "")
    .replace(CONTROL, " ")
    .replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
      try { return new URL(raw).pathname || "/"; } catch { return "[url]"; }
    })
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]")
    .replace(/(^|[^\w:])([0-9a-f:.]{3,})(?=$|[^\w:])/gi, (whole, prefix, candidate) => isIP(candidate) === 6 ? `${prefix}[ip]` : whole)
    .replace(/\b(user[_-]?id|ip|email|token|secret|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function pathOf(value) {
  const raw = clean(value, 2048);
  try {
    return clean(new URL(raw, "https://livepulse.invalid").pathname || "/", 120);
  } catch {
    return clean(raw.split(/[?#]/, 1)[0], 120);
  }
}

function parseProps(raw) {
  try {
    return typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {};
  } catch {
    return {};
  }
}

function timeMs(value) {
  const raw = String(value ?? "");
  const normalized = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildSessionDigest({ summary = {}, events = [] }) {
  const startMs = timeMs(summary.started_at);
  const rows = events.slice(0, 2000).map((event, index) => {
    const props = parseProps(event.properties);
    const id = `e${index + 1}`;
    const row = {
      id,
      eventId: String(event.event_id ?? ""),
      t: Math.max(0, Math.round((timeMs(event.occurred_at) - startMs) / 1000)),
      type: clean(event.event_type, 30),
      path: pathOf(event.url),
    };
    if (event.element) row.element = clean(event.element, 60);
    if (row.type === "error") row.message = clean(props.message, 160);
    if (row.type === "scroll_depth") row.depth = Number(props.depth) || 0;
    if (row.type === "time_on_page") row.seconds = Number(props.seconds) || 0;
    return row;
  });

  const keep = (row, index) =>
    index < EDGE_EVENTS || index >= rows.length - EDGE_EVENTS || row.type === "error" || row.type === "rage_click";
  const compact = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (keep(row, index)) {
      compact.push(row);
      continue;
    }
    const previous = compact[compact.length - 1];
    if (previous?.collapsed && previous.type === row.type && previous.path === row.path) {
      previous.count += 1;
      previous.lastId = row.id;
      previous.lastT = row.t;
    } else {
      compact.push({ type: row.type, path: row.path, count: 1, firstId: row.id, lastId: row.id, t: row.t, lastT: row.t, collapsed: true });
    }
  }

  let final = compact;
  let truncated = events.length > rows.length || compact.some((item) => item.collapsed);
  if (compact.length > MAX_EVENTS) {
    truncated = true;
    const chosen = new Set([...compact.slice(0, EDGE_EVENTS), ...compact.slice(-EDGE_EVENTS)]);
    for (const item of compact) {
      if (chosen.size >= MAX_EVENTS) break;
      if (!item.collapsed) chosen.add(item);
    }
    for (const item of compact) {
      if (chosen.size >= MAX_EVENTS) break;
      chosen.add(item);
    }
    final = compact.filter((item) => chosen.has(item));
  }

  const idMap = {};
  const digestEvents = final.map((item) => {
    const { eventId, collapsed, ...safe } = item;
    if (eventId !== undefined) idMap[item.id] = eventId;
    if (collapsed) {
      idMap[item.firstId] = rows.find((row) => row.id === item.firstId)?.eventId || "";
      idMap[item.lastId] = rows.find((row) => row.id === item.lastId)?.eventId || "";
      delete safe.collapsed;
    }
    if (!collapsed && safe.type !== "error" && safe.count === undefined) delete safe.count;
    return safe;
  });

  const session = {
    durationSec: Math.max(0, Math.round((timeMs(summary.last_seen_at) - startMs) / 1000)),
    totalEvents: Number(summary.events) || events.length,
    errors: Number(summary.errors) || 0,
    engagedSec: Number(summary.engaged_seconds) || 0,
    entryPath: pathOf(summary.entry_url),
    exitPath: pathOf(summary.exit_url),
  };
  const includedEvents = digestEvents.reduce((count, event) => count + (Number(event.count) || 1), 0);
  const digest = {
    session,
    truncated,
    counts: { inputEvents: events.length, includedEvents, omittedEvents: Math.max(0, events.length - includedEvents), errors: session.errors },
    events: digestEvents,
  };
  const digestHash = crypto.createHash("sha256").update(canonical(digest)).digest("hex");
  return { digest, idMap, digestHash };
}

module.exports = { buildSessionDigest, clean, pathOf, canonical };

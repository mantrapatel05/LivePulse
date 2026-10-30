const { resolveRange, METRIC_LABELS, GROUP_LABELS, TIME_GROUPS } = require("./querySpec");

const METRIC_SQL = {
  events: "count()",
  sessions: "uniqExact(session_id)",
  page_views: "countIf(event_type = 'page_view')",
  errors: "countIf(event_type = 'error')",
  rage_clicks: "countIf(event_type = 'rage_click')",
  avg_engaged_seconds: "avgIf(JSONExtract(properties, 'seconds', 'Nullable(Float64)'), event_type = 'time_on_page')",
};
const GROUP_SQL = {
  url_path: "url_path", device_type: "device_type", browser: "browser", country: "country",
  event_type: "event_type", hour: "toStartOfHour(occurred_at, 'UTC')", day: "toStartOfDay(occurred_at, 'UTC')",
};
const FIELD_SQL = { device_type: "device_type", browser: "browser", country: "country", url_path: "url_path", event_type: "event_type" };
const OP_SQL = {
  eq: (column, param) => `${column} = ${param}`,
  neq: (column, param) => `${column} != ${param}`,
  contains: (column, param) => `positionCaseInsensitive(${column}, ${param}) > 0`,
};

function lookup(table, key) {
  if (!Object.prototype.hasOwnProperty.call(table, key)) throw new Error("compile: unknown key");
  return table[key];
}

const chDate = (ms) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");
const positive = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);

function nlqSettings() {
  return {
    max_execution_time: String(positive(process.env.NLQ_MAX_EXECUTION_SECONDS, 5)),
    max_rows_to_read: String(positive(process.env.NLQ_MAX_ROWS_TO_READ, 50_000_000)),
  };
}

function compileSpec(spec, { projectId, now = new Date() }) {
  if (!spec || spec.unsupported) throw new Error("compile: spec is unsupported");
  const { fromMs, toMs } = resolveRange(spec.range, now);
  const where = [
    "project_id = {projectId:String}",
    "occurred_at >= {from:DateTime64(3, 'UTC')}",
    "occurred_at < {to:DateTime64(3, 'UTC')}",
  ];
  const query_params = { projectId: String(projectId), from: chDate(fromMs), to: chDate(toMs) };
  spec.filters.forEach((filter, index) => {
    where.push(lookup(OP_SQL, filter.op)(lookup(FIELD_SQL, filter.field), `{f${index}:String}`));
    query_params[`f${index}`] = filter.value;
  });

  const metricExpr = lookup(METRIC_SQL, spec.metric);
  const columns = [];
  let query;
  let fetchLimit = 1;
  if (spec.groupBy) {
    const groupExpr = lookup(GROUP_SQL, spec.groupBy);
    const isTime = TIME_GROUPS.has(spec.groupBy);
    const order = spec.orderBy === "time_asc" ? "ORDER BY label ASC"
      : spec.orderBy === "value_asc" ? "ORDER BY value ASC, label ASC"
        : "ORDER BY value DESC, label ASC";
    fetchLimit = spec.limit + 1;
    query_params.limit = fetchLimit;
    query = `
      SELECT ${groupExpr} AS label, ${metricExpr} AS value
      FROM events_v2
      WHERE ${where.join("\n        AND ")}
      GROUP BY label
      ${order}
      LIMIT {limit:UInt32}
    `;
    columns.push({ key: "label", label: lookup(GROUP_LABELS, spec.groupBy), type: isTime ? "time" : "text" });
  } else {
    query = `
      SELECT ${metricExpr} AS value
      FROM events_v2
      WHERE ${where.join("\n        AND ")}
    `;
  }
  columns.push({ key: "value", label: lookup(METRIC_LABELS, spec.metric), type: "number" });
  return {
    query,
    query_params,
    columns,
    fetchLimit,
    clickhouse_settings: nlqSettings(),
    range: {
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
      timezone: "UTC",
    },
  };
}

module.exports = { compileSpec, METRIC_SQL, GROUP_SQL, FIELD_SQL };

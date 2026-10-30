const { compileSpec } = require("../../src/shared/nlq/compileSpec");
const { validateSpec } = require("../../src/shared/nlq/querySpec");

const METRICS = ["events", "sessions", "page_views", "errors", "rage_clicks", "avg_engaged_seconds"];
const GROUPS = [null, "url_path", "device_type", "browser", "country", "event_type", "hour", "day"];
const placeholders = (query) => [...new Set([...query.matchAll(/\{(\w+):/g)].map((match) => match[1]))];

describe("compileSpec", () => {
  it("keeps hostile filter values out of SQL text and binds them as parameters", () => {
    const hostile = "'; DROP TABLE events_v2; --";
    const spec = validateSpec({
      metric: "events", range: "today",
      filters: [
        { field: "url_path", op: "eq", value: hostile },
        { field: "url_path", op: "contains", value: "{projectId:String}" },
      ],
    });
    const compiled = compileSpec(spec, { projectId: "authenticated-project" });
    expect(compiled.query).not.toContain("DROP TABLE");
    expect(compiled.query.split("{projectId:String}")).toHaveLength(2);
    expect(compiled.query_params.f0).toBe(hostile);
    expect(compiled.query_params.f1).toBe("{projectId:String}");
    expect(compiled.query_params.projectId).toBe("authenticated-project");
    expect(compiled.query).toContain("positionCaseInsensitive(url_path, {f1:String}) > 0");
    expect(compiled.query).not.toMatch(/\bLIKE\b/i);
  });

  it("binds every placeholder and compiles every metric/grouping combination", () => {
    for (const metric of METRICS) {
      for (const groupBy of GROUPS) {
        const spec = validateSpec({ metric, groupBy, range: "last_24h", filters: [{ field: "country", op: "neq", value: "US" }] });
        const { query, query_params } = compileSpec(spec, { projectId: "p1" });
        const names = placeholders(query);
        for (const name of names) expect(query_params).toHaveProperty(name);
        for (const key of Object.keys(query_params)) expect(names).toContain(key);
        expect(query).toContain("project_id = {projectId:String}");
        expect(query).not.toContain("US");
      }
    }
  });

  it("fetches one extra grouped row to detect truncation", () => {
    const grouped = compileSpec(validateSpec({ metric: "events", groupBy: "url_path", range: "today", limit: 50 }), { projectId: "p" });
    expect(grouped.query_params.limit).toBe(51);
    expect(grouped.fetchLimit).toBe(51);
    const flat = compileSpec(validateSpec({ metric: "events", range: "today" }), { projectId: "p" });
    expect(flat.query_params).not.toHaveProperty("limit");
  });

  it("returns resource caps, UTC windows and column metadata", () => {
    const compiled = compileSpec(validateSpec({ metric: "sessions", groupBy: "day", range: "last_7d" }), { projectId: "p" });
    expect(compiled.clickhouse_settings).toEqual({ max_execution_time: "5", max_rows_to_read: "50000000" });
    expect(compiled.columns).toEqual([
      { key: "label", label: "day", type: "time" },
      { key: "value", label: "sessions", type: "number" },
    ]);
    expect(compiled.range.timezone).toBe("UTC");
    expect(compiled.query).toContain("DateTime64(3, 'UTC')");
  });

  it("refuses unsupported specs", () => {
    expect(() => compileSpec({ unsupported: "no" }, { projectId: "p" })).toThrow();
  });
});

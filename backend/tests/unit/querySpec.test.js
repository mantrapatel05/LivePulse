const { validateSpec, SpecError, resolveRange, describeSpec } = require("../../src/shared/nlq/querySpec");

const base = { metric: "sessions", range: "last_7d" };

describe("validateSpec", () => {
  it("applies defaults", () => {
    expect(validateSpec(base)).toEqual({
      metric: "sessions", groupBy: null, filters: [], range: "last_7d",
      orderBy: "value_desc", limit: 10, unsupported: null,
    });
  });

  it("rejects unknown spec keys, including projectId, sql and __proto__", () => {
    expect(() => validateSpec({ ...base, projectId: "other" })).toThrow(SpecError);
    expect(() => validateSpec({ ...base, sql: "DROP TABLE x" })).toThrow(SpecError);
    expect(() => validateSpec(JSON.parse('{"metric":"events","range":"today","__proto__":{"a":1}}'))).toThrow(SpecError);
  });

  it("rejects invalid enums, types and limits", () => {
    expect(() => validateSpec({ ...base, metric: "revenue" })).toThrow(SpecError);
    expect(() => validateSpec({ ...base, groupBy: "user_id" })).toThrow(SpecError);
    expect(() => validateSpec({ ...base, range: "all_time" })).toThrow(SpecError);
    for (const limit of [0, 51, 1.5, "10"]) expect(() => validateSpec({ ...base, limit })).toThrow(SpecError);
    expect(() => validateSpec("events")).toThrow(SpecError);
    expect(() => validateSpec([])).toThrow(SpecError);
  });

  it("rejects too many filters, long values, control characters and extra filter keys", () => {
    const filter = { field: "country", op: "eq", value: "US" };
    expect(() => validateSpec({ ...base, filters: [filter, filter, filter, filter, filter] })).toThrow(SpecError);
    expect(() => validateSpec({ ...base, filters: [{ ...filter, value: "x".repeat(101) }] })).toThrow(SpecError);
    expect(() => validateSpec({ ...base, filters: [{ ...filter, value: "a\u0000b" }] })).toThrow(SpecError);
    expect(() => validateSpec({ ...base, filters: [{ ...filter, column: "x" }] })).toThrow(SpecError);
    expect(() => validateSpec({ ...base, filters: [{ field: "properties", op: "eq", value: "x" }] })).toThrow(SpecError);
  });

  it("normalizes values and restricts device types", () => {
    const spec = validateSpec({ ...base, filters: [
      { field: "device_type", op: "eq", value: " Mobile " },
      { field: "country", op: "eq", value: "us" },
      { field: "browser", op: "contains", value: "CHROME" },
    ] });
    expect(spec.filters.map((filter) => filter.value)).toEqual(["mobile", "US", "chrome"]);
    expect(() => validateSpec({ ...base, filters: [{ field: "device_type", op: "eq", value: "phone" }] })).toThrow(SpecError);
  });

  it("passes a bounded unsupported message through without compiling a query", () => {
    expect(validateSpec({ unsupported: "I can only read analytics." })).toEqual({ unsupported: "I can only read analytics." });
    expect(() => validateSpec({ unsupported: "x".repeat(141) })).toThrow(SpecError);
  });

  it("normalizes ordering to the selected grouping", () => {
    expect(validateSpec({ ...base, groupBy: "url_path", orderBy: "time_asc" }).orderBy).toBe("value_desc");
    expect(validateSpec({ ...base, groupBy: "day" }).orderBy).toBe("time_asc");
  });

  it("revalidates a serialized cache spec", () => {
    const spec = validateSpec({ ...base, groupBy: "day", filters: [{ field: "country", op: "eq", value: "us" }] });
    expect(validateSpec(JSON.parse(JSON.stringify(spec)))).toEqual(spec);
  });
});

describe("resolveRange (UTC)", () => {
  const now = new Date("2026-10-30T10:30:00.000Z");
  const iso = (range) => [new Date(range.fromMs).toISOString(), new Date(range.toMs).toISOString()];
  it("resolves rolling and UTC calendar windows on the server", () => {
    expect(iso(resolveRange("last_hour", now))).toEqual(["2026-10-30T09:30:00.000Z", "2026-10-30T10:30:00.000Z"]);
    expect(iso(resolveRange("today", now))).toEqual(["2026-10-30T00:00:00.000Z", "2026-10-30T10:30:00.000Z"]);
    expect(iso(resolveRange("yesterday", now))).toEqual(["2026-10-29T00:00:00.000Z", "2026-10-30T00:00:00.000Z"]);
    expect(iso(resolveRange("last_7d", now))[0]).toBe("2026-10-23T10:30:00.000Z");
    expect(iso(resolveRange("prev_7d", now))).toEqual(["2026-10-16T10:30:00.000Z", "2026-10-23T10:30:00.000Z"]);
  });
});

describe("describeSpec", () => {
  it("renders a deterministic explanation from a validated spec", () => {
    const spec = validateSpec({
      metric: "sessions", groupBy: "url_path", range: "last_7d",
      filters: [{ field: "device_type", op: "eq", value: "mobile" }],
    });
    expect(describeSpec(spec)).toBe("sessions, grouped by page, where device = mobile, last 7 days");
  });
});

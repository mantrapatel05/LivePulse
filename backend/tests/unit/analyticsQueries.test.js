const {
  buildOverviewQuery,
  buildTodayVisitorsQuery,
  buildTimeseriesQuery,
  buildTopPagesQuery,
  buildEngagementWindowQuery,
  buildPageDeltaQuery,
  buildEventBreakdownQuery,
  buildErrorClustersQuery,
  buildErrorClustersRangeQuery,
  buildHistoricalSessionsQuery,
  buildSessionSummaryQuery,
  buildSessionTimelineEventsQuery,
  buildErrorClusterInsightQuery,
  buildErrorClusterRepresentativeSessionsQuery,
} = require("../../src/shared/analyticsQueries");

const range = { projectId: "p1", from: "2026-01-01 00:00:00", to: "2026-01-02 00:00:00" };

describe("analyticsQueries builders", () => {
  it("todayVisitors: counts distinct sessions from events_v2 with bound project and UTC start", () => {
    const input = { projectId: "p1", from: "2026-01-01 00:00:00.000" };
    const { query, query_params } = buildTodayVisitorsQuery(input);
    expect(query).toContain("FROM events_v2");
    expect(query).toContain("uniqExact(session_id)");
    expect(query).toContain("{projectId:String}");
    expect(query).toContain("{from:DateTime64(3)}");
    expect(query).not.toContain(input.projectId);
    expect(query_params).toEqual(input);
  });

  it("overview: scopes to events_v2, binds projectId/from/to as real params (not string-interpolated)", () => {
    const { query, query_params } = buildOverviewQuery(range);
    expect(query).toContain("FROM events_v2");
    expect(query).toContain("{projectId:String}");
    expect(query).toContain("{from:DateTime64(3)}");
    expect(query).toContain("{to:DateTime64(3)}");
    expect(query).not.toContain(range.projectId); // never inlined into the SQL text itself
    expect(query_params).toEqual(range);
  });

  it("overview: computes avg engaged time only over time_on_page events via avgIf", () => {
    const { query } = buildOverviewQuery(range);
    expect(query).toMatch(/avgIf\(.*event_type = 'time_on_page'/s);
  });

  it("timeseries: defaults to hourly buckets from event_minute_agg_v2, UTC by default", () => {
    const { query, query_params } = buildTimeseriesQuery(range);
    expect(query).toContain("FROM event_minute_agg_v2");
    expect(query).toContain("toStartOfHour(minute, {timezone:String})");
    expect(query_params.projectId).toBe("p1");
    expect(query_params.timezone).toBe("UTC");
  });

  it("timeseries: honors interval=day and interval=minute, and a custom timezone", () => {
    expect(buildTimeseriesQuery({ ...range, interval: "day" }).query).toContain(
      "toStartOfDay(minute, {timezone:String})",
    );
    expect(buildTimeseriesQuery({ ...range, interval: "minute" }).query).toMatch(/AS bucket[\s\S]*sum\(event_count\)/);
    expect(buildTimeseriesQuery({ ...range, interval: "minute" }).query).not.toContain("toStartOfHour");
    expect(buildTimeseriesQuery({ ...range, timezone: "America/New_York" }).query_params.timezone).toBe(
      "America/New_York",
    );
  });

  it("topPages: filters to page_view and orders by views desc, with a bound limit param", () => {
    const { query, query_params } = buildTopPagesQuery({ ...range, limit: 5 });
    expect(query).toContain("event_type = 'page_view'");
    expect(query).toContain("ORDER BY views DESC");
    expect(query).toContain("{limit:UInt32}");
    expect(query_params.limit).toBe(5);
  });

  it("topPages: defaults limit to 10 when not provided", () => {
    expect(buildTopPagesQuery(range).query_params.limit).toBe(10);
  });

  it("engagementWindow: scopes session and engagement counts to one bound interval", () => {
    const input = { projectId: "p1", from: range.from, to: range.to };
    const { query, query_params } = buildEngagementWindowQuery(input);
    expect(query).toContain("FROM events_v2");
    expect(query).toContain("uniqExact(session_id)");
    expect(query).toContain("event_type = 'rage_click'");
    expect(query).toContain("avg_engaged_seconds");
    expect(query).not.toContain(input.projectId);
    expect(query_params).toEqual(input);
  });

  it("pageDelta: counts current and previous page views in one bound scan", () => {
    const input = {
      projectId: "p1",
      curFrom: "2026-01-08 00:00:00",
      curTo: "2026-01-15 00:00:00",
      prevFrom: "2026-01-01 00:00:00",
      prevTo: "2026-01-08 00:00:00",
      limit: 50,
    };
    const { query, query_params } = buildPageDeltaQuery(input);
    expect(query).toContain("countIf");
    expect(query).toContain("url_path AS path");
    expect(query).toContain("event_type = 'page_view'");
    expect(query_params).toEqual(input);
  });

  it("eventBreakdown: reads the minute aggregate, grouped by event_type", () => {
    const { query } = buildEventBreakdownQuery(range);
    expect(query).toContain("FROM event_minute_agg_v2");
    expect(query).toContain("GROUP BY event_type");
  });

  it("errorClusters: merges AggregateFunction state columns with the *Merge combinators", () => {
    const { query, query_params } = buildErrorClustersQuery({ projectId: "p1", from: range.from });
    expect(query).toContain("FROM error_clusters_v2");
    expect(query).toContain("countMerge(occurrences)");
    expect(query).toContain("uniqMerge(affected_sessions)");
    expect(query_params.limit).toBe(20);
  });

  it("errorClusters range: filters raw errors to the exact requested interval", () => {
    const { query, query_params } = buildErrorClustersRangeQuery({ ...range, limit: 5 });
    expect(query).toContain("FROM events_v2");
    expect(query).toContain("event_type = 'error'");
    expect(query).toContain("occurred_at >= {from:DateTime64(3)}");
    expect(query).toContain("occurred_at < {to:DateTime64(3)}");
    expect(query_params).toEqual({ ...range, limit: 5 });
  });

  it("historicalSessions: filters session_summary_v2 by month partition then a precise HAVING on started_at", () => {
    const { query } = buildHistoricalSessionsQuery(range);
    expect(query).toContain("FROM session_summary_v2");
    expect(query).toContain("HAVING started_at >=");
    expect(query).toContain("countIfMerge(error_count)");
  });

  it("sessionSummary: keyed on exactly project_id + session_id, no date range needed", () => {
    const { query, query_params } = buildSessionSummaryQuery({ projectId: "p1", sessionId: "s1" });
    expect(query).toContain("WHERE project_id = {projectId:String} AND session_id = {sessionId:String}");
    expect(query_params).toEqual({ projectId: "p1", sessionId: "s1" });
  });

  it("sessionTimelineEvents: bounds occurred_at to the session's own start/end, not an arbitrary global range", () => {
    const { query, query_params } = buildSessionTimelineEventsQuery({
      projectId: "p1",
      sessionId: "s1",
      startedAt: "2026-01-01 10:00:00",
      lastSeenAt: "2026-01-01 10:05:00",
    });
    expect(query).toContain("session_id = {sessionId:String}");
    expect(query).toContain("subtractSeconds({startedAt:DateTime64(3)}, 1)");
    expect(query).toContain("addSeconds({lastSeenAt:DateTime64(3)}, 1)");
    expect(query_params.startedAt).toBe("2026-01-01 10:00:00");
  });

  it("errorClusterInsight: binds the signature and bounds it to the requested project range", () => {
    const input = { ...range, signature: "TypeError #" };
    const built = buildErrorClusterInsightQuery(input);
    expect(built.query).toContain("WHERE signature = {signature:String}");
    expect(built.query).toContain("event_type = 'error'");
    expect(built.query).not.toContain(input.signature);
    expect(built.query_params).toEqual(input);
  });

  it("errorClusterRepresentativeSessions: returns a bounded set of sessions for the selected signature", () => {
    const input = { ...range, signature: "TypeError #", limit: 5 };
    const built = buildErrorClusterRepresentativeSessionsQuery(input);
    expect(built.query).toContain("GROUP BY session_id");
    expect(built.query).toContain("LIMIT {limit:UInt32}");
    expect(built.query_params).toEqual(input);
  });

  it("every builder returns only real ClickHouse param placeholders that appear in query_params", () => {
    const builders = [
      buildOverviewQuery(range),
      buildTodayVisitorsQuery({ projectId: "p1", from: range.from }),
      buildTimeseriesQuery(range),
      buildTopPagesQuery(range),
      buildEngagementWindowQuery({ ...range }),
      buildPageDeltaQuery({
        projectId: "p1",
        curFrom: range.from,
        curTo: range.to,
        prevFrom: range.from,
        prevTo: range.to,
      }),
      buildEventBreakdownQuery(range),
      buildErrorClustersQuery({ projectId: "p1", from: range.from }),
      buildErrorClustersRangeQuery(range),
      buildHistoricalSessionsQuery(range),
      buildSessionSummaryQuery({ projectId: "p1", sessionId: "s1" }),
      buildSessionTimelineEventsQuery({
        projectId: "p1",
        sessionId: "s1",
        startedAt: range.from,
        lastSeenAt: range.to,
      }),
      buildErrorClusterInsightQuery({ ...range, signature: "sig" }),
      buildErrorClusterRepresentativeSessionsQuery({ ...range, signature: "sig", limit: 5 }),
    ];
    for (const { query, query_params } of builders) {
      const placeholders = [...query.matchAll(/\{(\w+):/g)].map((m) => m[1]);
      for (const name of new Set(placeholders)) {
        expect(query_params).toHaveProperty(name);
      }
    }
  });
});

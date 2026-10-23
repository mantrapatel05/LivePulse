const { parseStreamEntries } = require("../../src/shared/redisStream");

describe("Redis Stream trace context", () => {
  it("parses W3C trace context alongside the event envelope", () => {
    const raw = [
      [
        "events:v2",
        [["1710000000000-0", [
          "projectId", "project-1",
          "correlationId", "request-1",
          "payload", '{"eventType":"page_view"}',
          "traceparent", "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
          "tracestate", "vendor=value",
        ]]],
      ],
    ];

    expect(parseStreamEntries(raw)).toEqual([
      {
        id: "1710000000000-0",
        projectId: "project-1",
        correlationId: "request-1",
        event: { eventType: "page_view" },
        traceContext: {
          traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
          tracestate: "vendor=value",
        },
      },
    ]);
  });

  it("keeps legacy stream entries unchanged when trace context is absent", () => {
    const raw = [["events:v2", [["1710000000000-0", ["projectId", "project-1", "payload", "{}"]]]]];
    expect(parseStreamEntries(raw)).toEqual([
      { id: "1710000000000-0", projectId: "project-1", correlationId: undefined, event: {} },
    ]);
  });
});

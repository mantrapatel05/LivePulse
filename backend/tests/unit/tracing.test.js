const tracing = require("../../src/shared/tracing");

describe("backend tracing helpers", () => {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const tracesEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  const sampleRate = process.env.OTEL_TRACES_SAMPLE_RATE;

  beforeEach(() => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    delete process.env.OTEL_TRACES_SAMPLE_RATE;
  });

  afterAll(() => {
    if (endpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = endpoint;
    if (tracesEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = tracesEndpoint;
    if (sampleRate === undefined) delete process.env.OTEL_TRACES_SAMPLE_RATE;
    else process.env.OTEL_TRACES_SAMPLE_RATE = sampleRate;
  });

  it("keeps tracing disabled when no OTLP endpoint is configured", () => {
    expect(tracing.initializeTracing("livepulse-test")).toBe(false);
    expect(tracing.currentTraceContext()).toEqual({});
  });

  it("rejects an invalid sampling rate before starting the SDK", () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector:4318";
    process.env.OTEL_TRACES_SAMPLE_RATE = "1.5";
    expect(() => tracing.initializeTracing("livepulse-test")).toThrow("OTEL_TRACES_SAMPLE_RATE");
  });

  it("runs spans around async work and preserves failures", async () => {
    await expect(tracing.withSpan("test.success", {}, async () => "ok")).resolves.toBe("ok");
    await expect(
      tracing.withSpan("test.failure", {}, async () => {
        throw new Error("expected failure");
      }),
    ).rejects.toThrow("expected failure");
  });

  it("finishes request spans without recording raw request URLs", () => {
    let finish;
    const request = {
      method: "GET",
      headers: { traceparent: "invalid", tracestate: "" },
      baseUrl: "/api/v2/projects",
      route: { path: "/:projectId/health" },
      originalUrl: "/api/v2/projects/private-id/health?token=secret",
    };
    const response = {
      statusCode: 200,
      once: jest.fn((_event, callback) => {
        finish = callback;
      }),
    };
    const next = jest.fn();

    tracing.startRequestSpan(request, response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(() => finish()).not.toThrow();
  });
});

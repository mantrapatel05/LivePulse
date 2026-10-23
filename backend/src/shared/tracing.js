"use strict";

const {
  context,
  isSpanContextValid,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} = require("@opentelemetry/api");
const { httpRequests, httpRequestDuration } = require("./metrics");

const tracer = trace.getTracer("livepulse");
let sdk;

function initializeTracing(defaultServiceName) {
  if (sdk) return true;
  if (process.env.OTEL_TRACES_EXPORTER === "none") return false;
  if (!process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT && !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return false;

  const sampleRate = Number(process.env.OTEL_TRACES_SAMPLE_RATE ?? 0.1);
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
    throw new Error("OTEL_TRACES_SAMPLE_RATE must be a number between 0 and 1.");
  }

  const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
  const { NodeSDK } = require("@opentelemetry/sdk-node");
  const { ParentBasedSampler, TraceIdRatioBasedSampler } = require("@opentelemetry/sdk-trace");

  sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME || defaultServiceName,
    traceExporter: new OTLPTraceExporter(),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(sampleRate) }),
  });
  sdk.start();
  return true;
}

function startRequestSpan(req, res, next) {
  const startedAt = process.hrtime.bigint();
  const parent = propagation.extract(context.active(), {
    traceparent: req.headers?.traceparent,
    tracestate: req.headers?.tracestate,
  });
  const span = tracer.startSpan(
    "HTTP request",
    {
      kind: SpanKind.SERVER,
      attributes: { "http.request.method": req.method },
    },
    parent,
  );

  res.once("finish", () => {
    const routePath = req.route?.path;
    let route = "unmatched";
    if (typeof routePath === "string") {
      route = `${req.baseUrl || ""}${routePath}`.replace(/\/{2,}/g, "/");
      span.setAttribute("http.route", route);
      span.updateName(`${req.method} ${route}`);
    }

    span.setAttribute("http.response.status_code", res.statusCode);
    const labels = { route, method: req.method };
    httpRequests?.inc({ ...labels, status_code: String(res.statusCode) });
    httpRequestDuration?.observe(labels, Number(process.hrtime.bigint() - startedAt) / 1e6);
    if (res.statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: "request failed" });
    }
    span.end();
  });

  return context.with(trace.setSpan(parent, span), next);
}

function withSpan(name, attributes, operation, { links = [], root = false } = {}) {
  const parent = root ? ROOT_CONTEXT : context.active();
  const span = tracer.startSpan(name, { attributes, links }, parent);
  const active = trace.setSpan(parent, span);

  return context.with(active, async () => {
    try {
      return await operation(span);
    } catch (error) {
      span.setAttribute("error.type", error?.name || "Error");
      span.setStatus({ code: SpanStatusCode.ERROR, message: "operation failed" });
      throw error;
    } finally {
      span.end();
    }
  });
}

function currentTraceContext() {
  const spanContext = trace.getSpanContext(context.active());
  if (!spanContext || !isSpanContextValid(spanContext)) return {};

  const flags = Number(spanContext.traceFlags || 0)
    .toString(16)
    .padStart(2, "0");
  const carrier = { traceparent: `00-${spanContext.traceId}-${spanContext.spanId}-${flags}` };
  const tracestate = spanContext.traceState?.serialize();
  if (tracestate) carrier.tracestate = tracestate;
  return carrier;
}

function linksFromTraceContexts(traceContexts, limit = 32) {
  return (traceContexts || [])
    .slice(0, limit)
    .map((carrier) => trace.getSpanContext(propagation.extract(ROOT_CONTEXT, carrier || {})))
    .filter((spanContext) => spanContext && isSpanContextValid(spanContext))
    .map((spanContext) => ({ context: spanContext }));
}

function shutdownTracing() {
  return sdk ? sdk.shutdown() : Promise.resolve();
}

module.exports = {
  currentTraceContext,
  initializeTracing,
  linksFromTraceContexts,
  shutdownTracing,
  startRequestSpan,
  withSpan,
};

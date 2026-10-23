const pino = require("pino");
const { context, isSpanContextValid, trace } = require("@opentelemetry/api");

const baseLogger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { service: process.env.SERVICE_NAME || "livepulse-backend" },
  timestamp: pino.stdTimeFunctions.isoTime,
  mixin() {
    const spanContext = trace.getSpanContext(context.active());
    if (!spanContext || !isSpanContextValid(spanContext)) return {};
    return {
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
      trace_flags: Number(spanContext.traceFlags || 0).toString(16).padStart(2, "0"),
    };
  },
});

function withCorrelation(correlationId, extra = {}) {
  return baseLogger.child({ correlationId, ...extra });
}

module.exports = { logger: baseLogger, withCorrelation };

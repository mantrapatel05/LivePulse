# LivePulse observability setup

The repository provides OpenTelemetry trace export, Prometheus scrape targets, and a provisioned Grafana operations dashboard. These files do not deploy a collector, Prometheus, Tempo, or Grafana.

## Application traces

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to the OTLP/HTTP endpoint for your collector or tracing backend in both the API and worker environments. The application exports no traces while this variable is unset. The default root sampling rate is 10%; set `OTEL_TRACES_SAMPLE_RATE` from `0` to `1` to change it. The standard `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` variable is also accepted.

The API creates server spans and child ingestion/query spans. Trace context is carried through Redis Streams, and ClickHouse worker batches link to a bounded set of source spans. Trace attributes avoid event payloads and user supplied URLs. Pino JSON logs include `trace_id` and `span_id` while a span is active.

AI insight provider calls use `livepulse.llm.generate` spans without prompt or telemetry attributes. Logs record only model, token counts, latency, and outcome. Prometheus exports request outcomes by insight kind, provider latency in milliseconds, and token totals by direction. The dashboard includes insight request results and p95 latency; alerts cover sustained degradation/error rates above 25% and p95 latency above 12 seconds. Do not add prompt or event text to traces, logs, or metric labels.

## Weekly digest worker

`digestWorker.js` is a separate process. It ticks every 60 seconds and sends on Monday from 09:00 UTC, once per project per ISO week. It exposes `/metrics` on `DIGEST_METRICS_PORT` (default 9465), protected by the same `METRICS_TOKEN`. `livepulse_digest_sends_total{result=sent|skipped|failed|duplicate}` counts outcomes; `LivePulseDigestSendFailures` alerts on repeated failures. Logs contain project id, week, error name, and HTTP status only; provider response bodies and error messages are never logged.

## Ask your analytics (NLQ)

`POST /api/v2/projects/:id/ask` translates a question into an enum-only spec, validates it, compiles it from server-side lookup tables with bound parameters, and runs it with `max_execution_time` and `max_rows_to_read` limits. Metrics use `livepulse_nlq_requests_total{result}`; ClickHouse latency uses `livepulse_query_latency_ms{endpoint="v2_nlq"}`. Logs contain outcome, latency, and validated metric/group/range only; they omit question text and filter values.

## Metrics and Grafana

Use `backend/ops/prometheus.yml` as the scrape configuration. Run Prometheus on a network that can resolve `api:5000`, `worker:9464`, and `digest:9465`, or change those targets to the service addresses in your environment. Worker and digest listeners are internal to the service network and are not published as host ports by Compose.

In production, uncomment the Bearer authorization blocks in the Prometheus configuration and mount the same `METRICS_TOKEN` value used by the API and worker at the configured credentials file path. Keep that token out of the repository.

Mount the contents of `backend/ops/grafana/provisioning/datasources/` and `backend/ops/grafana/provisioning/dashboards/` into Grafana's provisioning directory, and mount `backend/ops/grafana/dashboards/` at `/etc/grafana/dashboards`. Set the provisioned Prometheus and Tempo datasource URLs to the endpoints reachable from Grafana. The **LivePulse Operations** dashboard shows request/event rates, HTTP and ClickHouse latency, stream backlog, batch size, sockets, and dead letters. Use Grafana Explore with the Tempo datasource to search traces for `livepulse-api` and `livepulse-worker`.

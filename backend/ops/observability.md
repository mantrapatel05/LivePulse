# LivePulse observability setup

The repository provides OpenTelemetry trace export, Prometheus scrape targets, and a provisioned Grafana operations dashboard. These files do not deploy a collector, Prometheus, Tempo, or Grafana.

## Application traces

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to the OTLP/HTTP endpoint for your collector or tracing backend in both the API and worker environments. The application exports no traces while this variable is unset. The default root sampling rate is 10%; set `OTEL_TRACES_SAMPLE_RATE` from `0` to `1` to change it. The standard `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` variable is also accepted.

The API creates server spans and child ingestion/query spans. Trace context is carried through Redis Streams, and ClickHouse worker batches link to a bounded set of source spans. Trace attributes avoid event payloads and user supplied URLs. Pino JSON logs include `trace_id` and `span_id` while a span is active.

## Metrics and Grafana

Use `backend/ops/prometheus.yml` as the scrape configuration. Run Prometheus on a network that can resolve `api:5000` and `worker:9464`, or change those targets to the service addresses in your environment. The worker listener is internal to the service network and is not published as a host port by Compose.

In production, uncomment the Bearer authorization blocks in the Prometheus configuration and mount the same `METRICS_TOKEN` value used by the API and worker at the configured credentials file path. Keep that token out of the repository.

Mount the contents of `backend/ops/grafana/provisioning/datasources/` and `backend/ops/grafana/provisioning/dashboards/` into Grafana's provisioning directory, and mount `backend/ops/grafana/dashboards/` at `/etc/grafana/dashboards`. Set the provisioned Prometheus and Tempo datasource URLs to the endpoints reachable from Grafana. The **LivePulse Operations** dashboard shows request/event rates, HTTP and ClickHouse latency, stream backlog, batch size, sockets, and dead letters. Use Grafana Explore with the Tempo datasource to search traces for `livepulse-api` and `livepulse-worker`.

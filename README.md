# LivePulse

![CI](https://github.com/mantrapatel05/LivePulse/actions/workflows/ci.yml/badge.svg)

Self-hosted, real-time web analytics. A lightweight browser SDK captures behavioral events, a Node API ingests them through Redis Streams, a standalone worker batches them into ClickHouse, and a React dashboard renders live sessions, analytics, error clusters, and founder-to-visitor chat.

## Features

- **Real-time event stream** — `page_view`, `click`, `error`, `rage_click`, `scroll_depth`, `time_on_page`, `custom` broadcast live over the canonical Socket.IO `live:event` event.
- **Session intelligence** — live-now state in Redis (`active:{project}` / `session:{project}:{session}`, 5-min TTL) plus durable session aggregates in Mongo; entry/exit, engaged seconds, device/browser/geo.
- **Error clustering** — ClickHouse `error_clusters_v2` materialized view groups by normalized signature with occurrences, affected sessions (HLL), and last seen.
- **Founder-to-visitor chat** — per-session rooms (`chat:{projectId}:{sessionId}`), persisted in Mongo, live over sockets.
- **Zero-dependency SDK** — single IIFE file, no build step for hosts; 14,112 bytes minified / 5,849 bytes gzipped, served from the API itself (`GET /sdk/livepulse.js`).
- **Consent + privacy** — DNT respected, opt-in banner mode, PII redaction client- and server-side, allowlist/redact-selector controls.
- **Dual auth boundaries** — public `x-api-key` (write-only ingest) vs Supabase JWT `Authorization: Bearer` (dashboard reads). A leaked API key cannot read analytics.
- **Hashed API keys** — stored as `SHA-256(pepper + key)` with a visible `lp_live_<prefix>`; plaintext shown once at create/rotate.

## Architecture

```
Browser SDK ──POST /api/v2/collect (202/503)──▶ API (server.js + Express)
                                                      │ validate → claim → enrich → Mongo dual-write → Redis XADD → touch → Socket.IO fan-out
                                                      ▼
                                               Redis Stream `events:v2` (durable buffer, group `clickhouse-writers`)
                                                      │ XREADGROUP (500/batch) + XAUTOCLAIM reclaim + DLQ `events:v2:dead`
                                                      ▼
                                               Worker (worker.js) ──batch insert──▶ ClickHouse `events_v2`
                                                                                          │ MVs: session_summary_v2 / event_minute_agg_v2 / error_clusters_v2
Dashboard ◀── REST (Mongo reads today) + Socket.IO rooms ──────────┘
```

Three processes: `api` (`node server.js`, HTTP + Socket.IO), `worker` (`node worker.js`, Redis → ClickHouse only, no Mongo), `frontend` (Vite + React). Backed by MongoDB 7, Redis 7, ClickHouse 24.8 — see `docker-compose.yml`.

**Ingest cost per batch:** 2 Redis round trips (claim-all, then publish-all + session touches), not 3 per event. Single-event batches keep a sequential fast path (pipelines lose at N=1). Mongo dual-write uses idempotent event-ID upserts plus one upsert per distinct session. Claims are released on failure so retries are not dropped as duplicates; Mongo's unique `(projectId, eventId)` index prevents retry duplicates, and the worker dedupes on the canonical `event_id` (`mongo:<ObjectId>` in dual mode, `live:<eventId>` in clickhouse-only mode).

## Monorepo layout

| Path | Contents |
|---|---|
| `sdk/src/livepulse.js` | Browser SDK source (IIFE, `SCHEMA_VERSION=2` envelope) |
| `backend/server.js` / `backend/worker.js` | API + Socket.IO entrypoint / ClickHouse consumer entrypoint |
| `backend/src/app.js` | Express factory: CORS, JSON (100 KB cap), static `/sdk`, route mounts, `/metrics`, `/` |
| `backend/src/{controllers,routes,middleware,models,services,lib,shared,sockets}` | Ingest, analytics, sessions, projects, chat, health; auth; Mongoose models; geo/UA; Redis/ClickHouse helpers |
| `backend/clickhouse/migrations/` | `001_events_v2` + `002/003/004` materialized views |
| `backend/scripts/` | `buildSdk`, `seedTestProject`, `seedFixtures`, `backfillClickhouse`, `checkParity`, `setAnalyticsBackend`, `runClickhouseMigrations`, `loadtest/localLoadTest` |
| `backend/tests/{unit,redis}` | Jest unit (no infra) + Redis-backed integration |
| `frontend/src/{routes,components/lp,lib}` | TanStack Router pages, `Brand/Panel/ControlRoom(V2)/ChatDock/Landing/SessionTimelineDialog`, `api/apiV2/auth/socket/config` |
| `sdk/tests/` | Vitest SDK suite (consent, PII, retry, chat, one-tag) |
| `docker-compose.yml` | Full local stack: mongo, redis, clickhouse, api, worker, frontend |

## Prerequisites

- **Node.js** >= 18 (Docker images use Node 24)
- **Docker + Compose** (recommended) — or local MongoDB 7, Redis 7, ClickHouse 24.8
- **Supabase project** — JWT secret (legacy HS256 secret) + project URL + anon key

## Quickstart

### Option A — Docker Compose (full V2 stack)

```bash
# from the repo root
docker compose up --build
```

| Service | Address |
|---|---|
| API | http://localhost:5000 |
| Frontend | http://localhost:5173 |
| ClickHouse HTTP | http://localhost:8123 |
| Redis | localhost:6379 |
| Mongo | localhost:27017 |

Set `SUPABASE_JWT_SECRET`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` in the environment (or a root `.env` file) before bringing up the stack for authenticated dashboard access.

### Option B — manual (API + dashboard separately)

```bash
# 1. Backend
cd backend
npm install
npm run build:sdk          # builds public/sdk/livepulse.js (also runs in Docker build)

# 2. Frontend
cd ../frontend
npm install
```

```bash
# Terminal 1 — API (port 5000)
cd backend
npm start                  # nodemon server.js (dev) — production: node server.js

# Terminal 2 — ClickHouse worker
cd backend
npm run worker             # node worker.js

# Terminal 3 — dashboard (port 8080)
cd frontend
npm run dev
```

Then seed a project and open the interactive test bench: `http://localhost:5000/sdk/test.html` (source: `backend/public/sdk/test.html` — buttons for every SDK behavior, a wire log of every batch, and an `?autoplay=1` self-demo). `sdk/test.html` is the minimal one-tag smoke test. Excluded from production images via `backend/.dockerignore`.

```bash
cd backend
# Set ALLOW_TEST_SEED=true only after confirming MONGO_URI targets a disposable test database.
ALLOW_TEST_SEED=true TEST_OWNER_ID=<uid> npm run seed:test-project  # upserts 699d9becf25204ae69676baa / lp_test_local_key_123
```

## Configuration

### `backend/.env`

| Variable | Required | Default / example |
|---|---|---|
| `PORT` | No | `5000` |
| `MONGO_URI` | Yes | `mongodb://localhost:27017/livepulse` |
| `REDIS_URL` | Yes | `redis://127.0.0.1:6379` |
| `CLICKHOUSE_URL` | Yes (worker/V2) | `http://localhost:8123` |
| `CLICKHOUSE_DATABASE` | No | `default` |
| `SUPABASE_JWT_SECRET` | Yes (dashboard) | legacy JWT secret from Supabase Dashboard → Project Settings → API |
| `DASHBOARD_ORIGIN` | Yes (prod) | `https://your-dashboard` (dashboard origin allowlist; dev also allows loopback origins) |
| `PUBLIC_BACKEND_URL` | No | `http://localhost:5000` (used in embed snippet template) |
| `API_KEY_PEPPER` | Yes (prod) | unset warns in production; salts stored key hashes |
| `NODE_ENV` | No | `development` |

### Environment

- `RATE_LIMIT_PER_SESSION_PER_MIN` (default `120`)
- `CHAT_VISITOR_LIMIT_PER_MIN` (default `20`)
- `CHAT_FOUNDER_LIMIT_PER_MIN` (default `120`)
- `OTEL_EXPORTER_OTLP_ENDPOINT` (optional; unset disables tracing; OTLP/HTTP endpoint)
- `OTEL_TRACES_SAMPLE_RATE` (default `0.1`, between `0` and `1`)
- `WORKER_METRICS_PORT` (default `9464`, internal worker metrics listener)
- `WORKER_METRICS_HOST` (default `127.0.0.1`; use the container's private interface for network scraping)

### `frontend/.env`

| Variable | Required | Example |
|---|---|---|
| `VITE_API_URL` | Yes | `http://localhost:5000` |
| `VITE_SUPABASE_URL` | Yes | `https://xyz.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Yes | publishable/anon key |
| `VITE_PUBLIC_DASHBOARD_URL` | No | Public dashboard origin for badge links; defaults to the current origin |

## SDK usage

One-tag auto-init (production default — consent-gated):

```html
<script src="https://your-backend-host/sdk/livepulse.js"
        data-key="lp_live_..."
        data-api="https://your-backend-host"
        data-chat="true"
        data-consent="required"
        defer></script>
```

Manual init (full control):

```html
<script src="https://your-backend-host/sdk/livepulse.js"></script>
<script>
  LivePulse.init({
    apiKey: 'lp_live_...',
    endpoint: 'https://your-backend-host', // POSTs to /api/v2/collect
    userId: 'user-123',
    chat: true,
    consent: 'pending',                    // omit entirely for ungated V1-compatible mode
    propertyAllowlist: ['plan', 'amount'], // drop all other custom keys
    redactSelectors: ['[data-lp-redact]'], // never capture matching elements
    track: { all: true }                   // or toggle pageViews/clicks/errors/rageClicks/scrollDepth/visibility/spa
  });

  LivePulse.track('purchase', { plan: 'pro', amount: 49 });
  LivePulse.flush();            // force-send (auto-flush every 5s / 20 events / on unload via keepalive fetch -- the API key never appears in any URL)
  LivePulse.consent('granted'); // or 'denied'
  LivePulse.reset();            // forget visitor: fresh session + cleared queue
</script>
```

Transport contract: versioned envelope `{schemaVersion: 2, sentAt, events[]}` with per-event `{eventId, sessionId, userId, eventType, url, element, occurredAt, consent, properties, clientContext}`; size-bounded chunks (60 KB); bounded `localStorage` retry queue (200) with exponential backoff + jitter; non-2xx (including the collector's `503` on partial internal failure) is retried, idempotency claims make the retry safe. Auto-tracked: page views + SPA navigations, clicks (x/y), errors, rage clicks (≥3 clicks / 500 ms / 30 px), scroll depth (25/50/75/100), time on page (visibility + unload). Errors and rage clicks trigger an immediate flush, throttled to one urgent flush per 2 s.

## Hype badge (social proof)

Enable **show badge** in the project's dashboard panel and choose the minimum live-reader threshold. The badge is opt-in and uses a public ID; it never shows the project name or write API key.

Copy one of these snippets from the dashboard:

```html
<a href="https://your-dashboard/?ref=badge&p=PUBLIC_ID"><img src="https://your-api/badge/PUBLIC_ID.svg" alt="LivePulse badge" height="30"></a>
```

```markdown
[![LivePulse](https://your-api/badge/PUBLIC_ID.svg)](https://your-dashboard/?ref=badge&p=PUBLIC_ID)
```

```tsx
<a href="https://your-dashboard/?ref=badge&p=PUBLIC_ID"><img src="https://your-api/badge/PUBLIC_ID.svg" alt="LivePulse badge" height={30} /></a>
```

The badge follows an honesty ladder: it shows the live count only when active sessions meet the configured threshold; otherwise it shows real visitors today when that count reaches the brand floor; below that it shows the LivePulse brand with no number. “Reading now” means sessions active in the last five minutes. “Today” is the current UTC day and counts distinct sessions. No numbers are padded or simulated.

To add a live count to text you control, include the standalone pulse script and its target element. It leaves your fallback text alone when the badge has no honest number to show:

```html
<script src="https://your-api/pulse/pulse.js" data-public-id="PUBLIC_ID" defer></script>
<span data-lp-pulse></span>
```

Badge endpoints are `GET /badge/:publicId.svg`, `GET /api/public/:publicId/pulse`, `POST /api/public/:publicId/landing-hit`, and owner-authenticated `PATCH` or `GET /api/projects/:id/badge` for settings and stats.

Configure the optional dashboard link origin with `VITE_PUBLIC_DASHBOARD_URL`; when unset, snippets use the current dashboard origin. Backend badge defaults are `BADGE_COUNT_TTL_SECONDS=15`, `BADGE_PROJECT_TTL_SECONDS=60`, `BADGE_BRAND_FLOOR=3`, `BADGE_RATE_LIMIT_PER_IP_PER_MIN=120`, and `BADGE_LANDING_RATE_LIMIT_PER_IP_PER_MIN=60`.

The badge load test (`cd backend && node scripts/badgeLoadTest.js`) accepts `BASE_URL` values using `http://` or `https://`.

For deployment, deploy the backend schema first, run `cd backend && npm run backfill:public-id`, then enable badges in the dashboard. Badge cache invalidation is local to each API instance; a disable can take up to `BADGE_PROJECT_TTL_SECONDS` to reach other instances.

The API trusts one proxy hop (`trust proxy = 1`), so that hop count must match the real proxy chain. If a CDN sits in front of that proxy, all requests may resolve to one IP; verify client IPs after deployment. Impressions are a rough hint because CDNs cache most badge image requests. Landing hits and first-project `referredBy` attribution measure the referral funnel more directly. `referredBy` is attacker-writable and is for measurement only; never attach rewards to it.

## Engagement Drop Detection

The V2 dashboard compares each project's latest rolling 7 days with the 7 days before them. It reports session, event, engagement-time, rage-click, and error-rate changes, plus the pages with the largest page-view declines. This is a deterministic project-level trend signal, not a per-user churn prediction or an ML model.

The API derives both windows on the server, requires the project to be on the ClickHouse analytics backend, and caches results in Redis for 5 minutes. To avoid noisy alerts, it reports insufficient data until the prior window has at least `ENGAGEMENT_MIN_PREV_SESSIONS` sessions (default `30`); page declines require `ENGAGEMENT_MIN_PAGE_VIEWS` views (default `20`). Session drops at or below `ENGAGEMENT_WATCH_PCT` (default `-20`) are marked watch; drops at or below `ENGAGEMENT_DROP_PCT` (default `-40`) are marked dropping. A relative error-rate increase greater than 50% also marks watch. Zero baselines produce no percentage.

The defaults can be tuned with `ENGAGEMENT_MIN_PREV_SESSIONS`, `ENGAGEMENT_MIN_PAGE_VIEWS`, `ENGAGEMENT_WATCH_PCT`, and `ENGAGEMENT_DROP_PCT`. Requests are measured by `livepulse_engagement_drift_requests_total{status}`; ClickHouse calls use the existing query-latency metric with `v2_drift_*` endpoint labels.

## AI Session Insights

AI Insights are opt-in per project and off by default. From a ClickHouse-backed session timeline, choose **Explain session**; from an error cluster, choose **Explain**. The service builds a short, scrubbed summary from event types, page paths, timestamps, selected numeric properties, and truncated error messages. It never sends user IDs, IP addresses, chat messages, full properties, or client context. Error-cluster explanations may include up to five similarly scrubbed session summaries. The chosen third-party model provider (OpenRouter by default, through an OpenAI-compatible endpoint) receives this telemetry when you request an explanation; provider privacy, logging, and retention policies apply.

Configure `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, and `LLM_TIMEOUT_MS` in the backend environment. Leave the key/model unset to disable generation; the API continues to boot and returns a clear unavailable response. Per-user and per-project minute limits plus `AI_INSIGHT_DAILY_CALLS_PER_PROJECT` bound usage. Identical insights are cached for 10 minutes for live sessions and 7 days for ended sessions. Provider errors or malformed model output return a deterministic, telemetry-only summary. Turn the feature off at any time in project install settings; the project toggle defaults off.

## Known limitations

- Dashboard reads still use Mongo for `dual` projects until cutover.
- In-process rate limits use fixed windows.
- The SDK flushes every 5 s or 20 events; errors and rage clicks flush immediately, throttled to one urgent flush per 2 s.
- Browser `keepalive` fetches share an approximately 64 KB total in-flight budget, so a huge unload burst can lose events.
- Value-level PII scrubbing is regex-based and best effort, not a guarantee.

## API reference

All dashboard routes require `Authorization: Bearer <Supabase JWT>` plus project ownership; ingest routes require `x-api-key`.

CORS: collector endpoints and visitor sockets accept any origin; they authenticate with API-key credentials and do not use cookies. Dashboard routes allow only origins listed in `DASHBOARD_ORIGIN` (plus loopback origins in development).

| Method + path | Auth | Response |
|---|---|---|
| `POST /api/v2/collect` | API key, rate-limited | `202 {accepted, rejected, duplicates, correlationId, errors[0..20]}` · `503 {accepted, internalFailures, correlationId}` (retry the batch) |
| `POST /api/events/ingest` | API key, rate-limited | Legacy single-event shape, normalized into the V2 pipeline · `201` |
| `GET /api/projects` | JWT | Projects scoped to caller (keys/hashes never listed) |
| `POST /api/projects` | JWT | `201 {project + plaintext key}` — key shown **once** |
| `POST /api/projects/:projectId/rotate-key` | JWT + owner | New plaintext key once; old cache entry invalidated immediately |
| `GET /api/projects/:projectId/embed` | JWT + owner | `{snippetTemplate, apiKeyPrefix, backendOrigin}` |
| `GET /api/analytics/:projectId/overview` | JWT + owner | Totals, unique visitors, errors, avg engaged seconds |
| `GET /api/analytics/:projectId/events-over-time?hours=` | JWT + owner | Per-minute series |
| `GET /api/analytics/:projectId/top-pages?hours=` | JWT + owner | Top URLs with session counts |
| `GET /api/analytics/:projectId/event-breakdown?hours=` | JWT + owner | Counts by event type |
| `GET /api/analytics/:projectId/error-clusters` | JWT + owner | Grouped errors + affected sessions |
| `GET /api/analytics/:projectId/sessions/:sessionId/timeline` | JWT + owner | Ordered session events |
| `GET /api/sessions/:projectId/active?windowMinutes=` | JWT + owner | Live sessions (default 15, cap 1440, max 200) |
| `GET /api/chat/:projectId/:sessionId/history` | JWT + owner | Last ≤200 messages, ascending |
| `GET /health` · `GET /health/live` | none | `{status: "ok"}` |
| `GET /health/ready` | none | `{mongo, redis, clickhouse, consumerGroup, streamBacklogHealthy}` · `200`/`503` |
| `GET /metrics` | none in dev · `Bearer METRICS_TOKEN` in prod (unset → deliberate `503`) | Prometheus exposition (`livepulse_events_*`, `livepulse_ingest_stage_ms`, `livepulse_stream_pending_count`, …) |
| `GET /sdk/livepulse.js` | none | Minified SDK (5-min cache, CORS `*`) |

Sockets: dashboards authenticate with the Supabase JWT and join `project:{id}` / `chat:{projectId}:{sessionId}`; visitors connect with `{apiKey, sessionId}` and are pinned to their own chat room. Events fan out as `live:event`, sessions as `live:session`, chat as `founder_message` / `user_reply`, health as `system:health` every 15 s.

## Analytics backends and cutover

`Project.analyticsBackend`: `mongo` (V1-only) → `dual` (write both, read Mongo) → `clickhouse` (write stream only). Allowed moves are `mongo`→`dual`, `dual`→`mongo`, and `dual`→`clickhouse`; `clickhouse`→`dual` is the rollback path. Other transitions are rejected. Migration tooling:

```bash
cd backend
npm run migrate:clickhouse     # apply clickhouse/migrations/*.sql (sorted, idempotent)
npm run seed:fixtures          # deterministic dual-mode fixtures (rerunnable, Redis-deduped)
npm run backfill:clickhouse -- <projectId>  # backfill one project; checkpointed, skips existing rows
npm run check:parity           # Mongo vs ClickHouse totals/sessions/errors, default ≤0.5% to pass; run daily
node scripts/setAnalyticsBackend.js <projectId> <mongo|dual|clickhouse>
node scripts/setAnalyticsBackend.js <projectId> <target> --force  # bypass parity/backfill gate checks
```

Before moving `dual`→`clickhouse`, that project's backfill checkpoint (`backfill:clickhouse:<projectId>`) must have `processedCount > 0`; the newest seven parity runs must all be within threshold, cover seven consecutive UTC days, and the newest run must be no more than one day old. Those runs must include nonzero Mongo event counts. `--force` bypasses these backfill/parity gate checks and should be used only for an explicitly accepted cutover risk; it does not permit an invalid state transition. Run `npm run check:parity <projectId>` daily while validating the migration. Moving `clickhouse`→`dual` restores dual writes; Mongo may be stale after clickhouse-only operation, so reconcile/backfill before relying on Mongo reads.

GitHub Actions runs the parity check daily. Configure repository secrets `PARITY_MONGO_URI` and `PARITY_CLICKHOUSE_URL`; optionally set `PARITY_CLICKHOUSE_USER`, `PARITY_CLICKHOUSE_PASSWORD`, and `PARITY_CLICKHOUSE_DATABASE` if they differ from ClickHouse defaults. Before deploying event-ID idempotency, run `cd backend && npm run migrate:event-idempotency` against Mongo to create the partial unique index. Legacy event documents without `eventId` remain outside that index.

Current state: the ClickHouse write path (worker + MVs + pure-SQL builders in `src/shared/analyticsQueries.js`) is live; dashboard reads still use Mongo until cutover.

## Observability

- Structured logs: Pino JSON with correlation IDs (`withCorrelation`), per-stage ingest timing.
- Metrics: `livepulse_ingest_stage_ms{stage=claim|publish|mongo}`, `livepulse_events_accepted/rejected_total`, `livepulse_rate_limited_total`, `livepulse_stream_pending_count`, `livepulse_worker_batch_size`, `livepulse_clickhouse_insert_latency_ms`, `livepulse_query_latency_ms`, `livepulse_socket_connections`, `livepulse_http_requests_total`, and `livepulse_http_request_duration_ms`. Scrape the API at `/metrics` and the worker at its internal `WORKER_METRICS_PORT` (default `9464`); production scrapes must send the configured `METRICS_TOKEN`.
- Tracing: optional OTLP/HTTP traces for API requests, ingestion, ClickHouse analytics queries, and worker inserts. Trace context crosses Redis Streams as W3C `traceparent`/`tracestate`; worker batch spans link to a bounded set of originating spans. Pino logs include trace and span IDs. No event payloads, URLs, query text, or credentials are added to span attributes. See `backend/ops/grafana/` and `backend/ops/prometheus.yml` for dashboard provisioning and scrape targets.
- Alerts: `backend/ops/alerts.yml` covers stream backlog (>5k warn / >20k critical), DLQ rate, reject rate, 429 rate, ClickHouse/query p95.
- TTLs: events 30 d (Mongo) / 90 d (ClickHouse `events_v2`), idempotency claims 24 h, API-key snapshots 60 s, live-now state 5 min.

## Running tests

```bash
# Backend — unit, no infra (43 tests)
cd backend && npm run test:unit

# Backend — Redis-backed integration, needs Redis on REDIS_URL (23 tests)
cd backend && npm run test:redis

# Backend — everything
cd backend && npm test

# SDK — Vitest + jsdom (18 tests: consent, DNT, envelope, PII, retry, reset, chat, one-tag)
cd sdk && npm test

# Frontend — Vitest + Testing Library
cd frontend && npm test
```

Load test (in-process pipeline, skips Mongo auth by design; run the generator on a separate host for official numbers):

```bash
cd backend
node scripts/loadtest/localLoadTest.js            # defaults: 10k events, 100 sessions, batch 1
BATCH_SIZE=10 node scripts/loadtest/localLoadTest.js
```

Measured on a shared Windows/Docker host (same-box contention inflates absolutes): batch-1 p95 ~34 ms / ~3.9k ev/s, batch-10 p95 ~128 ms / ~13.3k ev/s, batch-50 p95 ~287 ms / ~21k ev/s. Isolated single-batch microbenchmark (no contention): batch-10 ~8.2×, batch-50 ~39× vs sequential per-event writes; batch-1 unchanged by design (fast path). Target: p95 ack < 200 ms.

## Tech stack

| Layer | Technology |
|---|---|
| SDK | Vanilla JS (IIFE, zero dependencies), `fetch` (keepalive for unload delivery), `localStorage` retry queue |
| Backend | Express 5, Socket.IO 4 (+ Redis adapter), Mongoose 9, ioredis 5, `@clickhouse/client`, `geoip-lite`, Pino, prom-client |
| Frontend | React 19, Vite 8, TanStack Router + Query, Supabase JS, socket.io-client, Framer Motion |
| Auth | Supabase JWT (dashboard) + hashed API keys (ingest) |
| Data | MongoDB 7 (system of record for reads), Redis 7 Streams (durable buffer, cache, rate limit, presence, idempotency), ClickHouse 24.8 (analytics store) |
| Testing | Jest + Supertest (backend), Vitest + Testing Library + jsdom (SDK, frontend) |
| Infra | Docker Compose (mongo, redis, clickhouse, api, worker, frontend), Prometheus alerts |

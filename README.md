# LivePulse

**Self-hosted, real-time web analytics and session intelligence — with a live line straight to your visitors.**

LivePulse captures client-side behavioral events through a lightweight JavaScript SDK, processes them through a Node.js backend, and surfaces them in a React dashboard with live-updating panels, error clustering, and founder-to-visitor chat. It's built for founders and small teams who want full ownership of their analytics data without a third-party dependency sitting between them and their own numbers.

This document covers **V1** only — the shipped, deployable product. It intentionally does not describe unreleased or in-progress work.

---

## At a glance

- **Zero-dependency SDK** (~6 KB unminified) — one script tag, auto-instruments page views, clicks, scroll depth, errors, rage clicks, and time on page
- **Live dashboard** — a real-time control room, not a page you refresh: event stream, session list, analytics panels, and error clusters update over a live socket connection
- **Founder ↔ visitor chat** — reply to someone on your site in the moment, from inside your own dashboard
- **Two clean trust boundaries** — a public, write-only SDK key that can never read your data, and a Supabase-authenticated dashboard session for everything privileged
- **You own the data** — MongoDB, self-hosted or Atlas, no analytics vendor in the loop

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Core Concepts](#core-concepts)
- [Repository Structure](#repository-structure)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Backend Setup](#backend-setup)
- [Frontend Setup](#frontend-setup)
- [Running Tests](#running-tests)
- [Smoke Test](#smoke-test)
- [SDK Reference](#sdk-reference)
- [API Reference](#api-reference)
- [Socket Protocol](#socket-protocol)
- [Data Model](#data-model)
- [Authentication Model](#authentication-model)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
- [What's Not in V1](#whats-not-in-v1)
- [License](#license)

---

## Architecture Overview

```
Browser (visitor)                          Browser (founder)
      │                                           │
      │  SDK (livepulse.js)                       │  React SPA (dashboard)
      │  • auto-tracks events                     │  • Supabase-authenticated
      │  • opens a chat socket                     │  • live socket connection
      │                                           │
      ▼                                           ▼
┌──────────────┐   HTTP POST                ┌──────────────────────────┐
│ Event Ingest │ ─────────────────────────> │                          │
│ (API key)    │                            │      Express API         │
└──────────────┘                            │      (port 5000)         │
                                             │                          │
      │  visitor WebSocket   ───────────────>│      Socket.IO           │<── dashboard WebSocket
      │  (chat)                              │                          │    (Supabase token)
      │                                      └────────────┬─────────────┘
      │                                                   │
      │                                                   ▼
      │                                              MongoDB
      │                                        (events, sessions,
      │                                         projects, chat)
      │
      └──────────────────── founder ⇄ visitor chat, relayed live ───────┘
```

**The request path, end to end:** the SDK batches events in the browser and POSTs them to `/api/events/ingest` using a public API key. The backend validates the key, writes the event, upserts the session aggregate, and immediately re-broadcasts both over Socket.IO to any dashboard subscribed to that project. A founder never has to refresh to see a new visitor land — the dashboard is driven by the same write that persisted the event.

The system has three deployment units:

1. **SDK** — a zero-dependency, IIFE-wrapped JavaScript file (~6 KB unminified) that auto-instruments page views, clicks, scroll depth, errors, rage clicks, time-on-page, and SPA navigations. Events are batched and flushed every 5 seconds or when the queue reaches 20 entries, whichever comes first.

2. **Backend** — an Express 5 application backed by MongoDB (via Mongoose) and Socket.IO. It handles event ingestion, session tracking, project management, analytics aggregation, chat persistence, and real-time event broadcast.

3. **Frontend** — a React 19 single-page application built with Vite, TanStack Router, TanStack Query, and Framer Motion. Authentication is delegated to Supabase. The dashboard renders a control room with live event streams, session lists, analytics panels, and an embedded chat dock.

---

## Core Concepts

A handful of terms recur throughout this document and the codebase:

| Term | Meaning |
|---|---|
| **Project** | One tracked site or app. Owns an API key (for the SDK) and belongs to exactly one Supabase user. |
| **Session** | One visitor's continuous visit, identified by a client-generated `sessionId`. Aggregated separately from raw events so "who's active right now" is a cheap read. |
| **Event** | A single tracked occurrence — a page view, a click, an error, etc. — tied to a session and a project. |
| **API key** | Public, write-only credential embedded in the SDK snippet. Can ingest events and open a visitor chat socket. Cannot read anything. |
| **Dashboard session** | A Supabase-issued JWT identifying the signed-in founder. Required for every privileged (read/manage) operation, and checked against project ownership on every request. |

---

## Repository Structure

```
LivePulse/
  backend/
    server.js                   ← HTTP + Socket.IO bootstrap
    src/
      app.js                    ← Express application (routes, CORS, static SDK serving)
      config/
        corsOrigin.js           ← CORS origin whitelist from DASHBOARD_ORIGIN env var
        db.js                   ← Mongoose connection handler
      controllers/
        analyticsController.js  ← Overview, top pages, timeseries, breakdown, error clusters
        chatController.js       ← Chat history retrieval
        eventController.js      ← Event ingestion, session upsert, real-time broadcast
        projectController.js    ← Project CRUD, API key generation
        sessionController.js    ← Session listing and lookup
      lib/
        verifySupabaseToken.js  ← Supabase JWT verification (HS256, no network call)
      middleware/
        apiKeyAuth.js           ← Public API key authentication (SDK ingest path)
        projectOwnership.js     ← Project ownership verification (dashboard path)
        supabaseAuth.js         ← Supabase Bearer token extraction and validation
      models/
        ChatMessage.js          ← Chat messages (projectId, sessionId, sender, message)
        Event.js                ← Behavioral events with 30-day TTL index
        Project.js              ← Projects with unique API keys
        Session.js              ← Session aggregates (event count, last seen, city)
      routes/
        analyticsRoutes.js      ← GET /:projectId/* (dashboard auth + ownership)
        chatRoutes.js           ← GET /:projectId/sessions/:sessionId (dashboard auth + ownership)
        eventRoutes.js          ← POST /ingest (API key auth)
        projectRoutes.js        ← CRUD (dashboard auth)
        sessionRoutes.js        ← GET /:projectId/* (dashboard auth + ownership)
      services/
        geo.js                  ← IP-to-city resolution via geoip-lite
      sockets/
        socketHandler.js        ← Socket.IO middleware and event handlers
    tests/
      analytics.test.js         ← Route-level integration tests (Jest + Supertest)
    scripts/
      seedTestProject.js        ← Creates a test project with a known API key

  frontend/
    src/
      components/lp/            ← Dashboard UI components (ControlRoom, ChatDock, panels)
      lib/
        api.ts                  ← HTTP client for backend API calls
        auth.tsx                ← Supabase auth context provider
        config.ts               ← Environment variable accessors
        socket.ts               ← Socket.IO client wrapper
        usePolling.ts           ← Generic polling hook for non-WebSocket data
      routes/
        dashboard.tsx           ← Main control room page
        login.tsx                ← Supabase OAuth login
        auth.callback.tsx        ← OAuth callback handler
      styles/
        lp-app.css               ← Application-wide styles

  sdk/
    src/
      livepulse.js               ← Client-side instrumentation SDK

  test.html                      ← Standalone smoke test page
```

---

## Prerequisites

- **Node.js** ≥ 18
- **MongoDB** ≥ 6 — a local instance, Docker container, or Atlas cluster
- **A Supabase project** for authentication — you'll need the JWT secret and the anon key

Optional but useful: `mongosh` or MongoDB Compass for poking at collections while developing, and a REST client (curl, HTTPie, or Postman) for exercising the ingest endpoint directly.

---

## Quick Start

For someone who just wants it running locally, in order:

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env        # fill in MONGO_URI and SUPABASE_JWT_SECRET
npm run seed:test-project
npm start

# 2. Frontend (new terminal)
cd frontend
npm install
cp .env.example .env        # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev

# 3. Smoke test (new terminal, or just open the file)
open ../test.html           # or double-click it — no server needed for the HTML itself
```

If you see `LivePulse backend server is running on port 5000` and `MongoDB connected successfully` in the backend terminal, and `test.html`'s console logs `Socket connected`, you're up. The sections below go into each step in more detail.

---

## Backend Setup

```bash
cd backend
npm install
```

Create a `.env` file in `backend/` with the following variables:

```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/livepulse
SUPABASE_JWT_SECRET=<your-supabase-jwt-secret>
DASHBOARD_ORIGIN=http://localhost:5173,http://localhost:8080
PUBLIC_BACKEND_URL=http://localhost:5000
```

The Supabase JWT secret is found under **Supabase Dashboard → Project Settings → API → JWT Settings → Legacy JWT Secret**. Verifying tokens locally with this secret means the backend never makes a network call to Supabase just to check whether someone is signed in.

Start the backend:

```bash
npm start
```

You should see, in order:

```
LivePulse backend server is running on port 5000
MongoDB connected successfully
```

If the second line never shows up, see [Troubleshooting](#troubleshooting).

### Seeding a Test Project

```bash
npm run seed:test-project
```

This creates a project with a deterministic API key (`lp_test_local_key_123`) that matches the values hardcoded in `test.html`. The script is idempotent — safe to run again if you've wiped your database.

---

## Frontend Setup

```bash
cd frontend
npm install
```

Create a `.env` file in `frontend/` (use `.env.example` as a template):

```env
VITE_API_URL=http://localhost:5000
VITE_SUPABASE_URL=<your-supabase-project-url>
VITE_SUPABASE_ANON_KEY=<your-supabase-anon-key>
```

Start the development server:

```bash
npm run dev
```

The dashboard will be available at `http://localhost:8080` (or whichever port Vite assigns — check the terminal output).

Before signing in for the first time, make sure your Supabase project has:

- Email and/or your chosen OAuth provider(s) enabled under **Authentication → Providers**
- `http://localhost:8080/auth/callback` (or your actual dev port) added under **Authentication → URL Configuration → Redirect URLs**

---

## Running Tests

### Backend

```bash
cd backend
npm test
```

Runs the Jest test suite with `--runInBand` (serial execution). Tests use Supertest against the Express app and mock MongoDB via `mongodb-memory-server`. No external services are required — the whole suite is self-contained.

### Frontend

```bash
cd frontend
npm test
```

Runs the Vitest test suite. Tests use `@testing-library/react` and `jsdom`. Socket.IO and API modules are mocked at the module level, so nothing here needs a running backend either.

---

## Smoke Test

With the backend running on port 5000 and a test project seeded:

1. Open `test.html` in a browser.
2. Open the browser console.
3. You should see `Socket connected` and `new-event` messages as the SDK sends page view events.
4. Click **Send Custom Event** to queue a custom event; click **Flush Queue** to send it immediately rather than waiting for the next auto-flush.
5. Confirm the event shows up in the console log — and, if the dashboard is running and signed in to the same project, in the live event stream there too.

If nothing appears after step 3, check that `test.html`'s hardcoded API key matches what `seed:test-project` created, and that `PORT`/`MONGO_URI` in the backend's `.env` are what you expect.

---

## SDK Reference

The SDK is a single file (`sdk/src/livepulse.js`) that exposes a global `window.LivePulse` object. It requires no build step and no dependencies.

### Installation

Add the script to any page and initialize it with your project's API key:

```html
<script src="https://your-backend-host/sdk/livepulse.js"></script>
<script>
  LivePulse.init({
    apiKey: 'your_api_key',
    projectId: 'your_project_id',
    endpoint: 'https://your-backend-host/api/events/ingest'
  });
</script>
```

The backend serves the SDK as a static asset from `/sdk`, so the snippet and the file it points to are always version-consistent — there's no separate build/publish step to forget.

### Auto-Tracked Events

| Event Type | Trigger |
|---|---|
| `page_view` | Initial load, `pushState`, `replaceState`, `popstate` |
| `click` | Any click, with a sanitized element descriptor (no raw text capture) |
| `error` | `window.onerror` and `unhandledrejection` |
| `rage_click` | 3+ clicks within 500ms inside a 30px radius |
| `scroll_depth` | Crossing 25%, 50%, 75%, or 100% scroll marks |
| `time_on_page` | `visibilitychange` to hidden, or `beforeunload` |

### Manual Tracking

```javascript
LivePulse.track('purchase', { plan: 'pro', amount: 49 });
```

### Configuration Options

| Property | Required | Default |
|---|---|---|
| `apiKey` | Yes | — |
| `projectId` | No | `null` |
| `endpoint` | No | `http://localhost:5000/api/events/ingest` |
| `userId` | No | `anonymous` |
| `track` | No | All event types enabled by default |

Selective tracking can be configured by passing a `track` object — only the keys you set are overridden, everything else stays on:

```javascript
LivePulse.init({
  apiKey: '...',
  track: { pageViews: true, clicks: true, errors: true, rageClicks: false }
});
```

---

## API Reference

All dashboard endpoints require a Supabase Bearer token in the `Authorization` header **and** enforce that the authenticated user owns the project being accessed. The ingestion endpoint uses the `x-api-key` header instead and never requires a dashboard session.

### Event Ingestion

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/events/ingest` | API Key | Ingest a single event |

<details>
<summary>Example request/response</summary>

```bash
curl -X POST http://localhost:5000/api/events/ingest \
  -H "x-api-key: lp_test_local_key_123" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "abc-123",
    "eventType": "page_view",
    "url": "https://example.com/pricing",
    "metadata": { "referrer": "https://google.com" }
  }'
```

```json
{ "status": "ok", "eventId": "665f1c2e9b1e4a0012a34567" }
```

</details>

### Project Management

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/projects` | Supabase | List the caller's projects |
| `POST` | `/api/projects` | Supabase | Create a new project (generates an API key) |

### Analytics

All analytics routes are scoped to `/:projectId` and require project ownership.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/analytics/:projectId/overview` | Today's event count, active sessions, unique visitors, errors, avg engaged time |
| `GET` | `/api/analytics/:projectId/events-over-time` | Minute-bucketed event counts (sparkline data) |
| `GET` | `/api/analytics/:projectId/top-pages` | Top 10 pages by view count, with unique session counts |
| `GET` | `/api/analytics/:projectId/event-breakdown` | Event counts grouped by type |
| `GET` | `/api/analytics/:projectId/error-clusters` | Errors grouped by message, with occurrence and affected-session counts |

### Sessions

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sessions/:projectId` | List sessions |
| `GET` | `/api/analytics/:projectId/sessions/:sessionId/timeline` | Full event timeline for a single session |

### Chat

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/chat/:projectId/sessions/:sessionId` | Chat message history for a session |

### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Returns `{ "status": "ok" }` — safe for uptime checks / load balancer probes |

---

## Socket Protocol

Socket.IO serves two purposes: broadcasting live events to the dashboard, and relaying bi-directional chat between founders and visitors.

### Connection Handshake

Clients authenticate during the Socket.IO handshake via `auth`:

- **Dashboard** — `{ token: '<supabase_access_token>' }`. The JWT is verified and the connection is tagged `role: dashboard`.
- **Visitor** — `{ apiKey: '<project_api_key>', sessionId: '<client_session_id>' }`. The API key is validated against the database and the connection is tagged `role: visitor`.

A connection that fails either check is rejected before it can join any room — there's no partial-trust state.

### Dashboard Events

| Event | Direction | Description |
|---|---|---|
| `join_project` | Client → Server | Join `project:<id>` and `dashboard:<id>` rooms (ownership re-verified server-side) |
| `join_chat` | Client → Server | Join the chat room for a specific visitor session |
| `send_chat` | Client → Server | Send a founder message to a visitor |
| `new-event` | Server → Client | Broadcast when an event is ingested |
| `session-updated` | Server → Client | Broadcast when a session aggregate changes |
| `user_reply` | Server → Client | A visitor sent a chat message |

### Visitor Events

| Event | Direction | Description |
|---|---|---|
| `user_reply` | Client → Server | Send a visitor message to the founder |
| `founder_message` | Server → Client | A founder sent a chat message |

**Room isolation** is the core guarantee here: a visitor connection can only ever be in its own chat room. It cannot subscribe to the project's event stream, and it cannot join — or even discover — another visitor's conversation.

---

## Data Model

### Event

| Field | Type | Notes |
|---|---|---|
| `projectId` | ObjectId | Foreign key to Project |
| `sessionId` | String | Client-generated UUID (indexed) |
| `userId` | String | Defaults to `anonymous` |
| `eventType` | String | Enum: `page_view`, `click`, `error`, `rage_click`, `custom`, `time_on_page`, `scroll_depth` |
| `url` | String | Page URL at time of event |
| `element` | String | Sanitized, CSS-selector-like element descriptor |
| `timestamp` | Date | Client-reported timestamp |
| `metadata` | Mixed | Arbitrary payload (viewport, coordinates, error details, etc.) |
| `city` | String | Resolved from the client's IP via geoip-lite |
| `receivedAt` | Date | Server receive time; drives a 30-day TTL index |

### Session

| Field | Type | Notes |
|---|---|---|
| `projectId` | ObjectId | Foreign key to Project |
| `sessionId` | String | Unique per project (compound index) |
| `userId` | String | Defaults to `anonymous` |
| `startedAt` | Date | Set once, on first event, via `$setOnInsert` |
| `lastSeenAt` | Date | Updated on every event |
| `currentUrl` | String | Last known URL |
| `lastEventType` | String | Last event type received |
| `eventCount` | Number | Incremented atomically per event |
| `city` | String | Last resolved city |

### Project

| Field | Type | Notes |
|---|---|---|
| `name` | String | Human-readable project name |
| `apiKey` | String | Unique, indexed; prefixed `lp_` |
| `supabaseUserId` | String | Owner identity, from Supabase |

### ChatMessage

| Field | Type | Notes |
|---|---|---|
| `projectId` | ObjectId | Foreign key to Project |
| `sessionId` | String | Visitor session this message belongs to |
| `sender` | String | Enum: `founder`, `user` |
| `message` | String | Max 2000 characters, trimmed |
| `createdAt` | Date | Compound index with `projectId` + `sessionId` |

---

## Authentication Model

LivePulse uses two distinct, deliberately non-overlapping authentication boundaries:

1. **API Key Authentication** (`x-api-key` header) — used exclusively by the SDK for event ingestion. The API key is public by design; it ships in the customer's page source, where anyone can read it. It grants write access to the event-ingest endpoint and the visitor's own chat room. Nothing else.

2. **Supabase JWT Authentication** (`Authorization: Bearer` header) — used by the dashboard for every privileged operation. The JWT is verified locally using the project's HS256 secret, with no network round-trip to Supabase on the hot path. Dashboard routes additionally enforce **project ownership**: the `supabaseUserId` stored on the project document must match the `sub` claim in the JWT before any read or write is allowed.

These two boundaries are kept separate on purpose. A leaked API key — which should be treated as public information, not a secret — cannot be used to read analytics, list sessions, or access chat history. Only a valid, owning Supabase session can do that.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default: `5000`) |
| `MONGO_URI` | Yes | MongoDB connection string |
| `SUPABASE_JWT_SECRET` | Yes | HS256 secret for verifying Supabase JWTs |
| `DASHBOARD_ORIGIN` | No | Comma-separated list of allowed CORS origins for the dashboard |
| `PUBLIC_BACKEND_URL` | No | Public URL of this backend (used in generated embed snippets) |

### Frontend (`frontend/.env`)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | Yes | Backend API base URL |
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anonymous/public key |

---

## Troubleshooting

**Backend starts but never logs "MongoDB connected successfully"**
`MONGO_URI` is wrong, or nothing's listening on it. If you're running MongoDB locally, confirm it's actually up (`mongosh` should connect); if you're on Atlas, check that your current IP is allow-listed.

**`test.html` never logs "Socket connected"**
Confirm the backend is actually running on the port `test.html` expects, and that `DASHBOARD_ORIGIN`/CORS isn't blocking the page's origin — opening the file directly (`file://`) has a different origin than serving it from a dev server, so double-check whichever one you're using is covered.

**Dashboard shows a blank/failed login**
Check that `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `frontend/.env` match your Supabase project, and that your dev server's exact origin (including port) is in Supabase's **Redirect URLs** list — a mismatch here fails silently more often than it errors loudly.

**Events show up in `test.html`'s console but never reach the dashboard**
Make sure you're signed in to the dashboard as the same Supabase user that owns the seeded test project, and that both are pointed at the same backend (`VITE_API_URL` vs. the `endpoint`/host `test.html` uses).

**401s from analytics/session/chat routes**
These require a Supabase Bearer token *and* ownership of the project in the URL. A valid token for the wrong user still gets a 401 — that's the ownership check working as intended, not a bug.

---

## What's Not in V1

To keep expectations clear: this document describes the shipped V1 product only. Session replay, cross-project rollups, team/multi-seat access, and any scaled-ingestion infrastructure beyond the MongoDB-backed pipeline described above are out of scope here and not covered by anything in this README.

---

## License

This project is unlicensed. All rights reserved.
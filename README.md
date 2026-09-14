# LivePulse

LivePulse is a self-hosted, real-time web analytics platform built with [Express](https://expressjs.com/), [React](https://react.dev/), [Socket.IO](https://socket.io/), and [MongoDB](https://www.mongodb.com/). It captures client-side behavioral events through a lightweight JavaScript SDK and surfaces them in a live dashboard with session tracking, error clustering, and founder-to-visitor chat.

## Features

- **Real-Time Event Stream**: Page views, clicks, errors, rage clicks, scroll depth, and time-on-page broadcast live via WebSocket.
- **Session Intelligence**: Auto-created session aggregates with event counts, last seen timestamps, and geo-location.
- **Error Clustering**: Errors grouped by message with occurrence and affected session counts.
- **Founder-to-Visitor Chat**: Bi-directional chat between the dashboard and site visitors, scoped per session.
- **Zero-Dependency SDK**: A single IIFE-wrapped JavaScript file (~6 KB) that auto-instruments everything with no build step.
- **Supabase Auth**: Dashboard authentication via Supabase JWTs, verified locally with no network roundtrip.
- **Dual Auth Boundaries**: Public API keys for SDK ingestion, Supabase tokens for dashboard access -- a leaked API key cannot read analytics.

## Architecture

The agent follows a three-layer architecture:

1. **SDK** (`sdk/src/livepulse.js`): Captures browser events, batches them, and flushes to the backend every 5 seconds.
2. **Backend** (Express + Socket.IO + MongoDB): Ingests events, upserts sessions, runs analytics aggregations, persists chat, and broadcasts updates in real-time.
3. **Frontend** (React 19 + Vite + TanStack Router): Renders a control room dashboard with live panels, project management, and embedded chat.

## Prerequisites

- **Node.js** >= 18
- **MongoDB** >= 6 (local instance or Atlas)
- **Supabase project** -- you need the JWT secret and anon key from the dashboard

## Installation

### 1. Clone the repository

```bash
git clone <repository-url>
cd LivePulse
```

### 2. Backend setup

```bash
cd backend
npm install
```

Create a `.env` file in `backend/`:

```
PORT=5000
MONGO_URI=mongodb://localhost:27017/livepulse
SUPABASE_JWT_SECRET=your_supabase_jwt_secret_here
DASHBOARD_ORIGIN=http://localhost:5173,http://localhost:8080
```

The Supabase JWT secret is found under **Supabase Dashboard > Project Settings > API > JWT Settings > Legacy JWT Secret**.

### 3. Frontend setup

```bash
cd frontend
npm install
```

Create a `.env` file in `frontend/`:

```
VITE_API_URL=http://localhost:5000
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 4. Seed a test project

```bash
cd backend
npm run seed:test-project
```

### 5. Run

```bash
# Terminal 1 -- backend
cd backend
npm start

# Terminal 2 -- frontend
cd frontend
npm run dev
```

Open `test.html` in a browser to verify events flow end-to-end.

## Usage

Add the SDK to any page:

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

Track custom events:

```javascript
LivePulse.track('purchase', { plan: 'pro', amount: 49 });
```

## Running Tests

```bash
# Backend (Jest + Supertest)
cd backend && npm test

# Frontend (Vitest + Testing Library)
cd frontend && npm test
```

## Tech Stack

| Layer    | Technology                                    |
|----------|-----------------------------------------------|
| SDK      | Vanilla JavaScript (IIFE, zero dependencies)  |
| Backend  | Express 5, Socket.IO, Mongoose, geoip-lite    |
| Frontend | React 19, Vite, TanStack Router, Framer Motion|
| Auth     | Supabase (JWT, OAuth)                         |
| Database | MongoDB                                       |
| Testing  | Jest, Supertest, Vitest, Testing Library       |

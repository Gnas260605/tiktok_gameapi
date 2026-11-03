# TikUser API — TikTok LIVE User & Event Platform

**TikUser API** is an enterprise-grade, multi-tenant platform built with **Node.js, TypeScript, Fastify, PostgreSQL 16, Prisma ORM, and WebSockets**. It connects to TikTok LIVE streams, captures real-time audience events, normalizes user profiles with multi-tier identity quality grading, persists canonical events with strict multi-tenant isolation, and streams normalized events to client applications over high-throughput WebSockets.

---

## 🌟 Key Architecture & Capabilities

1. **High-Throughput Modular Backend**:
   - Built on **Fastify v4** with clean separation of concerns: *Controllers*, *Services*, *Repositories*, and *Adapters*.
   - Compiled JSON Schema request validation and serialization.
   - Swagger / OpenAPI 3.1 interactive UI at `/docs`.

2. **Strict Multi-Tenant Isolation**:
   - Engine-level isolation enforcing composite foreign keys `(tenant_id, id)` across PostgreSQL tables (`tenants`, `api_keys`, `live_sessions`, `users`, `events`, `tenant_settings`).
   - Tenant A physically cannot read, write, or link to data belonging to Tenant B (returns `404 Not Found` or `403 Forbidden`).

3. **Pluggable TikTok Connector & Deterministic Mock**:
   - `ITikTokLiveConnector` decoupled adapter interface.
   - Built-in `MockConnector` generating all 7 interaction event types (`member`, `chat`, `gift`, `like`, `follow`, `share`, `roomUser`) for offline testing and CI/CD without external network dependencies.
   - `LiveTikTokConnector` for live platform streaming with exponential backoff and finite reconnection attempts.

4. **User Identity Normalization**:
   - 3-tier identity quality grading:
     - `platform_id`: Confirmed numeric TikTok `platformUserId` (Tier 1).
     - `handle_fallback`: Username/handle only (Tier 2).
     - `event_only`: Transient anonymous activity (Tier 3).
   - In-memory event deduplication cache and atomic user profile upserts.

5. **Real-time WebSocket Streaming (`/ws`)**:
   - Ephemeral single-use ticket handshake (`POST /api/v1/realtime/tickets`) preventing long-lived API keys from leaking in URLs or access logs.
   - Active heartbeat (30s ping/pong) and stale socket cleanup.
   - Connection limits and subscription scoping per tenant.

---

## 🚀 Quick Start & Local Execution

### 1. Prerequisites
- Node.js 20+ LTS
- pnpm v9+ (or npm)
- PostgreSQL 16+ (or Docker)

### 2. Install & Configure
```bash
# Install dependencies
pnpm install

# Copy environment variables template
cp .env.example .env
```

### 3. Database Migration & Seed
```bash
# Deploy Prisma migrations
pnpm prisma:deploy

# Seed initial tenants (Acme Corp & Beta Streamers) and test API keys
pnpm prisma:seed
```

### 4. Run the Server
```bash
# Development mode with hot reload
pnpm dev

# Or build and start production bundle
pnpm build
pnpm start
```
- REST API: `http://localhost:3000`
- Swagger Documentation: `http://localhost:3000/docs`
- Realtime WebSocket: `ws://localhost:3000/ws`

---

## 🐳 Docker & Containerization

Start the entire stack (PostgreSQL 16 + TikUser API) with Docker Compose:

```bash
docker compose up -d --build
```

Health check probes:
```bash
# Liveness probe
curl http://localhost:3000/health/live

# Readiness probe
curl http://localhost:3000/health/ready
```

---

## 📡 REST API & WebSocket Endpoints

### Authentication
All REST requests require authentication via header:
- `Authorization: Bearer <API_KEY>` or `X-API-Key: <API_KEY>`

### Primary Endpoints
| Method | Path | Description | Response |
|---|---|---|---|
| `GET` | `/health/live` | Process liveness probe | `200 OK` |
| `GET` | `/health/ready` | Database readiness probe | `200 OK` / `503` |
| `POST` | `/api/v1/live/sessions` | Create and connect LIVE session (`creatorUsername`, `mode`) | `202 Accepted` |
| `GET` | `/api/v1/live/sessions` | List tenant sessions (cursor paginated) | `200 OK` |
| `GET` | `/api/v1/live/sessions/:sessionId` | Get session details | `200 OK` / `404` |
| `DELETE` | `/api/v1/live/sessions/:sessionId` | Disconnect session | `202 Accepted` |
| `GET` | `/api/v1/users` | List observed users in tenant sessions | `200 OK` |
| `GET` | `/api/v1/users/:userId` | Get observed user profile | `200 OK` / `404` |
| `GET` | `/api/v1/users/:userId/events` | List events for a specific user | `200 OK` |
| `GET` | `/api/v1/events` | List normalized events with filters | `200 OK` |
| `GET` | `/api/v1/events/:eventId` | Get single event details | `200 OK` / `404` |
| `POST` | `/api/v1/realtime/tickets` | Issue short-lived ticket for WebSocket | `201 Created` |
| `POST` | `/api/v1/api-keys` | Generate new API key (secret shown once) | `201 Created` |
| `GET` | `/api/v1/api-keys` | List tenant API keys (metadata only) | `200 OK` |
| `DELETE` | `/api/v1/api-keys/:keyId` | Revoke API key | `204 No Content` |

### WebSocket Workflow
1. Client requests ticket: `POST /api/v1/realtime/tickets` with `{ "sessionIds": ["<SESSION_UUID>"] }`.
2. Client opens socket: `ws://localhost:3000/ws`.
3. Client authenticates: `{ "action": "authenticate", "ticket": "<TICKET>" }`.
4. Client subscribes: `{ "action": "subscribe", "sessionId": "<SESSION_UUID>" }`.
5. Server streams live events:
```json
{
  "type": "event",
  "event": {
    "eventId": "uuid",
    "sessionId": "uuid",
    "type": "chat",
    "occurredAt": "2026-11-03T10:00:00.000Z",
    "receivedAt": "2026-11-03T10:00:00.100Z",
    "user": {
      "id": "uuid",
      "platform": "tiktok",
      "platformUserId": "10001001",
      "uniqueId": "alice_wanderer",
      "nickname": "Alice in LiveLand",
      "avatarUrl": "https://...",
      "verified": true,
      "identityQuality": "platform_id"
    },
    "data": {
      "text": "Hello streamer!"
    }
  }
}
```

---

## 🧪 Comprehensive Automated Testing

The automated test suite contains **200+ tests** covering unit, repository integration, adversarial stress, and end-to-end scenarios.

```bash
# Execute entire test suite
pnpm test

# Run 15 mandatory acceptance scenarios
pnpm vitest run tests/e2e/fifteen-scenarios.test.ts

# Run with test coverage
pnpm test:coverage
```

### The 15 Mandatory Scenarios Coverage:
- [x] **SC-01**: LIVE session creation succeeds (`POST /api/v1/live/sessions` -> 202).
- [x] **SC-02**: TikTok LIVE connection succeeds when connector is available (`startedAt` populated).
- [x] **SC-03**: Connection succeeds via Mock Connector with zero network overhead.
- [x] **SC-04**: `member` event received and persisted in database.
- [x] **SC-05**: `chat` event received and broadcast to clients.
- [x] **SC-06**: `gift` event received and persisted with gift diamond/repeat count.
- [x] **SC-07**: User information saved and updated without duplicate rows.
- [x] **SC-08**: Event history saved with distinct UUID identifiers.
- [x] **SC-09**: Retrieve user list via `GET /api/v1/users`.
- [x] **SC-10**: Retrieve event history via `GET /api/v1/events` with filtering.
- [x] **SC-11**: Real-time event streaming received over WebSocket.
- [x] **SC-12**: Invalid / missing / expired API keys rejected (401/403).
- [x] **SC-13**: Tenant isolation prevents cross-tenant access (404/403).
- [x] **SC-14**: Connector disconnection handled gracefully without crashing.
- [x] **SC-15**: WebSocket client auto-reconnection and session resumption.

---

## 📁 Repository Structure

```text
TikUser-API/
├── docs/
│   ├── PRD.md                       # Product Requirements Document
│   ├── ERD.md                       # Database Entity Relationship Diagram
│   ├── API_OPENAPI.yaml             # OpenAPI 3.1.0 Contract
│   ├── WEBSOCKET_PROTOCOL.md        # Realtime WebSocket Protocol
│   ├── PROJECT_PLAN.md              # Multi-Agent Architecture & Plan
│   ├── TASK_TRACKER.md              # Comprehensive Verification Checklist
│   ├── TECH_DECISIONS.md            # Architecture Decision Records (ADRs)
│   └── DEPLOYMENT.md                # Production Deployment Guide
├── src/
│   ├── adapters/
│   │   └── tiktok/                  # ITikTokLiveConnector, MockConnector, LiveConnector
│   ├── controllers/                 # REST Route Handlers (Sessions, Users, Events, etc.)
│   ├── middleware/                  # API Key Authentication & Unified Error Handler
│   ├── repositories/                # Database Repositories with Strict Multi-Tenancy
│   ├── services/
│   │   ├── auth/                    # API Key Validation & Hashing
│   │   ├── event/                   # Event Ingestion, Batching & Deduplication
│   │   ├── realtime/                # Realtime Ephemeral Ticket Service
│   │   ├── session/                 # Session Lifecycle & Connector Orchestration
│   │   └── user/                    # 3-Tier Identity Normalization Service
│   ├── websocket/                   # WebSocket Server & Channel Broadcast Manager
│   ├── app.ts                       # Fastify Application Builder & Plugin Wiring
│   └── server.ts                    # Production HTTP & WebSocket Server Entrypoint
├── prisma/
│   ├── schema.prisma                # Relational Schema with Composite FK Constraints
│   ├── migrations/                  # Versioned SQL Migrations
│   └── seed.ts                      # Multi-Tenant Seed Fixture
├── tests/
│   ├── api/                         # Fastify REST Endpoint Integration Tests
│   ├── e2e/                         # 15 Required Acceptance Scenarios Suite
│   ├── integration/                 # Database Repository & Connector Stress Suites
│   ├── unit/                        # Unit Tests (Normalization, Tickets, MockConnector)
│   └── websocket/                   # WebSocket Protocol & Tenant Isolation Tests
├── Dockerfile                       # Production Multi-Stage Alpine Container
├── docker-compose.yml               # PostgreSQL 16 & Application Orchestration
├── .env.example                     # Environment Variables Template
└── package.json                     # Scripts & Dependencies
```

---

## ⚖️ License
UNLICENSED — Proprietary & Confidential.
